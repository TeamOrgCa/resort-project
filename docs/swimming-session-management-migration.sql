-- Apply LAST, after public-swimming-calendar, public-swimming-package-validation,
-- swimming-room-addons, private-swimming-room-reserve and package-times migrations.
-- Reuses business_settings, public_swimming_types and versioned private package times.
begin;
insert into public.business_settings(setting_key,setting_value) values ('swimming.sessions',
 '{"version":1,"defaultMode":"flexible","flexibleDays":3,"publicOnlyDays":30,"minimumAdvanceMinutes":60,"bufferMinutes":0,"sameDay":true,"active":{"day":true,"night":true},"weekly":{},"overrides":[]}')
on conflict(setting_key) do nothing;

create or replace function public.swimming_policy() returns jsonb
language sql volatile security definer set search_path='' as $$
 select setting_value from public.business_settings where setting_key='swimming.sessions';
$$;
create or replace function public.valid_swimming_policy(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; o jsonb; n numeric;
begin
 if jsonb_typeof(p) is distinct from 'object' or p->>'defaultMode' not in ('flexible','public_only','private_only')
   or p->>'defaultMode' is null or jsonb_typeof(p->'weekly') is distinct from 'object'
   or jsonb_typeof(p->'overrides') is distinct from 'array' or jsonb_array_length(p->'overrides')>500
   or jsonb_typeof(p->'sameDay') is distinct from 'boolean'
   or jsonb_typeof(p->'active'->'day') is distinct from 'boolean' or jsonb_typeof(p->'active'->'night') is distinct from 'boolean' then return false; end if;
 foreach k in array array['version','flexibleDays','publicOnlyDays','minimumAdvanceMinutes','bufferMinutes'] loop
   if jsonb_typeof(p->k) is distinct from 'number' then return false; end if;
   n:=(p->>k)::numeric;
   if n<>trunc(n) or n<(case when k in ('version','flexibleDays','publicOnlyDays') then 1 when k='minimumAdvanceMinutes' then 30 else 0 end)
     or n>(case when k='version' then 9007199254740991 when k='minimumAdvanceMinutes' then 10080 when k='bufferMinutes' then 1440 else 366 end) then return false; end if;
 end loop;
 for k,v in select * from jsonb_each(p->'weekly') loop
   if k !~ '^[0-6]$' or jsonb_typeof(v)<>'object' then return false; end if;
   if exists(select 1 from jsonb_each_text(v) e where e.key not in ('day','night') or e.value not in ('flexible','public_only','private_only') or e.value is null) then return false; end if;
 end loop;
 for o in select * from jsonb_array_elements(p->'overrides') loop
   if o->>'from' is null or o->>'to' is null or o->>'from' !~ '^\d{4}-\d{2}-\d{2}$' or o->>'to' !~ '^\d{4}-\d{2}-\d{2}$'
     or (o->>'to')::date<(o->>'from')::date or o->>'period' is null or o->>'period' not in ('day','night')
     or o->>'mode' is null or o->>'mode' not in ('flexible','public_only','private_only') then return false; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p->'overrides') with ordinality a(v,i)
   join jsonb_array_elements(p->'overrides') with ordinality b(v,i) on a.i<b.i
   where a.v->>'period'=b.v->>'period' and (a.v->>'from')::date<=(b.v->>'to')::date and (b.v->>'from')::date<=(a.v->>'to')::date) then return false; end if;
 return true;
exception when others then return false;
end $$;
create or replace function public.swimming_access(p_date date,p_period text) returns text
language sql volatile security definer set search_path='' as $$
 select coalesce((select o->>'mode' from jsonb_array_elements(p->'overrides') o
   where o->>'period'=p_period and p_date between (o->>'from')::date and (o->>'to')::date limit 1),
   p->'weekly'->(extract(dow from p_date)::integer::text)->>p_period,p->>'defaultMode')
 from (select public.swimming_policy() p) c;
$$;

