-- Run once in the Supabase SQL Editor after reviewing existing duplicate rows.
-- Asia/Manila calendar dates are the reservation-date authority.
create extension if not exists pg_cron;
begin;

alter table public.reservations enable row level security;
drop policy if exists "Guests can view own reservations" on public.reservations;
create policy "Guests can view own reservations" on public.reservations for select to authenticated
  using (guest_id = auth.uid());
drop policy if exists "Guests can create pending reservations" on public.reservations;
create policy "Guests can create pending reservations" on public.reservations for insert to authenticated
  with check (guest_id = auth.uid() and status = 'pending');
drop policy if exists "Guests can cancel own reservations" on public.reservations;
create policy "Guests can cancel own reservations" on public.reservations for update to authenticated
  using (guest_id = auth.uid()) with check (guest_id = auth.uid() and status = 'cancelled');
drop policy if exists "Guests can delete unpaid reservations" on public.reservations;
create policy "Guests can delete unpaid reservations" on public.reservations for delete to authenticated
  using (guest_id = auth.uid() and status = 'pending');
drop policy if exists "Staff can manage reservations" on public.reservations;
create policy "Staff can manage reservations" on public.reservations for all to authenticated
  using (exists (select 1 from public.staff_users where id = auth.uid() and is_active))
  with check (exists (select 1 from public.staff_users where id = auth.uid() and is_active));

alter table public.reservations drop constraint if exists no_overlapping_reservations;
alter table public.reservations drop constraint if exists reservations_status_check;
alter table public.reservations add constraint reservations_status_check
  check (status in ('pending', 'payment_submitted', 'confirmed', 'expired', 'rejected',
                   'cancelled', 'completed', 'reschedule_requested'));
alter table public.reservations add column if not exists payment_deadline_at timestamptz;

-- Existing submitted proofs remain reviewable. Old unpaid requests get their original deadline.
update public.reservations r set status = 'payment_submitted'
where r.status = 'pending' and exists (
  select 1 from public.payments p where p.reservation_id = r.reservation_id and p.status = 'pending'
);
update public.reservations set payment_deadline_at = created_at + interval '30 minutes'
where status = 'pending' and payment_deadline_at is null;
update public.reservations set status = 'expired'
where status = 'pending' and payment_deadline_at <= now();

create extension if not exists btree_gist;
alter table public.reservations drop constraint if exists one_active_reservation_per_guest_date;
alter table public.reservations add constraint one_active_reservation_per_guest_date
  exclude using gist (
    guest_id with =,
    (daterange(
      (start_datetime at time zone 'Asia/Manila')::date,
      (end_datetime at time zone 'Asia/Manila')::date +
        case when (end_datetime at time zone 'Asia/Manila')::time = time '00:00:00' then 0 else 1 end,
      '[)'
    )) with &&
  ) where (guest_id is not null and status in
    ('pending', 'payment_submitted', 'confirmed', 'reschedule_requested'));

create unique index if not exists one_pending_payment_per_reservation
  on public.payments(reservation_id) where status = 'pending';
alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check
  check (status in ('pending', 'verified', 'rejected'));
alter table public.payments add column if not exists rejected_by uuid references public.staff_users(id);
alter table public.payments add column if not exists rejected_at timestamptz;

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
      (old.status = 'confirmed' and new.status in ('cancelled', 'completed', 'reschedule_requested')) or
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

-- Guest status changes must not put a guest UUID into the staff-only audit FK.
create or replace function public.log_reservation_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status is distinct from new.status then
    insert into public.reservation_status_logs(reservation_id, old_status, new_status, changed_by)
    values (new.reservation_id, old.status, new.status,
      case when exists (select 1 from public.staff_users where id = auth.uid())
        then auth.uid() else null end);
  end if;
  return new;
end $$;

