-- Apply after room-rates-discounts-migration.sql, swimming-room-addons-migration.sql
-- and private-swimming-room-reserve-migration.sql. Existing bookings keep their saved charges.
-- Start Standard and Family 8-hour rates at PHP 900; both remain editable in admin.
begin;
alter table public.room_classifications add column if not exists rate_8_hours numeric(12,2)
  check(rate_8_hours>0 and rate_8_hours<=1000000);
-- Publish a new version only when initializing the price. Re-running preserves admin edits.
with initialized as (
  update public.room_classifications set rate_8_hours=900,pricing_version=pricing_version+1
    where code in ('standard','family') and rate_8_hours is null returning *
)
insert into public.room_rate_versions(classification_id,version,rates)
  select classification_id,pricing_version,jsonb_build_object('rate_3_hours',rate_3_hours,'rate_8_hours',rate_8_hours,
    'rate_12_hours',rate_12_hours,'extension_hourly_rate',extension_hourly_rate,'additional_guest_rate',additional_guest_rate) from initialized;

create or replace function public.room_save_rates(p_staff uuid,p_classification uuid,p_version bigint,p_rates jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.room_classifications%rowtype; k text; n numeric; snapshot jsonb;
begin
  if not public.room_staff_allowed(p_staff,'configuration') then raise exception 'Admin access required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(73124,1);
  select * into c from public.room_classifications where classification_id=p_classification for update;
  if not found then raise exception 'Room classification not found' using errcode='22023'; end if;
  if p_version is distinct from c.pricing_version then raise exception 'Room rates changed. Reload rates before saving' using errcode='40001'; end if;
  foreach k in array array['rate_3_hours','rate_8_hours','rate_12_hours','extension_hourly_rate','additional_guest_rate'] loop
    if k='rate_8_hours' and (not p_rates ? k or p_rates->k='null'::jsonb) then continue; end if;
    n:=(p_rates->>k)::numeric;
    if n is null or n::text in ('NaN','Infinity','-Infinity') or n<0 or n>1000000 or round(n,2)<>n
      or (k<>'additional_guest_rate' and n=0) then raise exception 'Enter valid room prices using up to two decimal places' using errcode='22023'; end if;
  end loop;
  update public.room_classifications set rate_3_hours=(p_rates->>'rate_3_hours')::numeric,
    rate_8_hours=case when p_rates ? 'rate_8_hours' then (p_rates->>'rate_8_hours')::numeric else rate_8_hours end,
    rate_12_hours=(p_rates->>'rate_12_hours')::numeric,base_hours=12,base_rate=(p_rates->>'rate_12_hours')::numeric,
    additional_guest_rate=(p_rates->>'additional_guest_rate')::numeric,extension_hourly_rate=(p_rates->>'extension_hourly_rate')::numeric,
    pricing_version=pricing_version+1 where classification_id=p_classification returning * into c;
  snapshot:=jsonb_build_object('rate_3_hours',c.rate_3_hours,'rate_8_hours',c.rate_8_hours,'rate_12_hours',c.rate_12_hours,
    'extension_hourly_rate',c.extension_hourly_rate,'additional_guest_rate',c.additional_guest_rate);
  insert into public.room_rate_versions(classification_id,version,rates,created_by) values(p_classification,c.pricing_version,snapshot,p_staff);
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff,p_staff,'Updated room rates','room_classification',p_classification,snapshot||jsonb_build_object('version',c.pricing_version));
  return to_jsonb(c);
end $$;

-- Patch the existing allocator so dedicated-room protections and inventory locks remain intact.
do $$ declare body text; old_rate text := 'case when hours<=3 then c.rate_3_hours else c.rate_12_hours end';
begin
  body:=pg_get_functiondef('public.swimming_allocate_rooms(uuid,uuid,jsonb,boolean)'::regprocedure);
  if position('c.rate_8_hours' in body)=0 then
    if position(old_rate in body)=0 then raise exception 'Apply the current swimming room add-ons migration first'; end if;
    body:=replace(body,old_rate,'case when hours<=3 then c.rate_3_hours when hours<=8 then c.rate_8_hours else c.rate_12_hours end');
    body:=replace(body,'    unit_price:=case when p_included then 0 else',
      '    if not p_included and hours>3 and hours<=8 and (c.rate_8_hours is null or c.rate_8_hours<=0) then'||chr(10)||
      '      raise exception ''The 8-hour room rate is not configured. Please contact the resort'' using errcode=''22023''; end if;'||chr(10)||
      '    unit_price:=case when p_included then 0 else');
    execute body;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
