-- Apply after reservation-management-improvements, guest-auto-reschedule,
-- manager-ocular-cancellation and admin-read-only-manager-refunds migrations.
-- Existing date blocks remain whole days in Philippine time; historical pending
-- ocular requests retain their records. Eligible future requests become confirmed.
begin;
alter table public.maintenance_blocks add column if not exists start_datetime timestamptz;
alter table public.maintenance_blocks add column if not exists end_datetime timestamptz;
update public.maintenance_blocks set
  start_datetime=start_date::timestamp at time zone 'Asia/Manila',
  end_datetime=(end_date+1)::timestamp at time zone 'Asia/Manila'
where start_datetime is null or end_datetime is null;
alter table public.maintenance_blocks alter column start_datetime set not null;
alter table public.maintenance_blocks alter column end_datetime set not null;
alter table public.maintenance_blocks drop constraint if exists maintenance_time_range;
alter table public.maintenance_blocks add constraint maintenance_time_range check(
  isfinite(start_datetime) and isfinite(end_datetime) and end_datetime>start_datetime
  and end_datetime<=start_datetime+interval '366 days'
  and start_date=(start_datetime at time zone 'Asia/Manila')::date
  and end_date=((end_datetime-interval '1 microsecond') at time zone 'Asia/Manila')::date);
alter table public.maintenance_blocks drop constraint if exists no_overlapping_maintenance_blocks;
alter table public.maintenance_blocks add constraint no_overlapping_maintenance_blocks
  exclude using gist(tstzrange(start_datetime,end_datetime,'[)') with &&) where(status='active');

-- Admin maintenance is an explicit exception to operational read-only access.
-- All writes use the RPCs below; the other operational-table guards stay intact.
drop trigger if exists guard_admin_operational_write on public.maintenance_blocks;
create or replace function public.guard_maintenance_write()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated') then
    raise exception 'Use the authorized maintenance action' using errcode='42501'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
drop trigger if exists guard_maintenance_write on public.maintenance_blocks;
create trigger guard_maintenance_write before insert or update or delete on public.maintenance_blocks
for each row execute function public.guard_maintenance_write();

create or replace function public.reject_maintenance_booking()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_day date;
begin
  if new.status in ('pending','payment_submitted','confirmed','reschedule_requested') then
    for v_day in select generate_series((new.start_datetime at time zone 'Asia/Manila')::date,
      ((new.end_datetime-interval '1 microsecond') at time zone 'Asia/Manila')::date,interval '1 day')::date order by 1 loop
      perform pg_advisory_xact_lock(424242,hashtext(v_day::text));
    end loop;
    if exists(select 1 from public.maintenance_blocks where status='active'
      and start_datetime<new.end_datetime and end_datetime>new.start_datetime) then
      raise exception 'This time is unavailable due to maintenance' using errcode='23P01'; end if;
  end if;
  return new;
end $$;