-- Checks access for every physical session touched, including both dates of a
-- whole-day package. Time-based booking limits apply only to new/revived claims.
create or replace function public.swimming_policy_issue(p_start timestamptz,p_end timestamptz,p_kind text,p_booking boolean default true)
returns text language plpgsql volatile security definer set search_path='' as $$
declare p jsonb:=public.swimming_policy(); d date; period text; access text; c record; times jsonb; slot jsonb;
 s timestamptz; e timestamptz; now_at timestamptz:=clock_timestamp(); today date:=(now_at at time zone 'Asia/Manila')::date;
 arrival date:=(p_start at time zone 'Asia/Manila')::date; days integer;
begin
 if p_kind not in ('public_swimming','private_swimming') then return null; end if;
 if p_booking then
   if p_start<now_at+make_interval(mins=>(p->>'minimumAdvanceMinutes')::integer) then return 'Booking Cutoff Passed'; end if;
   if arrival=today and not (p->>'sameDay')::boolean then return 'Same-day swimming bookings are disabled'; end if;
   if p_kind='private_swimming' then
     select coalesce((setting_value::text)::integer,365) into days from public.business_settings where setting_key='reservation.maximum_advance_booking_days';
     if arrival>today+coalesce(days,365) then return 'Not Yet Open for Booking'; end if;
   end if;
 end if;
 if p_kind='public_swimming' then
   select * into c from public.public_swimming_types t where
     p_start=((arrival+t.start_time) at time zone 'Asia/Manila') and p_end=((arrival+t.end_day_offset+t.end_time) at time zone 'Asia/Manila');
   if not found then return 'Public swimming operating hours changed'; end if;
   if not c.is_active or not (p->'active'->>c.mode)::boolean then return 'Swimming session is disabled'; end if;
   access:=public.swimming_access(arrival,c.mode);
   if access='private_only' then return 'Private Only'; end if;
   days:=case when access='public_only' then (p->>'publicOnlyDays')::integer+1 else (p->>'flexibleDays')::integer end;
   if p_booking and arrival>today+days-1 then return 'Not Yet Open for Booking'; end if;
 else
   select t.times into times from public.package_rate_versions t order by version desc limit 1;
   for d in select generate_series(arrival-1,(p_end at time zone 'Asia/Manila')::date,interval '1 day')::date loop
     foreach period in array array['day','night'] loop
       slot:=times->period;
       s:=(d+(slot->>'start')::time) at time zone 'Asia/Manila';
       e:=(d+(slot->>'endDayOffset')::integer+(slot->>'end')::time) at time zone 'Asia/Manila';
       -- Union private and public hours: a private overnight claim must respect
       -- the next day's public session even when its hours have been customized.
       if p_start<e and p_end>s then
         if not (p->'active'->>period)::boolean then return 'Swimming session is disabled'; end if;
         if public.swimming_access(d,period)='public_only' then return 'Public Only'; end if;
       end if;
       for c in select * from public.public_swimming_types t where t.mode=period loop
         s:=(d+c.start_time) at time zone 'Asia/Manila'; e:=(d+c.end_day_offset+c.end_time) at time zone 'Asia/Manila';
         if p_start<e and p_end>s then
           if not (p->'active'->>period)::boolean then return 'Swimming session is disabled'; end if;
           if public.swimming_access(d,period)='public_only' then return 'Public Only'; end if;
         end if;
       end loop;
     end loop;
   end loop;
 end if;
 return null;
end $$;

