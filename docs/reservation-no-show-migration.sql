-- Apply after the reservation lifecycle, stay completion, timed maintenance,
-- reservation management and manager-cashier refund workflow migrations.
-- Safe to reapply. Existing reservations, bills, payments and refunds are preserved.
-- Manager-only; confirmed reservations without attendance, after scheduled departure.
begin;
alter table public.reservations add column if not exists no_show_at timestamptz;
alter table public.reservations add column if not exists no_show_by uuid references public.staff_users(id);
alter table public.reservations add column if not exists no_show_reason text;
alter table public.reservations drop constraint if exists reservations_status_check;
alter table public.reservations add constraint reservations_status_check
  check(status in ('pending','payment_submitted','confirmed','expired','rejected','cancelled','completed','reschedule_requested','no_show'));
alter table public.reservations drop constraint if exists reservation_no_show_metadata_check;
alter table public.reservations add constraint reservation_no_show_metadata_check check(
  (status='no_show' and no_show_at is not null and no_show_by is not null and char_length(btrim(coalesce(no_show_reason,''))) between 5 and 2000)
  or (status<>'no_show' and no_show_at is null and no_show_by is null and no_show_reason is null)
);

create or replace function public.reservation_state_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not exists (
      select 1 from public.staff_users where id = auth.uid() and is_active
    ) and (new.guest_id is distinct from auth.uid() or new.status <> 'pending') then
      raise exception 'Guests may only create pending reservations for themselves' using errcode = '42501';
    end if;
    if auth.uid() is not null and not exists (
      select 1 from public.staff_users where id = auth.uid() and is_active
    ) then
      if new.start_datetime <= clock_timestamp() then
        raise exception 'Reservation must start in the future' using errcode = '23514';
      end if;
      new.booking_type := 'online';
      new.walk_in_guest_id := null;
    end if;
    if new.status = 'pending' then
      new.payment_deadline_at := clock_timestamp() + interval '30 minutes';
    end if;
  else
    if auth.uid() is not null and old.guest_id = auth.uid() and not exists (
      select 1 from public.staff_users where id = auth.uid() and is_active
    ) and (new.status <> 'cancelled' or new.start_datetime is distinct from old.start_datetime
      or new.end_datetime is distinct from old.end_datetime or new.guest_id is distinct from old.guest_id
      or new.payment_deadline_at is distinct from old.payment_deadline_at
      or new.reference_number is distinct from old.reference_number
      or new.booking_mode is distinct from old.booking_mode
      or new.booking_type is distinct from old.booking_type
      or new.adult_count is distinct from old.adult_count
      or new.child_count is distinct from old.child_count
      or new.walk_in_guest_id is distinct from old.walk_in_guest_id
      or new.special_requests is distinct from old.special_requests) then
      raise exception 'Guests may only cancel their own reservations' using errcode = '42501';
    end if;
    if old.status is distinct from new.status and not (
      (old.status = 'pending' and new.status in ('payment_submitted', 'confirmed', 'expired', 'cancelled', 'reschedule_requested')) or
      (old.status = 'payment_submitted' and new.status in ('confirmed', 'rejected', 'cancelled', 'reschedule_requested')) or
      (old.status = 'confirmed' and new.status in ('cancelled', 'completed', 'reschedule_requested', 'no_show')) or
      (old.status = 'reschedule_requested' and new.status in ('pending', 'payment_submitted', 'confirmed', 'cancelled'))
    ) then
      raise exception 'Invalid reservation state transition: % to %', old.status, new.status using errcode = '23514';
    end if;
    if old.status is distinct from new.status and new.status = 'confirmed' and not exists (
      select 1 from public.payments where reservation_id = new.reservation_id and status = 'verified'
    ) then
      raise exception 'A verified payment is required to confirm a reservation' using errcode = '23514';
    end if;
    if old.status is distinct from new.status and new.status = 'payment_submitted' and not exists (
      select 1 from public.payments where reservation_id = new.reservation_id and status = 'pending'
    ) then
      raise exception 'A submitted payment is required' using errcode = '23514';
    end if;
    if old.status is distinct from new.status and new.status = 'expired' and
      (old.payment_deadline_at is null or clock_timestamp() < old.payment_deadline_at) then
      raise exception 'Payment deadline has not passed' using errcode = '23514';
    end if;
    if old.status is distinct from new.status and new.status = 'rejected' and not exists (
      select 1 from public.payments where reservation_id = new.reservation_id and status = 'rejected'
    ) then
      raise exception 'A rejected payment is required to reject a reservation' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists reservation_state_guard_trigger on public.reservations;
create trigger reservation_state_guard_trigger before insert or update on public.reservations
for each row execute function public.reservation_state_guard();

