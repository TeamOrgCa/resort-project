-- Apply after reservation-calendar-attendance, cancellation-refund-workflow,
-- staff-cash-payments, reschedule-policy and review-feedback-management migrations.
-- Attendance records are entered by staff; elapsed booking time does not complete a stay.
begin;
alter table public.reservations add column if not exists checked_out_at timestamptz;
alter table public.reservations add column if not exists checked_out_by uuid references public.staff_users(id);

create or replace function public.guard_reservation_attendance()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated') then
    if tg_op='INSERT' then
      if new.checked_in_at is not null or new.checked_in_by is not null or new.checked_out_at is not null or new.checked_out_by is not null then
        raise exception 'Use the staff arrival and checkout actions' using errcode='42501'; end if;
    elsif new.checked_in_at is distinct from old.checked_in_at or new.checked_in_by is distinct from old.checked_in_by
      or new.checked_out_at is distinct from old.checked_out_at or new.checked_out_by is distinct from old.checked_out_by then
      raise exception 'Use the staff arrival and checkout actions' using errcode='42501';
    end if;
  end if;
  return new;
end $$;

create or replace function public.guard_stay_lifecycle()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_total numeric; v_paid numeric;
begin
  if old.checked_in_at is not null and (new.status in ('cancelled','reschedule_requested')
    or new.start_datetime is distinct from old.start_datetime or new.end_datetime is distinct from old.end_datetime
    or new.booking_mode is distinct from old.booking_mode) then
    raise exception 'Checked-in reservations cannot be cancelled or rescheduled' using errcode='40001'; end if;
  if old.status is distinct from new.status and new.status='completed' then
    if old.status<>'confirmed' or old.checked_in_at is null or new.checked_out_at is null or new.checked_out_by is null then
      raise exception 'Record guest check-in and use the staff checkout action to complete a stay' using errcode='40001'; end if;
    select total_amount into v_total from public.transactions where reservation_id=new.reservation_id;
    select coalesce(sum(amount),0) into v_paid from public.payments where reservation_id=new.reservation_id and status='verified';
    v_paid:=v_paid-coalesce((select sum(amount) from public.refund_requests where reservation_id=new.reservation_id and status='refunded'),0);
    if v_total is null or round(v_paid,2)<round(v_total,2) then
      raise exception 'Settle the full reservation bill with verified payments before checkout' using errcode='40001'; end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_stay_lifecycle on public.reservations;
create trigger guard_stay_lifecycle before update on public.reservations for each row execute function public.guard_stay_lifecycle();

create or replace function public.guard_checked_in_reschedule()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_checked_in timestamptz;
begin
  if tg_op='INSERT' or new.status='approved' then
    select checked_in_at into v_checked_in from public.reservations where reservation_id=new.reservation_id for update;
    if v_checked_in is not null then raise exception 'Checked-in reservations cannot be rescheduled' using errcode='40001'; end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_checked_in_reschedule on public.reservation_reschedules;
create trigger guard_checked_in_reschedule before insert or update on public.reservation_reschedules for each row execute function public.guard_checked_in_reschedule();

create or replace function public.check_in_reservation(p_reservation uuid,p_staff uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_r public.reservations%rowtype;
begin
  if not exists(select 1 from public.staff_users s where s.id=p_staff and s.is_active
    and (s.role='admin' or exists(select 1 from public.role_permissions rp where rp.role=s.role and 'edit_reservation'=any(rp.permissions)))) then
    raise exception 'Reservation check-in permission required' using errcode='42501'; end if;
  select * into v_r from public.reservations where reservation_id=p_reservation for update;
  if not found then raise exception 'Reservation not found' using errcode='P0002'; end if;
  if v_r.checked_in_at is not null then return to_jsonb(v_r)||jsonb_build_object('alreadyCheckedIn',true); end if;
  if v_r.status<>'confirmed' or (v_r.start_datetime at time zone 'Asia/Manila')::date<>(clock_timestamp() at time zone 'Asia/Manila')::date
    or v_r.end_datetime<=clock_timestamp() then
    raise exception 'Only a confirmed reservation arriving today can be checked in' using errcode='40001'; end if;
  if exists(select 1 from public.reservation_reschedules where reservation_id=p_reservation and status='pending') then
    raise exception 'Resolve the pending reschedule request before check-in' using errcode='40001'; end if;
  update public.reservations set checked_in_at=clock_timestamp(),checked_in_by=p_staff where reservation_id=p_reservation returning * into v_r;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff,p_staff,'Recorded guest check-in','reservation',p_reservation,jsonb_build_object('checked_in_at',v_r.checked_in_at,'reference_number',v_r.reference_number));
  return to_jsonb(v_r)||jsonb_build_object('alreadyCheckedIn',false);