-- Early guard supplements the existing inventory guard and exclusion constraint.
-- Keep room inventory and the existing public pricing/payment guards intact.
create or replace function public.swimming_claim_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare issue text; buffer interval; claim boolean;
begin
 if new.commercial_type not in ('public_swimming','private_swimming') or (new.commercial_type='public_swimming' and new.room_pricing)
   or new.status not in ('pending','payment_submitted','confirmed','reschedule_requested') then return new; end if;
 perform pg_advisory_xact_lock(73124,1);
 if new.status='pending' and new.payment_deadline_at<=clock_timestamp() then return new; end if;
 claim:=tg_op='INSERT';
 if tg_op='UPDATE' then
   claim:=(new.start_datetime,new.end_datetime,new.commercial_type,new.room_pricing,new.public_type_id) is distinct from
     (old.start_datetime,old.end_datetime,old.commercial_type,old.room_pricing,old.public_type_id)
     or old.status not in ('pending','payment_submitted','confirmed','reschedule_requested')
     or old.status='pending' and old.payment_deadline_at<=clock_timestamp();
 end if;
 if claim then
   issue:=public.swimming_policy_issue(new.start_datetime,new.end_datetime,new.commercial_type);
   if issue is not null then raise exception '%',issue using errcode='40001'; end if;
 end if;
 buffer:=make_interval(mins=>(public.swimming_policy()->>'bufferMinutes')::integer);
 if exists(select 1 from public.maintenance_blocks b where b.status='active'
   and b.start_datetime<new.end_datetime+buffer and b.end_datetime+buffer>new.start_datetime) then
   raise exception 'Unavailable — Maintenance (including cleaning and preparation buffer)' using errcode='40001'; end if;
 if exists(select 1 from public.reservations r where r.reservation_id is distinct from new.reservation_id
   and r.commercial_type in ('private_swimming','public_swimming') and not (r.commercial_type='public_swimming' and r.room_pricing)
   and (new.commercial_type='private_swimming' or r.commercial_type='private_swimming'
     or r.public_type_id is distinct from new.public_type_id or r.start_datetime<>new.start_datetime)
   and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
   and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>clock_timestamp())
   and r.start_datetime<new.end_datetime+buffer and r.end_datetime+buffer>new.start_datetime) then
   raise exception 'Pool unavailable: overlapping reservation or cleaning and preparation buffer' using errcode='40001';
 end if;
 return new;
end $$;
drop trigger if exists a_swimming_claim_guard on public.reservations;
create trigger a_swimming_claim_guard before insert or update on public.reservations for each row execute function public.swimming_claim_guard();

-- Configuration writes use the same lock as pool claims. Validate existing
-- allocations without retroactively applying advance windows or cutoffs.
create or replace function public.assert_swimming_allocations() returns void
language plpgsql security definer set search_path='' as $$
declare conflicts jsonb; buffer interval:=make_interval(mins=>(public.swimming_policy()->>'bufferMinutes')::integer);
begin
 select jsonb_agg(jsonb_build_object('reservationId',r.reservation_id,'referenceNumber',r.reference_number,
   'startDatetime',r.start_datetime,'endDatetime',r.end_datetime,'status',r.status,'reason',
   coalesce(public.swimming_policy_issue(r.start_datetime,r.end_datetime,r.commercial_type,false),'Capacity or preparation buffer conflicts with an existing allocation')))
 into conflicts from public.reservations r
 where r.commercial_type in ('public_swimming','private_swimming') and not (r.commercial_type='public_swimming' and r.room_pricing)
   and r.end_datetime>clock_timestamp() and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
   and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>clock_timestamp())
   and (public.swimming_policy_issue(r.start_datetime,r.end_datetime,r.commercial_type,false) is not null
     or r.commercial_type='public_swimming' and exists(select 1 from public.public_swimming_types t where t.type_id=r.public_type_id and t.max_guests is not null
       and t.max_guests<(select coalesce(sum(a.adult_count+a.child_count),0) from public.reservations a
         where a.commercial_type='public_swimming' and not (a.commercial_type='public_swimming' and a.room_pricing) and a.start_datetime<r.end_datetime and a.end_datetime>r.start_datetime
         and a.status in ('pending','payment_submitted','confirmed','reschedule_requested')
         and (a.status<>'pending' or a.payment_deadline_at is null or a.payment_deadline_at>clock_timestamp())))
     or exists(select 1 from public.maintenance_blocks b where b.status='active' and b.start_datetime<r.end_datetime+buffer and b.end_datetime+buffer>r.start_datetime)
     or exists(select 1 from public.reservations a where a.reservation_id<>r.reservation_id
       and a.commercial_type in ('public_swimming','private_swimming') and not (a.commercial_type='public_swimming' and a.room_pricing)
       and (a.commercial_type='private_swimming' or r.commercial_type='private_swimming' or a.public_type_id is distinct from r.public_type_id or a.start_datetime<>r.start_datetime)
       and a.status in ('pending','payment_submitted','confirmed','reschedule_requested')
       and (a.status<>'pending' or a.payment_deadline_at is null or a.payment_deadline_at>clock_timestamp())
       and a.start_datetime<r.end_datetime+buffer and a.end_datetime+buffer>r.start_datetime));
 if conflicts is not null then raise exception 'Schedule changes conflict with existing reservations or active payment holds'
   using errcode='40001',detail=conflicts::text; end if;
