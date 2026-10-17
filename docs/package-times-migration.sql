-- Apply AFTER package-rates-migration.sql in Supabase SQL Editor.
-- Existing versions receive the original fixed times; reservations keep their
-- booked version, exact arrival/departure timestamps, prices and payment history.
begin;

create or replace function public.valid_package_times(p_times jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare v_slot jsonb; v_key text; v_duration integer;
begin
  if jsonb_typeof(p_times) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p_times))<>3
    or jsonb_typeof(p_times->'whole_day') is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p_times->'whole_day'))<>2 then return false; end if;
  foreach v_key in array array['day','night','day_to_night','night_to_day'] loop
    v_slot:=case when v_key in ('day','night') then p_times->v_key else p_times->'whole_day'->v_key end;
    if jsonb_typeof(v_slot) is distinct from 'object' then return false; end if;
    if (select count(*) from jsonb_object_keys(v_slot))<>3
      or jsonb_typeof(v_slot->'start') is distinct from 'string'
      or jsonb_typeof(v_slot->'end') is distinct from 'string'
      or jsonb_typeof(v_slot->'endDayOffset') is distinct from 'number'
      or (v_slot->>'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or (v_slot->>'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or (v_slot->>'endDayOffset')::numeric not in (0,1) then return false; end if;
    v_duration:=extract(epoch from ((v_slot->>'end')::time-(v_slot->>'start')::time))::integer/60
      +(v_slot->>'endDayOffset')::integer*1440;
    if v_duration<=0 or v_duration>1440 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

alter table public.package_rate_versions add column if not exists times jsonb not null default
  '{"day":{"start":"08:00","end":"16:00","endDayOffset":0},"night":{"start":"18:00","end":"06:00","endDayOffset":1},"whole_day":{"day_to_night":{"start":"08:00","end":"06:00","endDayOffset":1},"night_to_day":{"start":"18:00","end":"16:00","endDayOffset":1}}}'::jsonb;
alter table public.package_rate_versions drop constraint if exists package_rate_versions_times_check;
alter table public.package_rate_versions add constraint package_rate_versions_times_check check(public.valid_package_times(times));

-- Return type gains a column, so PostgreSQL requires replacing the function.
drop function public.get_package_rates(bigint);
create function public.get_package_rates(p_version bigint default null)
returns table(version bigint,rates jsonb,times jsonb) language sql stable security definer set search_path='' as $$
  select p.version,p.rates,p.times from public.package_rate_versions p
  where p_version is null or p.version=p_version order by p.version desc limit 1;
$$;
revoke all on function public.get_package_rates(bigint) from public;
grant execute on function public.get_package_rates(bigint) to anon,authenticated,service_role;

drop function if exists public.publish_package_rates(jsonb,bigint);
create or replace function public.publish_package_rates(p_rates jsonb,p_expected_version bigint,p_times jsonb default null)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_previous public.package_rate_versions%rowtype; v_version bigint; v_times jsonb;
begin
  if not exists(select 1 from public.staff_users where id=v_actor and is_active and role='admin') then
    raise exception 'Only an active administrator may change package rates and times' using errcode='42501'; end if;
  lock table public.package_rate_versions in share row exclusive mode;
  select * into v_previous from public.package_rate_versions order by version desc limit 1;
  if p_expected_version is distinct from v_previous.version then
    raise exception 'Package prices or times changed. Reload before saving' using errcode='40001'; end if;
  v_times:=coalesce(p_times,v_previous.times);
  if not public.valid_package_rates(p_rates) or not public.valid_package_times(v_times) then
    raise exception 'Enter valid package prices and time slots lasting more than zero and no more than 24 hours' using errcode='22023'; end if;
  if p_rates=v_previous.rates and v_times=v_previous.times then return v_previous.version; end if;
  insert into public.package_rate_versions(rates,times,created_by) values(p_rates,v_times,v_actor) returning version into v_version;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,details)
    values(v_actor,v_actor,'Updated swimming package rates and time slots','package_rates',
      jsonb_build_object('previous_version',v_previous.version,'version',v_version,'before',v_previous.rates,'after',p_rates,
        'previous_times',v_previous.times,'times',v_times));
  return v_version;
end $$;
revoke all on function public.publish_package_rates(jsonb,bigint,jsonb) from public,anon;
grant execute on function public.publish_package_rates(jsonb,bigint,jsonb) to authenticated;

create or replace function public.matches_package_slot(p_start timestamptz,p_end timestamptz,p_slot jsonb)
returns boolean language sql immutable set search_path='' as $$
  select (p_start at time zone 'Asia/Manila')::time=(p_slot->>'start')::time
    and (p_end at time zone 'Asia/Manila')::time=(p_slot->>'end')::time
    and (p_end at time zone 'Asia/Manila')::date=(p_start at time zone 'Asia/Manila')::date+(p_slot->>'endDayOffset')::integer;
$$;

create or replace function public.set_reservation_package_rate_version()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_schedule public.package_rate_versions%rowtype; v_matches boolean;
begin
  if tg_op='UPDATE' then
    if new.package_rate_version is distinct from old.package_rate_version then
      raise exception 'Booked package rates cannot be replaced' using errcode='22023'; end if;
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
notify pgrst,'reload schema';
commit;