end $$;
revoke all on function public.check_in_reservation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.check_in_reservation(uuid,uuid) to service_role;

create or replace function public.check_out_reservation(p_reservation uuid,p_staff uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_r public.reservations%rowtype; v_t public.transactions%rowtype;
begin
  if not exists(select 1 from public.staff_users s where s.id=p_staff and s.is_active
    and (s.role='admin' or exists(select 1 from public.role_permissions rp where rp.role=s.role and 'edit_reservation'=any(rp.permissions)))) then
    raise exception 'Reservation checkout permission required' using errcode='42501'; end if;
  select * into v_r from public.reservations where reservation_id=p_reservation for update;
  if not found then raise exception 'Reservation not found' using errcode='P0002'; end if;
  if v_r.status='completed' and v_r.checked_out_at is not null then
    return to_jsonb(v_r)||jsonb_build_object('alreadyCheckedOut',true); end if;
  if v_r.status<>'confirmed' or v_r.checked_in_at is null then
    raise exception 'Only a checked-in confirmed reservation can be checked out' using errcode='40001'; end if;
  if exists(select 1 from public.payments where reservation_id=p_reservation and status='pending') then
    raise exception 'Review pending payments before checkout' using errcode='40001'; end if;
  if exists(select 1 from public.reservation_reschedules where reservation_id=p_reservation and status='pending') then
    raise exception 'Resolve pending reschedule requests before checkout' using errcode='40001'; end if;
  perform 1 from public.transactions where reservation_id=p_reservation for update;
  perform public.refresh_reservation_payment_totals(p_reservation);
  select * into v_t from public.transactions where reservation_id=p_reservation;
  if not found or v_t.balance>0 or coalesce(v_t.paid_amount,0)<v_t.total_amount then
    raise exception 'Settle the full reservation bill with verified payments before checkout' using errcode='40001'; end if;
  update public.reservations set status='completed',checked_out_at=clock_timestamp(),checked_out_by=p_staff
    where reservation_id=p_reservation returning * into v_r;
  update public.invoices set status='paid' where reservation_id=p_reservation and status<>'void';
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff,p_staff,'Checked out guest and completed stay','reservation',p_reservation,
      jsonb_build_object('checked_in_at',v_r.checked_in_at,'checked_out_at',v_r.checked_out_at,'reference_number',v_r.reference_number,
        'total_amount',v_t.total_amount,'verified_net_paid',v_t.paid_amount,'balance',v_t.balance));
  return to_jsonb(v_r)||jsonb_build_object('alreadyCheckedOut',false);
end $$;
revoke all on function public.check_out_reservation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.check_out_reservation(uuid,uuid) to service_role;

-- Existing rate limits and repeat-review rules still apply after a completed stay.
create or replace function public.guard_review_completed_stay()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.reservations r where r.guest_id=new.guest_id and r.status='completed'
    and (new.reservation_id is null or r.reservation_id=new.reservation_id)) then
    raise exception 'Complete a resort stay before submitting a review. Linked reservations must be your own completed stays' using errcode='42501'; end if;
  return new;
end $$;
drop trigger if exists guard_review_completed_stay on public.reviews;
create trigger guard_review_completed_stay before insert or update of reservation_id,guest_id on public.reviews
for each row execute function public.guard_review_completed_stay();

create or replace function public.review_submission_status(p_title text,p_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.guests where id=auth.uid() and is_active) then
    raise exception 'An active guest account is required' using errcode='42501'; end if;
  if not exists(select 1 from public.reservations where guest_id=auth.uid() and status='completed') then
    raise exception 'Complete a resort stay before submitting a review' using errcode='42501'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 or p_text is null or length(btrim(p_text)) not between 50 and 5000 then
    raise exception 'Enter a title of 1-200 characters and review text of 50-5000 characters' using errcode='22023'; end if;
  return public.review_submission_policy(auth.uid(),p_title,p_text);
