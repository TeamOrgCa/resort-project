-- Apply after docs/manager-only-maintenance-migration.sql.
-- Protect direct RPC writes as well as the application form/API.
-- Existing records are retained. Releasing historical blocks remains allowed.
begin;

create or replace function public.validate_new_maintenance_period()
returns trigger language plpgsql set search_path='' as $$
declare v_now timestamptz := clock_timestamp();
begin
  if tg_op='UPDATE' and new.start_datetime is not distinct from old.start_datetime
    and new.end_datetime is not distinct from old.end_datetime then return new; end if;
  if new.start_datetime is null or new.end_datetime is null
    or not isfinite(new.start_datetime) or not isfinite(new.end_datetime)
    or new.end_datetime <= new.start_datetime then
    raise exception 'The end date and time must be later than the start date and time (Philippine time)' using errcode='22023';
  end if;
  if (new.start_datetime at time zone 'Asia/Manila')::date < (v_now at time zone 'Asia/Manila')::date then
    raise exception 'Maintenance cannot start on a past date (Philippine time)' using errcode='22023';
  end if;
  if new.end_datetime <= v_now then
    raise exception 'The maintenance end time must still be in the future (Philippine time)' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function public.validate_new_maintenance_period() from public,anon,authenticated;
drop trigger if exists validate_new_maintenance_period on public.maintenance_blocks;
create trigger validate_new_maintenance_period before insert or update of start_datetime,end_datetime
on public.maintenance_blocks for each row execute function public.validate_new_maintenance_period();

commit;