end $$;
create or replace function public.swimming_configuration_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
   if old.setting_key='swimming.sessions' then raise exception 'Swimming session configuration cannot be deleted. Use session activation controls' using errcode='22023'; end if;
   return old;
 end if;
 if tg_table_name='business_settings' then
   if new.setting_key<>'swimming.sessions' then return new; end if;
   if not public.valid_swimming_policy(new.setting_value) then raise exception 'Enter valid swimming policies and non-overlapping date overrides' using errcode='22023'; end if;
 end if;
 perform pg_advisory_xact_lock(73124,1);
 if tg_when='AFTER' and current_setting('app.swimming_config_save',true) is distinct from 'true' then perform public.assert_swimming_allocations(); end if;
 return new;
end $$;
drop trigger if exists swimming_configuration_lock on public.business_settings;
drop trigger if exists swimming_configuration_check on public.business_settings;
drop trigger if exists swimming_configuration_delete on public.business_settings;
create trigger swimming_configuration_lock before insert or update on public.business_settings for each row execute function public.swimming_configuration_guard();
create trigger swimming_configuration_check after insert or update on public.business_settings for each row execute function public.swimming_configuration_guard();
create trigger swimming_configuration_delete before delete on public.business_settings for each row execute function public.swimming_configuration_guard();
drop trigger if exists swimming_configuration_lock on public.public_swimming_types;
drop trigger if exists swimming_configuration_check on public.public_swimming_types;
create trigger swimming_configuration_lock before insert or update on public.public_swimming_types for each row execute function public.swimming_configuration_guard();
create trigger swimming_configuration_check after insert or update on public.public_swimming_types for each row execute function public.swimming_configuration_guard();