create or replace function public.accept_payment_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.reservations%rowtype;
begin
  select * into r from public.reservations where reservation_id = new.reservation_id for update;
  if not found then raise exception 'Reservation not found' using errcode = '23503'; end if;
  if r.status = 'pending' then
    if r.payment_deadline_at is null or clock_timestamp() >= r.payment_deadline_at then
      raise exception 'Payment deadline has expired' using errcode = 'P0001';
    end if;
    update public.reservations set status = 'payment_submitted'
      where reservation_id = r.reservation_id;
  elsif r.status <> 'confirmed' then
    raise exception 'Reservation cannot accept payment in state %', r.status using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists accept_payment_submission_trigger on public.payments;
create trigger accept_payment_submission_trigger after insert on public.payments
for each row execute function public.accept_payment_submission();

create or replace function public.guard_payment_review()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.reservations%rowtype;
begin
  if new.status is not distinct from old.status then
    raise exception 'Payment has already been reviewed or unchanged' using errcode = '23514';
  end if;
  if old.status <> 'pending' or new.status not in ('verified', 'rejected') then
    raise exception 'Payment has already been reviewed or transition is invalid' using errcode = '23514';
  end if;
  if not exists (select 1 from public.staff_users
    where id = auth.uid() and is_active = true and role in ('admin', 'cashier')) then
    raise exception 'Only admin or cashier can review payments' using errcode = '42501';
  end if;
  select * into r from public.reservations where reservation_id = new.reservation_id for update;
  if r.status not in ('payment_submitted', 'confirmed') then
    raise exception 'Reservation cannot be reviewed in state %', r.status using errcode = '23514';
  end if;
  if new.status = 'verified' then
    new.verified_by := auth.uid();
    new.verified_at := clock_timestamp();
  else
    new.rejected_by := auth.uid();
    new.rejected_at := clock_timestamp();
  end if;
  return new;
end $$;
drop trigger if exists guard_payment_review_trigger on public.payments;
create trigger guard_payment_review_trigger before update of status on public.payments
for each row execute function public.guard_payment_review();

create or replace function public.finish_payment_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'pending' and new.status in ('verified', 'rejected') then
    if new.status = 'verified' then
      update public.reservations set status = 'confirmed'
        where reservation_id = new.reservation_id and status = 'payment_submitted';
    else
      update public.reservations set status = 'rejected'
        where reservation_id = new.reservation_id and status = 'payment_submitted';
    end if;
    insert into public.audit_logs(user_id, action, entity_type, entity_id)
      values (auth.uid(), case when new.status = 'verified' then 'Approved payment verification'
        else 'Rejected payment verification' end, 'payment', new.payment_id);
  end if;
  return new;
end $$;
drop trigger if exists finish_payment_review_trigger on public.payments;
create trigger finish_payment_review_trigger after update of status on public.payments
for each row execute function public.finish_payment_review();

create or replace function public.expire_unpaid_reservations()
returns integer language plpgsql security definer set search_path = public as $$
declare changed_count integer;
begin
  with due as (
    select reservation_id from public.reservations
    where status = 'pending' and payment_deadline_at <= clock_timestamp()
    for update skip locked
  )
  update public.reservations r set status = 'expired'
  from due where r.reservation_id = due.reservation_id;
  get diagnostics changed_count = row_count;
  return changed_count;
end $$;
revoke all on function public.expire_unpaid_reservations() from public, anon, authenticated;
grant execute on function public.expire_unpaid_reservations() to service_role;

drop policy if exists "Staff can verify payments" on public.payments;
create policy "Admin and cashier can review payments" on public.payments for update to authenticated
using (exists (select 1 from public.staff_users where id = auth.uid() and is_active and role in ('admin', 'cashier')))
with check (exists (select 1 from public.staff_users where id = auth.uid() and is_active and role in ('admin', 'cashier')));

-- Supabase pg_cron runs independently of website traffic.
select cron.schedule('expire-unpaid-reservations', '* * * * *',
  'select public.expire_unpaid_reservations()');

commit;