end $$;
revoke all on function public.review_submission_status(text,text) from public,anon;
grant execute on function public.review_submission_status(text,text) to authenticated;

-- Keep the existing refund quote and policy, adding the arrival lock.
create or replace function public.get_cancellation_preview(p_reservation uuid,p_initiator text default 'guest')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; t public.transactions%rowtype; p public.booking_policy_versions%rowtype;
  v_staff boolean:=public.refund_staff_permission('cancel_reservation'); v_gross numeric; v_previous numeric;
  v_net numeric; v_base numeric; v_deposit numeric; v_deduction numeric; v_refund numeric; v_allowed boolean;
  v_result jsonb; v_block text;
begin
  if p_initiator is null or p_initiator not in ('guest','resort') then raise exception 'Choose guest or resort cancellation' using errcode='22023'; end if;
  select * into r from public.reservations where reservation_id=p_reservation;
  if not found then raise exception 'Reservation not found' using errcode='22023'; end if;
  if auth.uid() is null or (not v_staff and (r.guest_id is distinct from auth.uid() or p_initiator<>'guest')) then
    raise exception 'Cancellation permission required' using errcode='42501'; end if;
  if p_initiator='resort' and not exists(select 1 from public.staff_users where id=auth.uid() and role='admin' and is_active) then
    raise exception 'Only an administrator may cancel for a resort-attributable reason' using errcode='42501'; end if;
  select * into t from public.transactions where reservation_id=p_reservation;
  if not found then raise exception 'Reservation bill not found' using errcode='22023'; end if;
  select * into p from public.booking_policy_versions where version=r.booking_policy_version;
  if not found then select * into p from public.booking_policy_versions order by version desc limit 1; end if;
  if not found then raise exception 'Booking policy is not configured' using errcode='22023'; end if;
  select coalesce(sum(amount),0) into v_gross from public.payments where reservation_id=p_reservation and status='verified';
  select coalesce(sum(amount),0) into v_previous from public.refund_requests where reservation_id=p_reservation and status='refunded';
  v_net:=round(greatest(v_gross-v_previous,0),2);
  v_base:=coalesce(t.cancellation_deposit_base,t.total_amount);
  v_deposit:=ceil(v_base*20)/100; -- Same cent rounding as the required 20% downpayment.
  v_deduction:=case when p_initiator='guest' then least(v_net,v_deposit) else 0 end;
  v_refund:=round(greatest(v_net-v_deduction,0),2);
  if r.checked_in_at is not null then v_block:='Checked-in reservations cannot be cancelled or rescheduled.';
  elsif r.status not in ('pending','payment_submitted','confirmed','reschedule_requested') then v_block:='This reservation cannot be cancelled.';
  elsif exists(select 1 from public.payments where reservation_id=p_reservation and status='pending') then v_block:='Review pending payments before cancelling.';
  elsif exists(select 1 from public.refund_requests where reservation_id=p_reservation and status='payout_submitted') then v_block:='Verify the existing refund transfer before cancelling.';
  elsif not v_staff and r.start_datetime-now()<make_interval(hours=>p.guest_cancellation_notice_hours) then v_block:='The guest cancellation notice window has passed. Contact the resort.';
  end if;
  v_allowed:=v_block is null;
  v_result:=jsonb_build_object('reservationId',p_reservation,'reference',r.reference_number,'initiator',p_initiator,
    'totalAmount',t.total_amount,'verifiedPaid',v_gross,'previousRefunds',v_previous,'netPaid',v_net,
    'depositBase',v_base,'depositAmount',v_deposit,'deduction',v_deduction,'refundableAmount',v_refund,
    'policyVersion',p.version,'noticeHours',p.guest_cancellation_notice_hours,'allowed',v_allowed,'blockedReason',v_block,
    'outcome',case when v_refund>0 then 'pending_refund' else 'no_refund' end,
    'rule',case when p_initiator='resort' then 'Full refund of remaining verified payments; no deposit deduction.'
      else 'The initial 20% deposit is retained. Only remaining verified payments above that deposit are refundable.' end);
  return v_result || jsonb_build_object('quote',md5(v_result::text));
end $$;
revoke all on function public.get_cancellation_preview(uuid,text) from public,anon;
grant execute on function public.get_cancellation_preview(uuid,text) to authenticated;


notify pgrst, 'reload schema';
commit;
