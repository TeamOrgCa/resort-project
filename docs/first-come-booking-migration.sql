-- Apply after reservation-lifecycle-migration.sql. Run on a test project first.
-- If existing active reservations overlap, adding the constraint fails and this
-- transaction rolls back, leaving the previous constraint in place.
begin;

-- This runs inside the same statement and transaction as the insert or date
-- change. The exclusion constraint arbitrates concurrent claims after due
-- holds are released; the first committed claimant keeps the date.
create or replace function public.release_expired_holds_for_claim()
returns trigger language plpgsql security definer set search_path = '' as $$
declare claim_day date;
begin
  if new.status in ('pending', 'payment_submitted', 'confirmed', 'reschedule_requested') then
    if new.end_datetime <= new.start_datetime or
       new.end_datetime > new.start_datetime + interval '366 days' then
      raise exception 'Booking date range is invalid or too long' using errcode = '22023';
    end if;
    -- Lock all claimed Manila dates in a stable order. This prevents two
    -- overlapping claims from racing through expiry cleanup.
    for claim_day in
      select day::date from generate_series(
        (new.start_datetime at time zone 'Asia/Manila')::date,
        (new.end_datetime at time zone 'Asia/Manila')::date -
          case when (new.end_datetime at time zone 'Asia/Manila')::time = time '00:00:00' then 1 else 0 end,
        interval '1 day'
      ) as dates(day) order by day
    loop
      perform pg_advisory_xact_lock(424242, hashtext(claim_day::text));
    end loop;

    update public.reservations r set status = 'expired'
    where r.status = 'pending'
      and r.payment_deadline_at <= clock_timestamp()
      and r.reservation_id is distinct from new.reservation_id
      and daterange(
        (r.start_datetime at time zone 'Asia/Manila')::date,
        (r.end_datetime at time zone 'Asia/Manila')::date +
          case when (r.end_datetime at time zone 'Asia/Manila')::time = time '00:00:00' then 0 else 1 end,
        '[)'
      ) && daterange(
        (new.start_datetime at time zone 'Asia/Manila')::date,
        (new.end_datetime at time zone 'Asia/Manila')::date +
          case when (new.end_datetime at time zone 'Asia/Manila')::time = time '00:00:00' then 0 else 1 end,
        '[)'
      );
  end if;
  return new;
end $$;

drop trigger if exists release_expired_holds_on_insert on public.reservations;
create trigger release_expired_holds_on_insert
before insert on public.reservations for each row
execute function public.release_expired_holds_for_claim();

drop trigger if exists release_expired_holds_on_date_change on public.reservations;
create trigger release_expired_holds_on_date_change
before update of start_datetime, end_datetime on public.reservations for each row
execute function public.release_expired_holds_for_claim();

-- Keep a durable record of each hold and each release in the same transaction.
create or replace function public.audit_booking_slot_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare action_name text;
begin
  if tg_op = 'DELETE' then
    insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id)
    values (
      case when exists (select 1 from public.staff_users where id = auth.uid()) then auth.uid() else null end,
      auth.uid(), 'Deleted booking hold', 'reservation', old.reservation_id
    );
    return old;
  end if;

  if tg_op = 'INSERT' and new.status in ('pending', 'payment_submitted', 'confirmed', 'reschedule_requested') then
    action_name := 'Reserved booking date';
    insert into public.reservation_status_logs(reservation_id, old_status, new_status, changed_by)
    values (new.reservation_id, null, new.status,
      case when exists (select 1 from public.staff_users where id = auth.uid()) then auth.uid() else null end);
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'expired' then action_name := 'Released unpaid booking date after 30 minutes';
    elsif new.status in ('cancelled', 'rejected') then action_name := 'Released booking date';
    end if;
  end if;

  if action_name is not null then
    insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id)
    values (
      case when exists (select 1 from public.staff_users where id = auth.uid()) then auth.uid() else null end,
      auth.uid(), action_name, 'reservation', new.reservation_id
    );
  end if;
  return new;
end $$;

drop trigger if exists audit_booking_slot_change_trigger on public.reservations;
create trigger audit_booking_slot_change_trigger
after insert or update of status or delete on public.reservations for each row
execute function public.audit_booking_slot_change();

-- Audit overdue releases, then install the resort-wide uniqueness rule.
select public.expire_unpaid_reservations();

alter table public.reservations drop constraint if exists one_active_reservation_per_guest_date;
alter table public.reservations drop constraint if exists one_active_reservation_per_date;
alter table public.reservations add constraint one_active_reservation_per_date
  exclude using gist (
    (daterange(
      (start_datetime at time zone 'Asia/Manila')::date,
      (end_datetime at time zone 'Asia/Manila')::date +
        case when (end_datetime at time zone 'Asia/Manila')::time = time '00:00:00' then 0 else 1 end,
      '[)'
    )) with &&
  ) where (status in ('pending', 'payment_submitted', 'confirmed', 'reschedule_requested'));

commit;
