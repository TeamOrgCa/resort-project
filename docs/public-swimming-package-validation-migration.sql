-- Apply AFTER package-times-migration.sql, public-swimming-booking-migration.sql
-- and public-swimming-calendar-migration.sql. Safe to apply more than once.
-- The legacy package trigger compared Public Night (18:00–23:00) with private
-- Overnight (18:00–06:00 next day), rejecting valid public reservations.
-- Public pool claims are validated by public_reserve/public_booking_slots and
-- pool_inventory_guard against public_swimming_types, under the inventory lock.
-- Retain private package validation and immutable historical rate versions.
begin;
create or replace function public.set_reservation_package_rate_version()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_schedule public.package_rate_versions%rowtype; v_matches boolean;
begin
  if tg_op='UPDATE' then
    if new.package_rate_version is distinct from old.package_rate_version then
      raise exception 'Booked package rates cannot be replaced' using errcode='22023'; end if;
    return new;
  end if;
  if new.commercial_type='public_swimming' and not new.room_pricing then
    return new;
  end if;
  lock table public.package_rate_versions in share mode;
  select * into v_schedule from public.package_rate_versions order by version desc limit 1;
  if v_schedule.version is null then raise exception 'Package rates are not configured' using errcode='22023'; end if;
  if new.package_rate_version is not null and new.package_rate_version<>v_schedule.version then
    raise exception 'Package prices or times changed. Refresh and review the booking again' using errcode='40001'; end if;
  new.package_rate_version:=v_schedule.version;
  if new.booking_mode in ('day','night') then
    v_matches:=public.matches_package_slot(new.start_datetime,new.end_datetime,v_schedule.times->new.booking_mode);
  elsif new.booking_mode='whole_day' then
    v_matches:=public.matches_package_slot(new.start_datetime,new.end_datetime,v_schedule.times->'whole_day'->'day_to_night')
      or public.matches_package_slot(new.start_datetime,new.end_datetime,v_schedule.times->'whole_day'->'night_to_day');
  else return new;
  end if;
  if not coalesce(v_matches,false) then
    raise exception 'Choose the saved package time slot. Refresh the booking form' using errcode='22023'; end if;
  return new;
end $$;
revoke all on function public.set_reservation_package_rate_version() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
