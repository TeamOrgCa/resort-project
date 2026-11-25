-- Apply AFTER public-swimming-booking-migration.sql, advance-booking-window-migration.sql
-- and existing refund migrations. Keep this migration last when rebuilding.
-- Previous availability scanned from the first eligible session, returned only
-- bookable slots and used the generic 30-minute lead. The UI then bounded month
-- navigation to those dates and hid blocked/cutoff sessions. This replaces that
-- coupling with a complete monthly view and a separate today-through-today+2
-- booking RPC. All intervals retain the existing [start,end) overlap rule.
-- Rates, capacity, activation and hours remain in public_swimming_types.
-- Correct only the old seeded night schedule; retain custom operating hours and
-- all booked timestamps/pricing snapshots. Safe to apply more than once.
begin;
update public.public_swimming_types set start_time='18:00'
where mode='night' and start_time='16:00' and end_time='23:00' and end_day_offset=0;

-- Visibility is independent of eligibility. Return every configured session,
-- including closed/full/past sessions, with no reservation or guest identifiers.
-- p_now supports deterministic service-side tests; booking actions always use
-- the actual clock via public_booking_slots. No client may execute this RPC.
-- VOLATILE reads obtain fresh snapshots after the inventory lock is acquired.
create or replace function public.public_swimming_calendar(
  p_from date,p_to date,p_exclude uuid default null,p_now timestamptz default clock_timestamp()
) returns table(booking_date date,type_id uuid,starts_at timestamptz,ends_at timestamptz,
  remaining_capacity integer,availability text,eligibility text,opens_at timestamptz,evaluated_at timestamptz)
language plpgsql volatile security definer set search_path='' as $$
declare d date; c public.public_swimming_types%rowtype; s timestamptz; e timestamptz;
  used integer; today date:=(p_now at time zone 'Asia/Manila')::date;
begin
  if p_from is null or p_to is null or p_now is null or not isfinite(p_now)
    or not isfinite(p_from) or not isfinite(p_to) or p_to<p_from or p_to-p_from>31 then
    raise exception 'Choose a calendar interval of at most 32 days' using errcode='22023'; end if;
  for i in 0..(p_to-p_from) loop
    d:=p_from+i;
    for c in select * from public.public_swimming_types order by mode loop
      s:=(d+c.start_time) at time zone 'Asia/Manila';
      e:=(d+c.end_day_offset+c.end_time) at time zone 'Asia/Manila';
      select coalesce(sum(r.adult_count+r.child_count),0)::integer into used from public.reservations r
      where r.commercial_type='public_swimming' and not r.room_pricing and r.reservation_id is distinct from p_exclude
        and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
        and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>p_now)
        and r.start_datetime<e and r.end_datetime>s;
      remaining_capacity:=greatest(0,coalesce(c.max_guests,2147483647)-used);
      availability:=case
        when not c.is_active then 'inactive'
        when exists(select 1 from public.maintenance_blocks m where m.status='active' and m.start_datetime<e and m.end_datetime>s) then 'maintenance'
        when exists(select 1 from public.reservations r where r.commercial_type='private_swimming'
          and r.reservation_id is distinct from p_exclude and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
          and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>p_now)
          and r.start_datetime<e and r.end_datetime>s) then 'private'
        when remaining_capacity=0 then 'full' else 'available' end;
      if availability in ('private','maintenance','inactive') then remaining_capacity:=0; end if;
      eligibility:=case when d<today then 'past' when d>today+2 then 'not_open'
        when s<p_now+interval '1 hour' then 'cutoff' else 'eligible' end;
      booking_date:=d; type_id:=c.type_id; starts_at:=s; ends_at:=e;
      opens_at:=((d-2)+time '00:00') at time zone 'Asia/Manila'; evaluated_at:=p_now;
      return next;
    end loop;
  end loop;
end $$;

-- Keep the existing RPC contract for creation, rescheduling and staff editing.
-- A blocked today never shifts or extends today's rolling three-date window.
create or replace function public.public_booking_slots(p_exclude uuid default null)
returns table(booking_date date,type_id uuid,starts_at timestamptz,ends_at timestamptz,remaining_capacity integer)
language plpgsql volatile security definer set search_path='' as $$
declare at_time timestamptz:=clock_timestamp(); today date:=(at_time at time zone 'Asia/Manila')::date;
begin
  return query select c.booking_date,c.type_id,c.starts_at,c.ends_at,c.remaining_capacity
    from public.public_swimming_calendar(today,today+2,p_exclude,at_time) c
    where c.availability='available' and c.eligibility='eligible' and c.remaining_capacity>0;
end $$;