create or replace function public.save_swimming_policy(p_policy jsonb,p_expected_version bigint,p_public jsonb,p_times jsonb,p_package_version bigint,p_private_days integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous jsonb; item jsonb; package record; public_before jsonb; private_before jsonb;
begin
 if not exists(select 1 from public.staff_users where id=actor and is_active and role='admin') then raise exception 'Admin access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(73124,1);
 select public.swimming_policy() into previous;
 if (previous->>'version')::bigint is distinct from p_expected_version then raise exception 'Swimming configuration changed. Reload before saving' using errcode='40001'; end if;
 if not public.valid_swimming_policy(p_policy) or jsonb_typeof(p_public) is distinct from 'array' or jsonb_array_length(p_public)<>2
   or p_private_days is null or p_private_days not between 0 and 3650 then raise exception 'Enter valid session policies' using errcode='22023'; end if;
 select * into package from public.package_rate_versions order by version desc limit 1;
 if package.version is distinct from p_package_version then raise exception 'Private package hours changed. Reload before saving' using errcode='40001'; end if;
 select jsonb_agg(to_jsonb(t)) into public_before from public.public_swimming_types t;
 select setting_value into private_before from public.business_settings where setting_key='reservation.maximum_advance_booking_days';
 -- Defer row checks inside this action: validate the complete proposed state once.
 perform set_config('app.swimming_config_save','true',true);
 update public.business_settings set setting_value=p_policy||jsonb_build_object('version',p_expected_version+1) where setting_key='swimming.sessions';
 for item in select * from jsonb_array_elements(p_public) loop
   if not exists(select 1 from public.public_swimming_types t where t.type_id=(item->>'type_id')::uuid and t.pricing_version=(item->>'pricing_version')::bigint) then
     raise exception 'Public session hours or capacity changed. Reload before saving' using errcode='40001'; end if;
   update public.public_swimming_types set start_time=(item->>'start_time')::time,end_time=(item->>'end_time')::time,
     end_day_offset=(item->>'end_day_offset')::integer,max_guests=(item->>'max_guests')::integer,is_active=(item->>'is_active')::boolean
     where type_id=(item->>'type_id')::uuid;
   if not found then raise exception 'Public session changed. Reload before saving' using errcode='40001'; end if;
 end loop;
 if (select count(distinct value->>'type_id') from jsonb_array_elements(p_public))<>2 then raise exception 'Choose each public session once' using errcode='22023'; end if;
 if package.times is distinct from p_times then perform public.publish_package_rates(package.rates,package.version,p_times); end if;
 insert into public.business_settings(setting_key,setting_value) values('reservation.maximum_advance_booking_days',to_jsonb(p_private_days))
   on conflict(setting_key) do update set setting_value=excluded.setting_value;
 perform public.assert_swimming_allocations();
 perform set_config('app.swimming_config_save','',true);
 insert into public.audit_logs(user_id,auth_user_id,action,entity_type,details) values(actor,actor,'Updated swimming session configuration','business_settings',
   jsonb_build_object('before',previous,'after',p_policy||jsonb_build_object('version',p_expected_version+1),'publicBefore',public_before,'publicAfter',p_public,
     'privateTimesBefore',package.times,'privateTimesAfter',p_times,'privateAdvanceDaysBefore',private_before,'privateAdvanceDaysAfter',p_private_days));
 return p_policy||jsonb_build_object('version',p_expected_version+1);
end $$;

revoke all on function public.swimming_policy(),public.valid_swimming_policy(jsonb),public.swimming_access(date,text),public.swimming_policy_issue(timestamptz,timestamptz,text,boolean),public.swimming_claim_guard(),public.assert_swimming_allocations(),public.swimming_configuration_guard() from public,anon,authenticated;
revoke all on function public.save_swimming_policy(jsonb,bigint,jsonb,jsonb,bigint,integer) from public,anon;
grant execute on function public.save_swimming_policy(jsonb,bigint,jsonb,jsonb,bigint,integer) to authenticated;
grant execute on function public.swimming_policy(),public.swimming_access(date,text) to service_role;
create or replace function public.swimming_maintenance_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare buffer interval:=make_interval(mins=>(public.swimming_policy()->>'bufferMinutes')::integer);
begin
 if new.status='active' then
   perform pg_advisory_xact_lock(73124,1);
   if exists(select 1 from public.reservations r where r.commercial_type in ('public_swimming','private_swimming') and not (r.commercial_type='public_swimming' and r.room_pricing)
     and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
     and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>clock_timestamp())
     and r.start_datetime<new.end_datetime+buffer and r.end_datetime+buffer>new.start_datetime) then
     raise exception 'Maintenance conflicts with a swimming reservation or preparation buffer' using errcode='40001'; end if;
 end if;
 return new;
end $$;
drop trigger if exists a_swimming_maintenance_guard on public.maintenance_blocks;
create trigger a_swimming_maintenance_guard before insert or update on public.maintenance_blocks for each row execute function public.swimming_maintenance_guard();
revoke all on function public.swimming_maintenance_guard() from public,anon,authenticated;
-- Calendar functions follow below.
drop function public.public_swimming_calendar(date,date,uuid,timestamptz);
create function public.public_swimming_calendar(p_from date,p_to date,p_exclude uuid default null,p_now timestamptz default clock_timestamp())
returns table(booking_date date,type_id uuid,starts_at timestamptz,ends_at timestamptz,remaining_capacity integer,
 availability text,eligibility text,opens_at timestamptz,evaluated_at timestamptz,access_mode text,cutoff_at timestamptz,total_capacity integer)
language plpgsql volatile security definer set search_path='' as $$
declare d date; c record; s timestamptz; e timestamptz; used integer; days integer;
 p jsonb:=public.swimming_policy(); today date:=(p_now at time zone 'Asia/Manila')::date;
 buffer interval:=make_interval(mins=>(p->>'bufferMinutes')::integer);
