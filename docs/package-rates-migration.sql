-- Run after the existing reservation and audit tables are installed.
-- Prices are versioned; booking times remain fixed in the booking policy.
begin;
alter table public.audit_logs add column if not exists details jsonb;

create or replace function public.valid_package_rates(p_rates jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_tier text; v_mode text; v_rate jsonb; v_base numeric; v_extra numeric;
begin
  if jsonb_typeof(p_rates) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p_rates)) <> 2 then return false; end if;
  foreach v_tier in array array['weekday', 'weekend'] loop
    if jsonb_typeof(p_rates->v_tier) is distinct from 'object' then return false; end if;
    if (select count(*) from jsonb_object_keys(p_rates->v_tier)) <> 3 then return false; end if;
    foreach v_mode in array array['day', 'night', 'whole_day'] loop
      v_rate := p_rates->v_tier->v_mode;
      if jsonb_typeof(v_rate) is distinct from 'object' then return false; end if;
      if (select count(*) from jsonb_object_keys(v_rate)) <> 2
        or jsonb_typeof(v_rate->'baseRate') is distinct from 'number'
        or jsonb_typeof(v_rate->'addOnPerHead') is distinct from 'number' then return false; end if;
      v_base := (v_rate->>'baseRate')::numeric;
      v_extra := (v_rate->>'addOnPerHead')::numeric;
      if v_base <= 0 or v_extra < 0 or v_base > 999999 or v_extra > 999999
        or v_base <> round(v_base, 2) or v_extra <> round(v_extra, 2) then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

create table if not exists public.package_rate_versions (
  version bigint generated always as identity primary key,
  rates jsonb not null check (public.valid_package_rates(rates)),
  created_by uuid references public.staff_users(id),
  created_at timestamptz not null default now()
);
alter table public.package_rate_versions enable row level security;
revoke all on public.package_rate_versions from anon, authenticated;
grant select on public.package_rate_versions to authenticated;
grant all on public.package_rate_versions to service_role;
drop policy if exists "Admins read package rate history" on public.package_rate_versions;
create policy "Admins read package rate history" on public.package_rate_versions for select to authenticated
  using (exists (select 1 from public.staff_users where id = auth.uid() and is_active and role = 'admin'));

-- Initial values from RESORT_CONTEXT.md. All later prices come from the admin editor.
insert into public.package_rate_versions(rates)
select '{"weekday":{"day":{"baseRate":7500,"addOnPerHead":125},"night":{"baseRate":9500,"addOnPerHead":175},"whole_day":{"baseRate":14500,"addOnPerHead":225}},"weekend":{"day":{"baseRate":8000,"addOnPerHead":150},"night":{"baseRate":10000,"addOnPerHead":200},"whole_day":{"baseRate":15000,"addOnPerHead":250}}}'::jsonb
where not exists (select 1 from public.package_rate_versions);

create or replace function public.get_package_rates(p_version bigint default null)
returns table(version bigint, rates jsonb) language sql stable security definer set search_path = '' as $$
  select p.version, p.rates from public.package_rate_versions p
  where p_version is null or p.version = p_version order by p.version desc limit 1;
$$;
revoke all on function public.get_package_rates(bigint) from public;
grant execute on function public.get_package_rates(bigint) to anon, authenticated, service_role;

create or replace function public.publish_package_rates(p_rates jsonb, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_previous public.package_rate_versions%rowtype; v_version bigint;
begin
  if not exists (select 1 from public.staff_users where id = v_actor and is_active and role = 'admin') then
    raise exception 'Only an active administrator may change package rates' using errcode = '42501';
  end if;
  if not public.valid_package_rates(p_rates) then
    raise exception 'Enter all six valid package prices and extra-person charges' using errcode = '22023';
  end if;
  lock table public.package_rate_versions in share row exclusive mode;
  select * into v_previous from public.package_rate_versions order by version desc limit 1;
  if p_expected_version is distinct from v_previous.version then
    raise exception 'Package rates changed. Reload before saving' using errcode = '40001';
  end if;
  if p_rates = v_previous.rates then return v_previous.version; end if;
  insert into public.package_rate_versions(rates, created_by) values(p_rates, v_actor) returning version into v_version;
  insert into public.audit_logs(user_id, auth_user_id, action, entity_type, details)
    values(v_actor, v_actor, 'Updated swimming package rates', 'package_rates',
      jsonb_build_object('previous_version', v_previous.version, 'version', v_version, 'before', v_previous.rates, 'after', p_rates));
  return v_version;
end $$;
revoke all on function public.publish_package_rates(jsonb,bigint) from public, anon;
grant execute on function public.publish_package_rates(jsonb,bigint) to authenticated;

alter table public.reservations add column if not exists package_rate_version bigint references public.package_rate_versions(version);
-- Existing reservations used the old seeded prices. Attach that immutable version
-- without changing any transaction, payment, receipt or invoice amounts.
update public.reservations set package_rate_version = (select min(version) from public.package_rate_versions)
where package_rate_version is null;

create or replace function public.set_reservation_package_rate_version()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_version bigint;
begin
  if tg_op = 'UPDATE' then
    if new.package_rate_version is distinct from old.package_rate_version then
      raise exception 'Booked package rates cannot be replaced' using errcode = '22023';
    end if;
    return new;
  end if;
  -- Serialize inserts with publishing so a quote never silently uses a new rate.
  lock table public.package_rate_versions in share mode;
  select version into v_version from public.package_rate_versions order by version desc limit 1;
  if v_version is null then raise exception 'Package rates are not configured' using errcode = '22023'; end if;
  if new.package_rate_version is not null and new.package_rate_version <> v_version then
    raise exception 'Package rates changed. Refresh and review the total again' using errcode = '40001';
  end if;
  new.package_rate_version := v_version;
  return new;
end $$;
drop trigger if exists reservation_package_rate_version on public.reservations;
create trigger reservation_package_rate_version before insert or update of package_rate_version on public.reservations
for each row execute function public.set_reservation_package_rate_version();
commit;