-- Every pool claim uses the existing inventory lock. Revalidate all new claims
-- under that lock, including revived unpaid holds and increased guest counts.
-- Existing paid/submitted claims retain their allocation after the cutoff.
create or replace function public.pool_inventory_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.public_swimming_types%rowtype; slot record; used integer;
begin
  if current_setting('role',true) in ('anon','authenticated') and (tg_op='INSERT' and (new.public_type_id is not null or new.public_pricing_snapshot is not null or new.public_request_id is not null or new.public_admission_amount is not null or new.public_request_payload is not null)
    or tg_op='UPDATE' and (new.public_type_id,new.public_pricing_snapshot,new.public_request_id,new.public_request_payload,new.public_admission_amount)
      is distinct from (old.public_type_id,old.public_pricing_snapshot,old.public_request_id,old.public_request_payload,old.public_admission_amount)
    or tg_op='UPDATE' and old.commercial_type='public_swimming' and (new.start_datetime,new.end_datetime,new.adult_count,new.child_count,new.booking_mode) is distinct from (old.start_datetime,old.end_datetime,old.adult_count,old.child_count,old.booking_mode)) then
    raise exception 'Use the authorized public swimming booking action' using errcode='42501'; end if;
  if new.status not in ('pending','payment_submitted','confirmed','reschedule_requested') then return new; end if;
  perform pg_advisory_xact_lock(73124,1);
  if new.status='pending' and new.payment_deadline_at<=clock_timestamp() then return new; end if;
  if new.commercial_type='private_swimming' and exists(select 1 from public.reservations r where r.commercial_type='public_swimming' and not r.room_pricing
    and r.reservation_id is distinct from new.reservation_id and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
    and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>clock_timestamp())
    and r.start_datetime<new.end_datetime and r.end_datetime>new.start_datetime) then
    raise exception 'Private swimming conflicts with public swimming admissions' using errcode='40001'; end if;
  if new.commercial_type='public_swimming' and not new.room_pricing then
    if new.public_type_id is null or new.public_pricing_snapshot is null then raise exception 'Choose a configured public swimming session' using errcode='22023'; end if;
    if exists(select 1 from public.reservations r where r.commercial_type='private_swimming' and r.reservation_id is distinct from new.reservation_id
      and r.status in ('pending','payment_submitted','confirmed','reschedule_requested') and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>clock_timestamp())
      and r.start_datetime<new.end_datetime and r.end_datetime>new.start_datetime) then raise exception 'Public swimming conflicts with a private reservation' using errcode='40001'; end if;
    if exists(select 1 from public.maintenance_blocks m where m.status='active' and m.start_datetime<new.end_datetime and m.end_datetime>new.start_datetime) then
      raise exception 'Public swimming conflicts with maintenance' using errcode='40001'; end if;
    if tg_op='INSERT' or (new.start_datetime,new.end_datetime,new.public_type_id,new.commercial_type,new.room_pricing)
        is distinct from (old.start_datetime,old.end_datetime,old.public_type_id,old.commercial_type,old.room_pricing)
      or old.status not in ('pending','payment_submitted','confirmed','reschedule_requested')
      or old.status='pending' and old.payment_deadline_at<=clock_timestamp() then
      select * into slot from public.public_booking_slots(new.reservation_id) a
        where a.type_id=new.public_type_id and a.starts_at=new.start_datetime and a.ends_at=new.end_datetime;
      if slot is null or new.adult_count+new.child_count>slot.remaining_capacity then
        raise exception 'Public swimming session is unavailable or full. Reserve today or the next two calendar days, at least one hour before the session' using errcode='40001'; end if;
    elsif (new.adult_count,new.child_count) is distinct from (old.adult_count,old.child_count) then
      select * into c from public.public_swimming_types where type_id=new.public_type_id;
      select coalesce(sum(r.adult_count+r.child_count),0)::integer into used from public.reservations r
        where r.reservation_id is distinct from new.reservation_id and r.commercial_type='public_swimming' and not r.room_pricing
        and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
        and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>clock_timestamp())
        and r.start_datetime<new.end_datetime and r.end_datetime>new.start_datetime;
      if c.max_guests is not null and new.adult_count+new.child_count+used>c.max_guests then
        raise exception 'The public session has insufficient capacity' using errcode='40001'; end if;
    end if;
  end if;
  return new;
end $$;

-- Also serialize the opposite maintenance/public race. Existing maintenance
-- permissions, private booking rules and room checks remain in their guards.
create or replace function public.public_pool_maintenance_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='active' then
    perform pg_advisory_xact_lock(73124,1);
    if exists(select 1 from public.reservations r where r.commercial_type='public_swimming' and not r.room_pricing
      and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
      and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>clock_timestamp())
      and r.start_datetime<new.end_datetime and r.end_datetime>new.start_datetime) then
      raise exception 'Maintenance conflicts with public swimming admissions' using errcode='40001'; end if;
  end if;
  return new;
end $$;
drop trigger if exists public_pool_maintenance_guard on public.maintenance_blocks;
create trigger public_pool_maintenance_guard before insert or update on public.maintenance_blocks
for each row execute function public.public_pool_maintenance_guard();

-- Public pool admission has its own exact three-calendar-day policy. A shorter
-- generic advance limit must not silently override it. Keep the configured
-- generic limit and unchanged-date behavior for private and room reservations.
create or replace function public.enforce_advance_booking_window()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_value jsonb; v_days integer:=365; v_candidate numeric; v_last date;
begin
  if new.commercial_type='public_swimming' and not new.room_pricing then return new; end if;
  if tg_op='UPDATE' and new.start_datetime is not distinct from old.start_datetime then return new; end if;
  select setting_value into v_value from public.business_settings where setting_key='reservation.maximum_advance_booking_days';
  if jsonb_typeof(v_value)='number' then
    v_candidate:=v_value::text::numeric;
    if v_candidate between 0 and 3650 and v_candidate=trunc(v_candidate) then v_days:=v_candidate::integer; end if;
  end if;
  v_last:=(clock_timestamp() at time zone 'Asia/Manila')::date+v_days;
  if (new.start_datetime at time zone 'Asia/Manila')::date>v_last then
    raise exception 'Bookings are available only through % (Philippine time)',v_last using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function public.enforce_advance_booking_window() from public,anon,authenticated;

-- Correct the old error text without replacing the existing creation action.
do $$ declare body text; begin
  body:=pg_get_functiondef('public.public_reserve(uuid,uuid,jsonb,boolean)'::regprocedure);
  body:=replace(body,'Choose a session on one of the next three available public swimming dates',
    'Reserve public swimming today or the next two calendar days, at least one hour before the session; check remaining capacity');
  execute body;
end $$;
revoke all on function public.public_swimming_calendar(date,date,uuid,timestamptz),public.public_pool_maintenance_guard() from public,anon,authenticated;
grant execute on function public.public_swimming_calendar(date,date,uuid,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