begin
 if p_from is null or p_to is null or p_now is null or not isfinite(p_now) or not isfinite(p_from) or not isfinite(p_to) or p_to<p_from or p_to-p_from>31 then
   raise exception 'Choose a calendar interval of at most 32 days' using errcode='22023'; end if;
 for i in 0..(p_to-p_from) loop
   d:=p_from+i;
   for c in select * from public.public_swimming_types order by mode loop
     s:=(d+c.start_time) at time zone 'Asia/Manila'; e:=(d+c.end_day_offset+c.end_time) at time zone 'Asia/Manila';
     access_mode:=public.swimming_access(d,c.mode);
     days:=case when access_mode='public_only' then (p->>'publicOnlyDays')::integer+1 else (p->>'flexibleDays')::integer end;
     select coalesce(sum(r.adult_count+r.child_count),0)::integer into used from public.reservations r
       where r.commercial_type='public_swimming' and not (r.commercial_type='public_swimming' and r.room_pricing) and r.reservation_id is distinct from p_exclude
       and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
       and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>p_now) and r.start_datetime<e and r.end_datetime>s;
     remaining_capacity:=greatest(0,coalesce(c.max_guests,2147483647)-used); total_capacity:=c.max_guests;
     availability:=case
       when not c.is_active or not (p->'active'->>c.mode)::boolean then 'inactive'
       when access_mode='private_only' then 'private_only'
       when exists(select 1 from public.maintenance_blocks m where m.status='active' and m.start_datetime<e+buffer and m.end_datetime+buffer>s) then 'maintenance'
       when exists(select 1 from public.reservations r where r.commercial_type='private_swimming' and not (r.commercial_type='public_swimming' and r.room_pricing)
         and r.reservation_id is distinct from p_exclude and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
         and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>p_now)
         and r.start_datetime<e+buffer and r.end_datetime+buffer>s) then 'private'
       when exists(select 1 from public.reservations r where r.commercial_type='public_swimming' and not (r.commercial_type='public_swimming' and r.room_pricing)
         and r.reservation_id is distinct from p_exclude and (r.public_type_id<>c.type_id or r.start_datetime<>s)
         and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
         and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>p_now)
         and r.start_datetime<e+buffer and r.end_datetime+buffer>s) then 'public'
       when remaining_capacity=0 then 'full' else 'available' end;
     if availability not in ('available','full') then remaining_capacity:=0; end if;
     cutoff_at:=s-make_interval(mins=>(p->>'minimumAdvanceMinutes')::integer);
     eligibility:=case when d<today then 'past' when access_mode='private_only' then 'restricted'
       when d>today+days-1 then 'not_open' when p_now>cutoff_at or d=today and not (p->>'sameDay')::boolean then 'cutoff' else 'eligible' end;
     booking_date:=d; type_id:=c.type_id; starts_at:=s; ends_at:=e;
     opens_at:=((d-days+1)+time '00:00') at time zone 'Asia/Manila'; evaluated_at:=p_now;
     return next;
   end loop;
 end loop;
end $$;
create or replace function public.public_booking_slots(p_exclude uuid default null)
returns table(booking_date date,type_id uuid,starts_at timestamptz,ends_at timestamptz,remaining_capacity integer)
language plpgsql volatile security definer set search_path='' as $$
declare at_time timestamptz:=clock_timestamp(); today date:=(at_time at time zone 'Asia/Manila')::date; last_day date; d date;
begin
 last_day:=today+greatest((public.swimming_policy()->>'flexibleDays')::integer-1,(public.swimming_policy()->>'publicOnlyDays')::integer);
 d:=today;
 while d<=last_day loop
   return query select c.booking_date,c.type_id,c.starts_at,c.ends_at,c.remaining_capacity
     from public.public_swimming_calendar(d,least(d+31,last_day),p_exclude,at_time) c
     where c.availability='available' and c.eligibility='eligible' and c.remaining_capacity>0;
   d:=d+32;
 end loop;
end $$;

