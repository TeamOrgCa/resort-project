-- Apply AFTER room-management-migration.sql and promo-usage-limits-migration.sql.
-- Existing reservations, charges, extensions and paid amounts are preserved.
begin;
alter table public.room_classifications add column if not exists rate_3_hours numeric(12,2) not null default 300 check(rate_3_hours>0);
alter table public.room_classifications add column if not exists rate_12_hours numeric(12,2) not null default 900 check(rate_12_hours>0);
alter table public.room_classifications add column if not exists pricing_version bigint not null default 1;
alter table public.reservations add column if not exists room_pricing boolean not null default false;
alter table public.room_assignments add column if not exists pricing_snapshot jsonb;
create or replace function public.guard_room_commercial_type() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated') and
    ((tg_op='INSERT' and (new.commercial_type<>'private_swimming' or new.room_pricing)) or
     (tg_op='UPDATE' and (new.commercial_type is distinct from old.commercial_type or new.room_pricing is distinct from old.room_pricing))) then
    raise exception 'Use the authorized room reservation action' using errcode='42501'; end if;
  return new;
end $$;

create table if not exists public.room_rate_versions (
  classification_id uuid not null references public.room_classifications,
  version bigint not null, rates jsonb not null, created_by uuid references public.staff_users(id),
  created_at timestamptz not null default clock_timestamp(), primary key(classification_id,version)
);
-- Initialize once; preserve deliberately configured legacy rates. The previous
-- seed extension rate was 100, while the requested new default is 150.
update public.room_classifications c set
  rate_3_hours=case when base_hours=3 and base_rate>0 then base_rate else rate_3_hours end,
  rate_12_hours=case when base_hours=12 and base_rate>0 then base_rate else rate_12_hours end,
  base_rate=case when base_rate=0 then 900 else base_rate end,
  extension_hourly_rate=case when extension_hourly_rate=100 and not exists(
    select 1 from public.room_activity a join public.physical_rooms r using(room_id)
    where r.classification_id=c.classification_id and a.activity_type='configure'
  ) then 150 else extension_hourly_rate end
where not exists(select 1 from public.room_rate_versions v where v.classification_id=c.classification_id);
alter table public.room_classifications alter column extension_hourly_rate set default 150;
insert into public.room_rate_versions(classification_id,version,rates)
  select classification_id,pricing_version,jsonb_build_object('rate_3_hours',rate_3_hours,'rate_12_hours',rate_12_hours,
    'extension_hourly_rate',extension_hourly_rate,'additional_guest_rate',additional_guest_rate)
  from public.room_classifications on conflict do nothing;
drop trigger if exists room_immutable on public.room_rate_versions;
create trigger room_immutable before update or delete on public.room_rate_versions for each row execute function public.room_immutable();
alter table public.room_rate_versions enable row level security;
revoke all on public.room_rate_versions from public,anon,authenticated;
grant select,insert on public.room_rate_versions to service_role;

create or replace function public.room_save_rates(p_staff uuid,p_classification uuid,p_version bigint,p_rates jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.room_classifications%rowtype; k text; n numeric;
begin
  if not public.room_staff_allowed(p_staff,'configuration') then raise exception 'Admin access required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(73124,1);
  select * into c from public.room_classifications where classification_id=p_classification for update;
  if not found then raise exception 'Room classification not found' using errcode='22023'; end if;
  if p_version is distinct from c.pricing_version then raise exception 'Room rates changed. Reload rates before saving' using errcode='40001'; end if;
  foreach k in array array['rate_3_hours','rate_12_hours','extension_hourly_rate','additional_guest_rate'] loop
    n:=(p_rates->>k)::numeric;
    if n is null or n::text in ('NaN','Infinity','-Infinity') or n<0 or n>1000000 or round(n,2)<>n
      or (k<>'additional_guest_rate' and n=0) then raise exception 'Enter valid room prices using up to two decimal places' using errcode='22023'; end if;
  end loop;
  update public.room_classifications set rate_3_hours=(p_rates->>'rate_3_hours')::numeric,
    rate_12_hours=(p_rates->>'rate_12_hours')::numeric,base_hours=12,base_rate=(p_rates->>'rate_12_hours')::numeric,
    additional_guest_rate=(p_rates->>'additional_guest_rate')::numeric,extension_hourly_rate=(p_rates->>'extension_hourly_rate')::numeric,
    pricing_version=pricing_version+1 where classification_id=p_classification returning * into c;
  insert into public.room_rate_versions(classification_id,version,rates,created_by) values(p_classification,c.pricing_version,p_rates,p_staff);
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff,p_staff,'Updated room rates','room_classification',p_classification,p_rates||jsonb_build_object('version',c.pricing_version));
  return to_jsonb(c);
end $$;