-- Browser roles must use the manager endpoint. The service-only RPC supplies the
-- authenticated actor and server timestamp; existing markers are immutable.
create or replace function public.guard_reservation_no_show()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.status='no_show' or new.no_show_at is not null or new.no_show_by is not null or new.no_show_reason is not null then
      raise exception 'Use the manager no-show action on a confirmed reservation' using errcode='42501';
    end if;
    return new;
  end if;
  if new.no_show_at is distinct from old.no_show_at or new.no_show_by is distinct from old.no_show_by
    or new.no_show_reason is distinct from old.no_show_reason or (new.status is distinct from old.status and (new.status='no_show' or old.status='no_show')) then
    if current_user in ('anon','authenticated') then raise exception 'Use the manager no-show action' using errcode='42501'; end if;
    if old.status='no_show' then raise exception 'A no-show record cannot be reopened or rewritten' using errcode='40001'; end if;
    if new.status<>'no_show' or old.status<>'confirmed' or old.checked_in_at is not null or old.checked_out_at is not null then
      raise exception 'Only a confirmed reservation without attendance can be marked as a no-show' using errcode='40001'; end if;
    if old.end_datetime>=clock_timestamp() then raise exception 'No show is available only after the scheduled end time' using errcode='40001'; end if;
    if not exists(select 1 from public.staff_users s join public.role_permissions rp on rp.role=s.role
      where s.id=new.no_show_by and s.role='staff' and s.is_active and 'edit_reservation'=any(rp.permissions)) then
      raise exception 'Manager reservation-edit permission required' using errcode='42501'; end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_reservation_no_show on public.reservations;
create trigger guard_reservation_no_show before insert or update on public.reservations
for each row execute function public.guard_reservation_no_show();

-- Lock the same reservation as payment submission and check-in to serialize races.
create or replace function public.mark_reservation_no_show(p_reservation uuid,p_staff uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype;
begin
  if not exists(select 1 from public.staff_users s join public.role_permissions rp on rp.role=s.role
    where s.id=p_staff and s.role='staff' and s.is_active and 'edit_reservation'=any(rp.permissions)) then
    raise exception 'Only an active manager with Edit reservations permission can record a no-show' using errcode='42501'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 5 and 2000 then
    raise exception 'Enter a no-show reason between 5 and 2000 characters' using errcode='22023'; end if;
  select * into r from public.reservations where reservation_id=p_reservation for update;
  if not found then raise exception 'Reservation not found' using errcode='P0002'; end if;
  if r.status='no_show' then return to_jsonb(r)||jsonb_build_object('alreadyMarkedNoShow',true); end if;
  if r.status<>'confirmed' or r.checked_in_at is not null or r.checked_out_at is not null then
    raise exception 'Only a confirmed reservation without attendance can be marked as a no-show' using errcode='40001'; end if;
  if r.end_datetime>=clock_timestamp() then raise exception 'No show is available only after the scheduled end time' using errcode='40001'; end if;
  if exists(select 1 from public.payments where reservation_id=p_reservation and status='pending') then
    raise exception 'Review pending payments before recording a no-show' using errcode='40001'; end if;
  if exists(select 1 from public.reservation_reschedules where reservation_id=p_reservation and status='pending') then
    raise exception 'Resolve pending reschedule requests before recording a no-show' using errcode='40001'; end if;
  if exists(select 1 from public.refund_requests where reservation_id=p_reservation and status in ('pending','reviewed','approved','payout_submitted')) then
    raise exception 'Resolve the open refund before recording a no-show' using errcode='40001'; end if;
  update public.reservations set status='no_show',no_show_at=clock_timestamp(),no_show_by=p_staff,no_show_reason=btrim(p_reason)
    where reservation_id=p_reservation returning * into r;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff,p_staff,'Marked reservation No show','reservation',p_reservation,jsonb_build_object(
      'reference_number',r.reference_number,'old_status','confirmed','new_status','no_show','no_show_at',r.no_show_at,
      'reason',r.no_show_reason,'start_datetime',r.start_datetime,'end_datetime',r.end_datetime));
  if r.guest_id is not null then
    insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
      values('guest',r.guest_id,p_staff,'Reservation marked No show',
        format('Reservation %s was marked No show because no guest arrival was recorded. Contact the resort if this is incorrect.',r.reference_number),
        '/manage','reservation',p_reservation);
  end if;
  return to_jsonb(r)||jsonb_build_object('alreadyMarkedNoShow',false);
end $$;
revoke all on function public.mark_reservation_no_show(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.mark_reservation_no_show(uuid,uuid,text) to service_role;

-- Retain the existing bill and historical payments; closed no-shows cannot take
-- new payments, have payment evidence rewritten, or lose payment history.
create or replace function public.guard_no_show_payments()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_ids uuid[];
begin
  if tg_op='INSERT' then v_ids:=array[new.reservation_id];
  elsif tg_op='DELETE' then v_ids:=array[old.reservation_id];
  else v_ids:=array[old.reservation_id,new.reservation_id]; end if;
  perform 1 from public.reservations where reservation_id=any(v_ids) order by reservation_id for update;
  if exists(select 1 from public.reservations where reservation_id=any(v_ids) and status='no_show') then
    if tg_op in ('INSERT','DELETE') then raise exception 'No-show reservations cannot receive new payments or lose payment history' using errcode='40001'; end if;
    if new.reservation_id is distinct from old.reservation_id or new.amount is distinct from old.amount or new.status is distinct from old.status
      or to_jsonb(new)->'reference_number' is distinct from to_jsonb(old)->'reference_number'
      or to_jsonb(new)->'proof_path' is distinct from to_jsonb(old)->'proof_path' then
      raise exception 'No-show payment history is read-only' using errcode='40001'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists guard_no_show_payments on public.payments;
create trigger guard_no_show_payments before insert or update or delete on public.payments
for each row execute function public.guard_no_show_payments();
notify pgrst,'reload schema';
commit;
