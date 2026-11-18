-- Apply after the existing booking, reschedule and business-settings migrations.
-- Uses the existing business_settings record. Existing schedules are retained.
begin;
create or replace function public.enforce_advance_booking_window()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_value jsonb; v_days integer:=365; v_candidate numeric; v_last date;
begin
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
drop trigger if exists enforce_advance_booking_window on public.reservations;
create trigger enforce_advance_booking_window before insert or update of start_datetime on public.reservations
for each row execute function public.enforce_advance_booking_window();
notify pgrst,'reload schema';
commit;