-- All pricing, physical inventory, promo holds and the existing transaction bill
-- commit together. A stale quote or invalid promo leaves no partial booking.
create or replace function public.room_reserve_priced(p_staff uuid,p_room uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.physical_rooms%rowtype; c public.room_classifications%rowtype;
  heads integer; duration integer; extra integer; eligible integer; start_at timestamptz; finish timestamptz;
  base numeric; additions numeric; extension numeric; gross numeric; net numeric;
  wid uuid; rid uuid; aid uuid; cid uuid; ref text; result jsonb; snapshot jsonb;
begin
  if not public.room_staff_allowed(p_staff,'room_operations') or not public.room_staff_allowed(p_staff,'rooms') or
    not exists(select 1 from public.staff_users s where s.id=p_staff and s.is_active and (s.role='admin' or exists(
      select 1 from public.role_permissions rp where rp.role=s.role and 'create_reservation'=any(rp.permissions)))) then
    raise exception 'Room reservation permission required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(73124,1);
  select * into r from public.physical_rooms where room_id=p_room for update;
  select * into c from public.room_classifications where classification_id=r.classification_id for update;
  if not found or not r.is_active then raise exception 'Select an active physical room' using errcode='22023'; end if;
  if (p_input->>'pricing_version')::bigint is distinct from c.pricing_version then raise exception 'Room rates changed. Refresh the room quote' using errcode='40001'; end if;
  heads:=(p_input->>'occupants')::integer; duration:=(p_input->>'duration_hours')::integer;
  extra:=(p_input->>'extension_hours')::integer; eligible:=(p_input->>'eligible_guests')::integer;
  if heads is null or heads<1 or heads>c.maximum_capacity or duration is null or duration not in (3,12) or
    extra is null or extra<0 or extra>168 or eligible is null or eligible<0 or eligible>heads then
    raise exception 'Choose a 3-hour or 12-hour stay, valid extension hours and guest counts' using errcode='22023'; end if;
  start_at:=(p_input->>'starts_at')::timestamptz; finish:=start_at+make_interval(hours=>duration+extra);
  if start_at is null or not isfinite(start_at) or start_at<=clock_timestamp() or
    (p_input->>'ends_at')::timestamptz is distinct from finish then raise exception 'Review the scheduled check-in and calculated checkout' using errcode='22023'; end if;
  if length(btrim(coalesce(p_input->>'first_name','')))<1 or length(btrim(coalesce(p_input->>'last_name','')))<1 or
    length(btrim(coalesce(p_input->>'address','')))<3 or coalesce(p_input->>'phone','') !~ '^\+639[0-9]{9}$' then
    raise exception 'Enter the guest name, Philippine mobile number and address' using errcode='22023'; end if;
  if coalesce(p_input->>'commercial_type','') not in ('private_swimming','public_swimming','room_accommodation') then
    raise exception 'Choose a valid reservation type' using errcode='22023'; end if;
  base:=case when duration=3 then c.rate_3_hours else c.rate_12_hours end;
  additions:=greatest(0,heads-c.included_capacity)*c.additional_guest_rate; extension:=extra*c.extension_hourly_rate;
  if base<=0 or (extra>0 and c.extension_hourly_rate<=0) or (heads>c.included_capacity and c.additional_guest_rate<=0) then
    raise exception 'Configure room accommodation, extension and additional guest rates first' using errcode='22023'; end if;
  gross:=base+additions+extension;
  perform public.room_assert_available(p_room,start_at,finish);
  insert into public.walk_in_guests(first_name,last_name,phone_number,address)
    values(btrim(p_input->>'first_name'),btrim(p_input->>'last_name'),p_input->>'phone',btrim(p_input->>'address')) returning walk_in_guest_id into wid;
  insert into public.reservations(walk_in_guest_id,reference_number,booking_mode,booking_type,commercial_type,room_pricing,start_datetime,end_datetime,adult_count,child_count,status)
    values(wid,'RM-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),'custom','walk_in',p_input->>'commercial_type',true,start_at,finish,heads,0,'pending')
    returning reservation_id,reference_number into rid,ref;
  insert into public.transactions(reservation_id,total_amount,status) values(rid,0,'unpaid');
  snapshot:=jsonb_build_object('version',c.pricing_version,'duration_hours',duration,'accommodation',base,
    'extension_hours',extra,'extension_hourly_rate',c.extension_hourly_rate,'additional_guest_rate',c.additional_guest_rate);
  insert into public.room_assignments(room_id,reservation_id,occupants,starts_at,expected_checkout,pricing_snapshot)
    values(p_room,rid,heads,start_at,finish,snapshot) returning assignment_id into aid;
  insert into public.room_charges(room_id,reservation_id,kind,description,amount,created_by)
    values(p_room,rid,'accommodation',r.room_number||' accommodation ('||duration||' hours)',base,p_staff);
  if additions>0 then insert into public.room_charges(room_id,reservation_id,kind,description,amount,created_by)
    values(p_room,rid,'additional_guest',r.room_number||' additional guests',additions,p_staff); end if;
  if extra>0 then
    insert into public.room_charges(room_id,reservation_id,kind,description,amount,created_by)
      values(p_room,rid,'extension',r.room_number||' initial extension ('||extra||' hours)',extension,p_staff) returning charge_id into cid;
    insert into public.room_extensions(assignment_id,old_checkout,new_checkout,hours,hourly_rate,charge_id,approved_by)
      values(aid,start_at+make_interval(hours=>duration),finish,extra,c.extension_hourly_rate,cid,p_staff);
  end if;
  if eligible>0 or nullif(btrim(p_input->>'promo_code'),'') is not null then
    result:=public.set_booking_discount(rid,p_staff,eligible,p_input->>'promo_code',gross,p_input->>'discount_reason',false);
  end if;
  select total_amount into net from public.transactions where reservation_id=rid;
  if (p_input->>'expected_total')::numeric is distinct from net then raise exception 'Pricing or discount changed. Review the quote again' using errcode='40001'; end if;
  perform public.room_log(p_room,rid,p_staff,'reservation_created','Room assigned using configured stay rates',snapshot||jsonb_build_object('total',net));
  return jsonb_build_object('reservation_id',rid,'reference_number',ref,'total_amount',net,'discount',result);
end $$;

-- Retain existing operational workflows; intercept only pricing and creation.
do $$ begin
  if to_regprocedure('public.room_operate_base(uuid,uuid,text,jsonb)') is null then
    alter function public.room_operate(uuid,uuid,text,jsonb) rename to room_operate_base;
  end if;
end $$;
create or replace function public.room_operate(p_staff uuid,p_room uuid,p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; c uuid;
begin
  if p_action='reserve' then return public.room_reserve_priced(p_staff,p_room,p_input); end if;
  if p_action='configure' then
    perform pg_advisory_xact_lock(73124,1);
    select classification_id into c from public.physical_rooms where room_id=p_room;
    -- Validate and publish prices before delegating capacity/buffer changes.
    -- Any failure in the existing workflow rolls this publication back too.
    perform public.room_save_rates(p_staff,c,(p_input->>'pricing_version')::bigint,p_input);
    p_input:=p_input||jsonb_build_object('base_rate',p_input->'rate_12_hours','base_hours',12);
  end if;
  result:=public.room_operate_base(p_staff,p_room,p_action,p_input);
  return result;
end $$;
-- A room-only bill can be created under any commercial type. Its eligibility
-- basis is still the accommodation charge, never a guessed swimming package.
create or replace function public.booking_discount_package_price(p_reservation uuid)
returns numeric language plpgsql stable security definer set search_path='' as $$
declare r public.reservations%rowtype; rates jsonb; tier text; mode text; hours numeric; start_hour numeric; room_base numeric;
begin
  select * into r from public.reservations where reservation_id=p_reservation;
  if r.room_pricing or r.commercial_type<>'private_swimming' then
    select coalesce(sum(amount),0) into room_base from public.room_charges where reservation_id=p_reservation and kind='accommodation';
    return room_base;
  end if;
  select p.rates into rates from public.package_rate_versions p where p.version=r.package_rate_version;
  if rates is null then raise exception 'Booked package rates are unavailable' using errcode='22023'; end if;
  tier:=case when extract(isodow from r.start_datetime at time zone 'Asia/Manila') in (5,6,7) then 'weekend' else 'weekday' end;
  mode:=coalesce(r.booking_mode,'day');
  if mode='custom' then
    hours:=extract(epoch from r.end_datetime-r.start_datetime)/3600;
    start_hour:=extract(hour from r.start_datetime at time zone 'Asia/Manila')+extract(minute from r.start_datetime at time zone 'Asia/Manila')/60;
    select m into mode from (values('day',abs(hours-8)+abs(start_hour-8)),('night',abs(hours-12)+abs(start_hour-18)),
      ('whole_day',abs(hours-22)+least(abs(start_hour-8),abs(start_hour-18)))) options(m,score)
      order by score,(rates->tier->m->>'baseRate')::numeric limit 1;
  end if;
  return (rates->tier->mode->>'baseRate')::numeric;
end $$;

revoke all on function public.room_operate_base(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.room_save_rates(uuid,uuid,bigint,jsonb),public.room_reserve_priced(uuid,uuid,jsonb),public.room_operate(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.room_save_rates(uuid,uuid,bigint,jsonb),public.room_reserve_priced(uuid,uuid,jsonb),public.room_operate(uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