-- Private previews use the same policy evaluator as booking writes. No guest or
-- reservation identifiers leave this RPC. Load the previous day for overnight.
create or replace function public.private_swimming_calendar(p_from date,p_to date,p_exclude uuid default null)
returns table(booking_date date,period text,starts_at timestamptz,ends_at timestamptz,access_mode text,reason text)
language plpgsql volatile security definer set search_path='' as $$
declare d date; m text; times jsonb; slot jsonb; buffer interval:=make_interval(mins=>(public.swimming_policy()->>'bufferMinutes')::integer);
begin
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<p_from or p_to-p_from>32 then raise exception 'Invalid calendar interval' using errcode='22023'; end if;
 select t.times into times from public.package_rate_versions t order by version desc limit 1;
 for d in select generate_series(p_from,p_to,interval '1 day')::date loop
   foreach m in array array['day','night'] loop
     slot:=times->m; booking_date:=d; period:=m; access_mode:=public.swimming_access(d,m);
     starts_at:=(d+(slot->>'start')::time) at time zone 'Asia/Manila';
     ends_at:=(d+(slot->>'endDayOffset')::integer+(slot->>'end')::time) at time zone 'Asia/Manila';
     reason:=public.swimming_policy_issue(starts_at,ends_at,'private_swimming',false);
     if reason is null then reason:=public.swimming_policy_issue(starts_at,ends_at,'private_swimming'); end if;
     if reason is null and exists(select 1 from public.maintenance_blocks b where b.status='active' and b.start_datetime<ends_at+buffer and b.end_datetime+buffer>starts_at) then reason:='Unavailable — Maintenance'; end if;
     if reason is null then
       select case when r.commercial_type='public_swimming' then 'Unavailable — Public Reservation' else 'Unavailable — Private Reservation' end into reason
         from public.reservations r where r.reservation_id is distinct from p_exclude and not (r.commercial_type='public_swimming' and r.room_pricing)
         and r.commercial_type in ('private_swimming','public_swimming') and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
         and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>clock_timestamp())
         and r.start_datetime<ends_at+buffer and r.end_datetime+buffer>starts_at limit 1;
     end if;
     return next;
   end loop;
 end loop;
end $$;

-- Lock before private package publication as well, including the existing
-- Catalog editor. Historical versions and reserved timestamps remain intact.
drop trigger if exists swimming_configuration_lock on public.package_rate_versions;
drop trigger if exists swimming_configuration_check on public.package_rate_versions;
create trigger swimming_configuration_lock before insert or update on public.package_rate_versions for each row execute function public.swimming_configuration_guard();
create trigger swimming_configuration_check after insert or update on public.package_rate_versions for each row execute function public.swimming_configuration_guard();

-- Always acquire pool inventory before the package catalog table lock, matching
-- reservation trigger order and avoiding a publication/booking lock inversion.
do $$ declare body text; begin
 body:=pg_get_functiondef('public.publish_package_rates(jsonb,bigint,jsonb)'::regprocedure);
 if position('pg_advisory_xact_lock(73124,1)' in body)=0 then
   body:=replace(body,'lock table public.package_rate_versions in share row exclusive mode;',
     'perform pg_advisory_xact_lock(73124,1); lock table public.package_rate_versions in share row exclusive mode;');
   execute body;
 end if;
end $$;

-- Remove stale error messages from the retained pricing/rescheduling actions.
do $$ declare name text; body text; begin
 foreach name in array array['public.public_reserve(uuid,uuid,jsonb,boolean)','public.public_reschedule_booking(uuid,uuid,timestamp with time zone,timestamp with time zone,timestamp with time zone,numeric,text,boolean)','public.pool_inventory_guard()'] loop
   body:=pg_get_functiondef(name::regprocedure);
   body:=replace(body,'Reserve public swimming today or the next two calendar days, at least one hour before the session; check remaining capacity','This swimming session is unavailable under the configured booking policy; refresh the calendar');
   body:=replace(body,'The public session is unavailable. Choose a date within the three-day public window','The public session is unavailable under the configured booking policy');
   body:=replace(body,'Public swimming session is unavailable or full. Reserve today or the next two calendar days, at least one hour before the session','Public swimming session is unavailable or full under the configured booking policy');
   execute body;
 end loop;
end $$;
revoke all on function public.public_swimming_calendar(date,date,uuid,timestamptz),public.private_swimming_calendar(date,date,uuid) from public,anon,authenticated;
grant execute on function public.public_swimming_calendar(date,date,uuid,timestamptz),public.private_swimming_calendar(date,date,uuid) to service_role;
notify pgrst,'reload schema';
commit;