create or replace function public.create_timed_maintenance_block(p_name text,p_reason text,p_start timestamptz,p_end timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_day date; v_id uuid; v_actor uuid:=auth.uid();
begin
  if not exists(select 1 from public.staff_users s where s.id=v_actor and s.is_active and
    (s.role='admin' or (s.role='staff' and public.refund_staff_permission('edit_reservation')))) then
    raise exception 'Administrator or authorized manager required' using errcode='42501'; end if;
  if length(trim(coalesce(p_name,''))) not between 1 and 120 or length(trim(coalesce(p_reason,''))) not between 1 and 2000
    or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
    or p_end<=p_start or p_end>p_start+interval '366 days' then
    raise exception 'Enter a valid maintenance period, name and internal reason' using errcode='22023'; end if;
  for v_day in select generate_series((p_start at time zone 'Asia/Manila')::date,
    ((p_end-interval '1 microsecond') at time zone 'Asia/Manila')::date,interval '1 day')::date order by 1 loop
    perform pg_advisory_xact_lock(424242,hashtext(v_day::text));
  end loop;
  -- Ignore expired pending bookings without writing unrelated operational rows.
  if exists(select 1 from public.reservations where status in ('pending','payment_submitted','confirmed','reschedule_requested')
    and (status<>'pending' or payment_deadline_at is null or payment_deadline_at>clock_timestamp())
    and start_datetime<p_end and end_datetime>p_start) then
    raise exception 'An active reservation overlaps this period' using errcode='23P01'; end if;
  if exists(select 1 from public.ocular_visits v join public.ocular_time_slots s on s.slot_id=v.time_slot_id
    where v.status in ('pending','confirmed')
    and ((v.scheduled_date+s.start_time) at time zone 'Asia/Manila')<p_end
    and ((v.scheduled_date+s.end_time) at time zone 'Asia/Manila')>p_start) then
    raise exception 'An ocular visit overlaps this period. Cancel it before blocking this time' using errcode='23P01'; end if;
  insert into public.maintenance_blocks(name,reason,start_date,end_date,start_datetime,end_datetime,created_by)
    values(trim(p_name),trim(p_reason),(p_start at time zone 'Asia/Manila')::date,
      ((p_end-interval '1 microsecond') at time zone 'Asia/Manila')::date,p_start,p_end,v_actor) returning block_id into v_id;
  insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
    select 'guest',id,v_actor,'Scheduled maintenance',
      format('The resort is unavailable due to maintenance from %s to %s (Philippine time).',
        to_char(p_start at time zone 'Asia/Manila','YYYY-MM-DD HH24:MI'),to_char(p_end at time zone 'Asia/Manila','YYYY-MM-DD HH24:MI')),
      '/booking','maintenance_block',v_id from public.guests;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(v_actor,v_actor,'Created maintenance block','maintenance_block',v_id,
      jsonb_build_object('name',trim(p_name),'reason',trim(p_reason),'start_datetime',p_start,'end_datetime',p_end));
  return v_id;
end $$;
-- Retire the date-only write entry point so old callers cannot reintroduce leaks.
drop function if exists public.create_maintenance_block(text,text,date,date);
create or replace function public.release_maintenance_block(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_block public.maintenance_blocks%rowtype; v_actor uuid:=auth.uid();
begin
  if not exists(select 1 from public.staff_users s where s.id=v_actor and s.is_active and
    (s.role='admin' or (s.role='staff' and public.refund_staff_permission('edit_reservation')))) then
    raise exception 'Administrator or authorized manager required' using errcode='42501'; end if;
  select * into v_block from public.maintenance_blocks where block_id=p_id for update;
  if not found or v_block.status<>'active' then raise exception 'Active block not found' using errcode='22023'; end if;
  update public.maintenance_blocks set status='released',released_by=v_actor,released_at=clock_timestamp() where block_id=p_id;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(v_actor,v_actor,'Released maintenance block','maintenance_block',p_id,to_jsonb(v_block));
end $$;
-- Remove historical customer notification disclosures, too.
update public.notifications set title='Scheduled maintenance',
  message='The resort is unavailable during the scheduled maintenance period. Check the booking calendar for available times.'
where recipient_role='guest' and entity_type='maintenance_block';

-- All new and moved visits are confirmed under the same day lock as maintenance.
-- SECURITY DEFINER makes capacity counts independent of guest row visibility.
create or replace function public.guard_ocular_review_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare s public.ocular_time_slots%rowtype; v_start timestamptz; v_end timestamptz;
begin
  if auth.role() in ('anon','authenticated') and (auth.uid() is null or new.guest_id is distinct from auth.uid()) then
    raise exception 'The active visit owner is required' using errcode='42501'; end if;
  if tg_op='UPDATE' then
    if new.guest_id is distinct from old.guest_id or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at or new.review_reason is distinct from old.review_reason then
      raise exception 'Ocular ownership and historical review records cannot be changed' using errcode='42501'; end if;
    if old.status not in ('pending','confirmed') and (new.status is distinct from old.status
      or new.scheduled_date is distinct from old.scheduled_date or new.time_slot_id is distinct from old.time_slot_id) then
      raise exception 'Closed visits cannot be changed' using errcode='40001'; end if;
    if new.status='rejected' and new.status is distinct from old.status then
      raise exception 'Ocular visits no longer require approval or rejection' using errcode='22023'; end if;
    if new.status='completed' and new.status is distinct from old.status then
      if auth.role() is distinct from 'service_role' or auth.uid() is not null then
        raise exception 'Use the authorized mark visited action' using errcode='42501'; end if;
    end if;
  else
    if new.status not in ('pending','confirmed') or new.reviewed_at is not null or new.reviewed_by is not null or new.review_reason is not null then
      raise exception 'New visits must use automatic confirmation' using errcode='22023'; end if;
  end if;
  if tg_op='INSERT' or (new.status in ('pending','confirmed') and
    (new.scheduled_date is distinct from old.scheduled_date or new.time_slot_id is distinct from old.time_slot_id or new.status is distinct from old.status)) then
    if tg_op='UPDATE' and old.status not in ('pending','confirmed') then
      raise exception 'Closed visits cannot be rescheduled' using errcode='40001'; end if;
    if not exists(select 1 from public.guests where id=new.guest_id and is_active) then
      raise exception 'An active guest is required' using errcode='42501'; end if;
    perform pg_advisory_xact_lock(424242,hashtext(new.scheduled_date::text));
    select * into s from public.ocular_time_slots where slot_id=new.time_slot_id and is_active for share;
    if not found or s.start_time<time '08:00' or s.end_time>time '17:00' or s.end_time<=s.start_time then
      raise exception 'Choose an available ocular slot between 8 AM and 5 PM' using errcode='22023'; end if;
    v_start:=(new.scheduled_date+s.start_time) at time zone 'Asia/Manila';
    v_end:=(new.scheduled_date+s.end_time) at time zone 'Asia/Manila';
    if v_start<clock_timestamp()+interval '30 minutes' then
      raise exception 'Choose a visit at least 30 minutes from now' using errcode='22023'; end if;
    if exists(select 1 from public.maintenance_blocks where status='active' and start_datetime<v_end and end_datetime>v_start) then
      raise exception 'This time is unavailable due to maintenance' using errcode='23P01'; end if;
    if (select count(*) from public.ocular_visits where scheduled_date=new.scheduled_date and time_slot_id=new.time_slot_id
      and status in ('pending','confirmed') and visit_id<>new.visit_id)>=coalesce(s.max_capacity,1) then
      raise exception 'This ocular time slot is full' using errcode='23P01'; end if;
    if exists(select 1 from public.ocular_visits where scheduled_date=new.scheduled_date and guest_id=new.guest_id
      and status in ('pending','confirmed') and visit_id<>new.visit_id) then
      raise exception 'You already have an ocular visit on this date' using errcode='23505'; end if;
    new.status:='confirmed';
  end if;
  return new;
end $$;
-- Pending requests already reserve capacity. Confirm only those still eligible;
-- leave past or conflicting historical requests intact for staff follow-up.
update public.ocular_visits v set status='confirmed'
from public.ocular_time_slots s where v.time_slot_id=s.slot_id and v.status='pending' and s.is_active
  and s.start_time>=time '08:00' and s.end_time<=time '17:00' and s.end_time>s.start_time
  and ((v.scheduled_date+s.start_time) at time zone 'Asia/Manila')>clock_timestamp()+interval '30 minutes'
  and exists(select 1 from public.guests g where g.id=v.guest_id and g.is_active)
  and not exists(select 1 from public.maintenance_blocks b where b.status='active'
    and b.start_datetime<((v.scheduled_date+s.end_time) at time zone 'Asia/Manila')
    and b.end_datetime>((v.scheduled_date+s.start_time) at time zone 'Asia/Manila'))
  and (select count(*) from public.ocular_visits x where x.scheduled_date=v.scheduled_date
    and x.time_slot_id=v.time_slot_id and x.status in ('pending','confirmed'))<=coalesce(s.max_capacity,1)
  and not exists(select 1 from public.ocular_visits x where x.visit_id<>v.visit_id and x.guest_id=v.guest_id
    and x.scheduled_date=v.scheduled_date and x.status in ('pending','confirmed'));
revoke all on function public.review_ocular_visit(uuid,text,text,uuid) from public,anon,authenticated,service_role;

create or replace function public.save_confirmed_ocular_visit(p_guest uuid,p_date date,p_slot uuid,p_reference text,p_visit uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.ocular_visits%rowtype;
begin
  if auth.role() is distinct from 'service_role' or auth.uid() is not null then raise exception 'Server workflow required' using errcode='42501'; end if;
  if p_visit is null then
    insert into public.ocular_visits(guest_id,scheduled_date,time_slot_id,reference_number,status)
      values(p_guest,p_date,p_slot,p_reference,'confirmed') returning * into v;
  else
    select * into v from public.ocular_visits where visit_id=p_visit and guest_id=p_guest for update;
    if not found or v.status not in ('pending','confirmed') then raise exception 'This visit cannot be rescheduled' using errcode='40001'; end if;
    update public.ocular_visits set scheduled_date=p_date,time_slot_id=p_slot,status='confirmed' where visit_id=p_visit returning * into v;
  end if;
  return to_jsonb(v);
end $$;
create or replace function public.complete_ocular_visit(p_visit uuid,p_staff uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.ocular_visits%rowtype; v_start timestamptz;
begin
  if auth.role() is distinct from 'service_role' or auth.uid() is not null or not exists(
    select 1 from public.staff_users s where s.id=p_staff and s.is_active and s.role<>'admin' and exists(
      select 1 from public.role_permissions rp where rp.role=s.role and 'ocular_approval'=any(rp.permissions))) then
    raise exception 'Authorized ocular management permission required' using errcode='42501'; end if;
  select * into v from public.ocular_visits where visit_id=p_visit for update;
  if not found or v.status<>'confirmed' then raise exception 'Only confirmed visits may be marked visited' using errcode='40001'; end if;
  select (v.scheduled_date+start_time) at time zone 'Asia/Manila' into v_start from public.ocular_time_slots where slot_id=v.time_slot_id;
  if v_start is null or v_start>clock_timestamp() then raise exception 'A visit cannot be marked visited before its scheduled time' using errcode='22023'; end if;
  update public.ocular_visits set status='completed' where visit_id=p_visit returning * into v;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff,p_staff,'Marked ocular visit as visited','ocular_visit',p_visit,jsonb_build_object('reference_number',v.reference_number,'visited_at',clock_timestamp()));
  return to_jsonb(v);
end $$;

revoke all on function public.guard_maintenance_write() from public,anon,authenticated;
revoke all on function public.create_timed_maintenance_block(text,text,timestamptz,timestamptz) from public,anon;
grant execute on function public.create_timed_maintenance_block(text,text,timestamptz,timestamptz) to authenticated;
revoke all on function public.release_maintenance_block(uuid) from public,anon;
grant execute on function public.release_maintenance_block(uuid) to authenticated;
revoke all on function public.save_confirmed_ocular_visit(uuid,date,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.save_confirmed_ocular_visit(uuid,date,uuid,text,uuid) to service_role;
revoke all on function public.complete_ocular_visit(uuid,uuid) from public,anon,authenticated;
grant execute on function public.complete_ocular_visit(uuid,uuid) to service_role;
-- Replace the legacy date-only check in the automatic guest reschedule RPC.
create or replace function public.reschedule_guest_reservation(
  p_reservation uuid, p_guest uuid, p_expected jsonb,
  p_new_start timestamptz, p_new_end timestamptz,
  p_notice_fee numeric, p_rate_adjustment numeric, p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_r public.reservations%rowtype;
  v_total numeric; v_paid numeric; v_new_total numeric; v_charge numeric;
  v_policy jsonb; v_at timestamptz; v_id uuid;
  v_day date; v_first date; v_last date;
begin
  if length(trim(coalesce(p_reason,'')))<5 or length(p_reason)>2000 then
    raise exception 'A reschedule reason between 5 and 2000 characters is required' using errcode='22023'; end if;
  select * into v_r from public.reservations where reservation_id=p_reservation for update;
  if not found or v_r.guest_id is distinct from p_guest or p_guest is null
    or (auth.uid() is not null and auth.uid()<>p_guest)
    or not exists(select 1 from public.guests where id=p_guest and is_active=true) then
    raise exception 'An active reservation owner is required' using errcode='42501'; end if;
  if v_r.status<>'confirmed' or v_r.checked_in_at is not null then
    raise exception 'Only confirmed reservations before check-in can be rescheduled' using errcode='40001'; end if;
  if p_expected is null
    or (p_expected->>'startDatetime')::timestamptz is distinct from v_r.start_datetime
    or (p_expected->>'endDatetime')::timestamptz is distinct from v_r.end_datetime
    or (p_expected->>'adultCount')::integer is distinct from v_r.adult_count
    or (p_expected->>'childCount')::integer is distinct from v_r.child_count
    or (p_expected->>'bookingMode') is distinct from v_r.booking_mode
    or (p_expected->>'packageRateVersion')::bigint is distinct from v_r.package_rate_version
    or v_r.package_rate_version is null then
    raise exception 'This reservation changed. Refresh Manage Booking before rescheduling' using errcode='40001'; end if;
  v_at:=clock_timestamp();
  if p_new_start is null or p_new_end is null or not isfinite(p_new_start) or not isfinite(p_new_end)
    or p_new_start<v_at+interval '30 minutes' or p_new_end<=p_new_start
    or p_new_start=v_r.start_datetime or v_r.booking_mode is null
    or p_new_end-p_new_start<>v_r.end_datetime-v_r.start_datetime
    or mod(extract(epoch from p_new_start-v_r.start_datetime),86400)<>0 then
    raise exception 'Keep the booked package, start time and duration and choose another future date' using errcode='22023'; end if;
  if exists(select 1 from public.reservation_reschedules where reservation_id=p_reservation and status='pending')
    or exists(select 1 from public.payments where reservation_id=p_reservation and status='pending')
    or exists(select 1 from public.refund_requests where reservation_id=p_reservation and status in ('pending','reviewed','approved','payout_submitted')) then
    raise exception 'Resolve the pending payment, reschedule or refund review before rescheduling' using errcode='40001'; end if;
  v_policy:=public.reschedule_policy_snapshot(v_r.start_datetime,v_at);
  if p_notice_fee is distinct from (v_policy->>'noticeFee')::numeric
    or p_rate_adjustment is null or p_rate_adjustment<0 or p_rate_adjustment='NaN'::numeric then
    raise exception 'Reschedule quote changed. Refresh before saving' using errcode='40001'; end if;

  -- Use the same Manila-day locks as booking and maintenance creation. The
  -- reservation exclusion constraint remains the final guard against races.
  v_first:=(p_new_start at time zone 'Asia/Manila')::date;
  v_last:=((p_new_end-interval '1 microsecond') at time zone 'Asia/Manila')::date;
  for v_day in select generate_series(v_first,v_last,interval '1 day')::date loop
    perform pg_advisory_xact_lock(424242,hashtext(v_day::text));
  end loop;
  if exists(select 1 from public.maintenance_blocks where status='active' and start_datetime<p_new_end and end_datetime>p_new_start) then
    raise exception 'The selected date is closed for maintenance' using errcode='23P01'; end if;
  if exists(select 1 from public.reservations r where r.reservation_id<>p_reservation
    and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
    and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>v_at)
    and r.start_datetime<p_new_end and r.end_datetime>p_new_start) then
    raise exception 'The selected date has already been reserved' using errcode='23P01'; end if;
  select total_amount,coalesce(paid_amount,0) into v_total,v_paid
    from public.transactions where reservation_id=p_reservation for update;
  if not found then raise exception 'Reservation transaction is missing' using errcode='40001'; end if;
  v_charge:=round(p_notice_fee+p_rate_adjustment,2);
  v_new_total:=v_total+v_charge;

  insert into public.reservation_reschedules(reservation_id,requested_by,old_start,old_end,new_start,new_end,
    reschedule_fee,rate_adjustment,status,approved_by,approved_at,created_at,reason)
    values(p_reservation,p_guest,v_r.start_datetime,v_r.end_datetime,p_new_start,p_new_end,
      p_notice_fee,p_rate_adjustment,'approved',null,v_at,v_at,trim(p_reason)) returning reschedule_id into v_id;
  update public.reservations set start_datetime=p_new_start,end_datetime=p_new_end,status='confirmed'
    where reservation_id=p_reservation;
  -- Restore the captured bill after legacy schedule-recalculation triggers;
  -- preserve all existing payments, service prices, receipts and earlier fees.
  update public.transactions set total_amount=v_new_total,paid_amount=v_paid,
    status=case when v_paid>=v_new_total then 'paid' when v_paid>0 then 'partial' else 'unpaid' end
    where reservation_id=p_reservation;
  update public.invoices set total_amount=v_new_total,
    status=case when v_paid>=v_new_total then 'paid' when v_paid>0 then 'partially_paid' else 'issued' end
    where invoice_id=(select invoice_id from public.invoices where reservation_id=p_reservation and status<>'void'
      order by created_at desc,invoice_id desc limit 1);
  insert into public.audit_logs(auth_user_id,action,entity_type,entity_id,details)
    values(p_guest,'Automatically approved guest reschedule and charged notice fee','reservation_reschedule',v_id,
      jsonb_build_object('automatic_approval',true,'requested_by',p_guest,'requested_at',v_at,
        'notice_fee',p_notice_fee,'rate_adjustment',p_rate_adjustment,'reason',trim(p_reason),'before_total',v_total,'after_total',v_new_total,
        'policy_at_request',v_policy,'old_start',v_r.start_datetime,'old_end',v_r.end_datetime,
        'new_start',p_new_start,'new_end',p_new_end));
  return jsonb_build_object('reservationId',p_reservation,'rescheduleId',v_id,'status','confirmed',
    'startDatetime',p_new_start,'endDatetime',p_new_end,'rescheduleFee',p_notice_fee,'rateAdjustment',p_rate_adjustment,
    'totalAdditional',v_charge,'totalAmount',v_new_total,'paidAmount',v_paid,'remainingBalance',greatest(v_new_total-v_paid,0));
end $$;

notify pgrst,'reload schema';
commit;
