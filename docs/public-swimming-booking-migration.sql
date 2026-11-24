-- Apply after room-online-time-slots-migration.sql and the current cancellation/refund migrations.
-- Configure Day/Night rates and operating hours in Business Catalog > Public swimming.
-- Initial prices and hours follow public/rates/pricing_marville.jpg. Existing settings are preserved.
begin;
create table if not exists public.public_swimming_types (
  type_id uuid primary key default gen_random_uuid(), mode text not null unique check(mode in ('day','night')),
  name text not null check(length(btrim(name)) between 2 and 100),
  start_time time not null, end_time time not null, end_day_offset integer not null default 0 check(end_day_offset in (0,1)),
  adult_rate numeric(12,2) not null check(adult_rate>0), child_rate numeric(12,2) not null check(child_rate>=0),
  max_guests integer check(max_guests between 1 and 10000), pricing_version bigint not null default 1,
  is_active boolean not null default true, created_at timestamptz not null default now(),
  check(extract(epoch from end_time)+end_day_offset*86400>extract(epoch from start_time)
    and extract(epoch from end_time)+end_day_offset*86400<=extract(epoch from start_time)+86400)
);
insert into public.public_swimming_types(mode,name,start_time,end_time,end_day_offset,adult_rate,child_rate)
values('day','Day Public Swimming','08:00','16:00',0,150,120),('night','Night Public Swimming','16:00','23:00',0,200,180)
on conflict(mode) do nothing;
alter table public.public_swimming_types enable row level security;
revoke all on public.public_swimming_types from anon,authenticated;
grant all on public.public_swimming_types to service_role;
alter table public.reservations add column if not exists public_type_id uuid references public.public_swimming_types;
alter table public.reservations add column if not exists public_pricing_snapshot jsonb;
alter table public.reservations add column if not exists public_admission_amount numeric(12,2);
alter table public.reservations add column if not exists public_request_id uuid;
alter table public.reservations add column if not exists public_request_payload jsonb;
alter table public.reservations add column if not exists adult_rate_at_booking numeric;
alter table public.reservations add column if not exists child_rate_at_booking numeric;
create unique index if not exists public_booking_request_unique on public.reservations(public_request_id) where public_request_id is not null;

create or replace function public.public_type_version() returns trigger language plpgsql set search_path='' as $$
begin
  perform pg_advisory_xact_lock(73124,1);
  if tg_op='UPDATE' then new.pricing_version:=old.pricing_version+1; end if;
  return new;
end $$;
drop trigger if exists public_type_version on public.public_swimming_types;
create trigger public_type_version before insert or update on public.public_swimming_types for each row execute function public.public_type_version();

create or replace function public.public_booking_slots(p_exclude uuid default null)
returns table(booking_date date,type_id uuid,starts_at timestamptz,ends_at timestamptz,remaining_capacity integer)
language plpgsql stable security definer set search_path='' as $$
declare d date; c public.public_swimming_types%rowtype; s timestamptz; e timestamptz; used integer; first_date date;
begin
  if not exists(select 1 from public.public_swimming_types where is_active) then return; end if;
  for i in 0..3650 loop
    d:=(clock_timestamp() at time zone 'Asia/Manila')::date+i;
    if first_date is not null and d>first_date+2 then return; end if;
    for c in select * from public.public_swimming_types where is_active order by mode loop
      s:=(d+c.start_time) at time zone 'Asia/Manila'; e:=(d+c.end_day_offset+c.end_time) at time zone 'Asia/Manila';
      if s<clock_timestamp()+interval '30 minutes' then continue; end if;
      if exists(select 1 from public.reservations r where r.commercial_type='private_swimming'
        and r.reservation_id is distinct from p_exclude and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
        and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>clock_timestamp())
        and r.start_datetime<e and r.end_datetime>s) or exists(select 1 from public.maintenance_blocks m
        where m.status='active' and m.start_datetime<e and m.end_datetime>s) then continue; end if;
      select coalesce(sum(r.adult_count+r.child_count),0)::integer into used from public.reservations r
        where r.commercial_type='public_swimming' and not r.room_pricing and r.reservation_id is distinct from p_exclude
        and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
        and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>clock_timestamp())
        and r.start_datetime<e and r.end_datetime>s;
      if used>=c.max_guests then continue; end if;
      booking_date:=d; type_id:=c.type_id; starts_at:=s; ends_at:=e; remaining_capacity:=coalesce(c.max_guests,2147483647)-used;
      if first_date is null then first_date:=d; end if;
      return next;
    end loop;
  end loop;
end $$;

-- Public admissions share the pools; private bookings require exclusive use.
-- All pool claims take the same lock as physical-room claims and maintenance.
create or replace function public.pool_inventory_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.public_swimming_types%rowtype; slot record;
begin
  if current_setting('role',true) in ('anon','authenticated') and (tg_op='INSERT' and (new.public_type_id is not null or new.public_pricing_snapshot is not null or new.public_request_id is not null or new.public_admission_amount is not null or new.public_request_payload is not null)
    or tg_op='UPDATE' and (new.public_type_id,new.public_pricing_snapshot,new.public_request_id,new.public_request_payload,new.public_admission_amount)
      is distinct from (old.public_type_id,old.public_pricing_snapshot,old.public_request_id,old.public_request_payload,old.public_admission_amount)
    or tg_op='UPDATE' and old.commercial_type='public_swimming' and (new.start_datetime,new.end_datetime,new.adult_count,new.child_count,new.booking_mode) is distinct from (old.start_datetime,old.end_datetime,old.adult_count,old.child_count,old.booking_mode)) then
    raise exception 'Use the authorized public swimming booking action' using errcode='42501'; end if;
  if new.status not in ('pending','payment_submitted','confirmed','reschedule_requested') then return new; end if;
  perform pg_advisory_xact_lock(73124,1);
  if new.commercial_type='private_swimming' and exists(select 1 from public.reservations r where r.commercial_type='public_swimming' and not r.room_pricing
    and r.reservation_id<>new.reservation_id and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
    and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>clock_timestamp())
    and r.start_datetime<new.end_datetime and r.end_datetime>new.start_datetime) then
    raise exception 'Private swimming conflicts with public swimming admissions' using errcode='40001'; end if;
  if new.commercial_type='public_swimming' and not new.room_pricing then
    if new.public_type_id is null or new.public_pricing_snapshot is null then raise exception 'Choose a configured public swimming session' using errcode='22023'; end if;
    if exists(select 1 from public.reservations r where r.commercial_type='private_swimming' and r.reservation_id<>new.reservation_id
      and r.status in ('pending','payment_submitted','confirmed','reschedule_requested') and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>clock_timestamp())
      and r.start_datetime<new.end_datetime and r.end_datetime>new.start_datetime) then raise exception 'Public swimming conflicts with a private reservation' using errcode='40001'; end if;
    if tg_op='INSERT' or (new.start_datetime,new.end_datetime) is distinct from (old.start_datetime,old.end_datetime)
      or old.status not in ('pending','payment_submitted','confirmed','reschedule_requested')
      or old.status='pending' and old.payment_deadline_at<=clock_timestamp() then
      select * into c from public.public_swimming_types where type_id=new.public_type_id and is_active;
      select * into slot from public.public_booking_slots(new.reservation_id) a where a.type_id=new.public_type_id and a.starts_at=new.start_datetime and a.ends_at=new.end_datetime;
      if slot is null or new.adult_count+new.child_count>slot.remaining_capacity then raise exception 'Public swimming session is unavailable or full. Choose one of the next three available dates' using errcode='40001'; end if;
    elsif (new.adult_count,new.child_count) is distinct from (old.adult_count,old.child_count) then
      select * into c from public.public_swimming_types where type_id=new.public_type_id;
      if c.max_guests is not null and new.adult_count+new.child_count+(select coalesce(sum(r.adult_count+r.child_count),0) from public.reservations r
        where r.reservation_id<>new.reservation_id and r.commercial_type='public_swimming' and not r.room_pricing
        and r.status in ('pending','payment_submitted','confirmed','reschedule_requested') and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>clock_timestamp())
        and r.start_datetime<new.end_datetime and r.end_datetime>new.start_datetime)>c.max_guests then raise exception 'The public session has insufficient capacity' using errcode='40001'; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists pool_inventory_guard on public.reservations;
create trigger pool_inventory_guard before insert or update on public.reservations for each row execute function public.pool_inventory_guard();

-- Preserve the existing room/private discount basis and non-stacking calculation.
do $$ begin
  if to_regprocedure('public.booking_discount_package_price_before_public(uuid)') is null then
    alter function public.booking_discount_package_price(uuid) rename to booking_discount_package_price_before_public;
  end if;
end $$;
create or replace function public.booking_discount_package_price(p_reservation uuid) returns numeric
language plpgsql stable security definer set search_path='' as $$
declare r public.reservations%rowtype;
begin
  select * into r from public.reservations where reservation_id=p_reservation;
  if r.commercial_type='public_swimming' and not r.room_pricing then return coalesce(r.public_admission_amount,0); end if;
  return public.booking_discount_package_price_before_public(p_reservation);
end $$;
-- Expand the existing tightly scoped creation permission to public admission.
do $$ declare body text; begin
  body:=pg_get_functiondef('public.set_booking_discount(uuid,uuid,integer,text,numeric,text,boolean)'::regprocedure);
  if position('app.public_guest_creation' in body)=0 then
    if position('r.commercial_type=''room_accommodation'' and r.room_pricing and coalesce(current_setting(''app.room_guest_creation'',true),'''')=r.reservation_id::text' in body)=0 then
      raise exception 'Apply the current customer-room-booking migration first'; end if;
    body:=replace(body,'r.commercial_type=''room_accommodation'' and r.room_pricing and coalesce(current_setting(''app.room_guest_creation'',true),'''')=r.reservation_id::text',
      '(r.commercial_type=''room_accommodation'' and r.room_pricing and coalesce(current_setting(''app.room_guest_creation'',true),'''')=r.reservation_id::text or r.commercial_type=''public_swimming'' and not r.room_pricing and coalesce(current_setting(''app.public_guest_creation'',true),'''')=r.reservation_id::text)');
    execute body;
  end if;
end $$;

create or replace function public.public_reserve(p_actor uuid,p_request uuid,p_input jsonb,p_staff boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; c public.public_swimming_types%rowtype; service public.services%rowtype;
  line jsonb; rid uuid; wid uuid; adults integer; children integer; eligible integer; qty integer;
  start_at timestamptz; finish timestamptz; admission numeric; services_total numeric:=0; bill numeric; discount jsonb;
begin
  if p_actor is null or p_request is null then raise exception 'Sign in before booking' using errcode='42501'; end if;
  if p_staff then
    if not exists(select 1 from public.staff_users s where s.id=p_actor and s.is_active and (s.role='admin' or s.role='staff' and exists(select 1 from public.role_permissions p where p.role=s.role and 'create_reservation'=any(p.permissions)))) then
      raise exception 'Reservation creation permission required' using errcode='42501'; end if;
  elsif not exists(select 1 from public.guests where id=p_actor and is_active) or exists(select 1 from public.staff_users where id=p_actor) then
    raise exception 'An active customer account is required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(73124,1);
  select * into r from public.reservations where public_request_id=p_request for update;
  if found then
    if r.public_request_payload is distinct from p_input or (not p_staff and r.guest_id is distinct from p_actor) or (p_staff and r.public_request_payload->>'staffActor' is distinct from p_actor::text) then
      raise exception 'This booking request was already used. Review the saved booking' using errcode='40001'; end if;
    return jsonb_build_object('id',r.reservation_id,'referenceNumber',r.reference_number,'status',r.status,'paymentDeadlineAt',r.payment_deadline_at,'totalAmount',(select total_amount from public.transactions where reservation_id=r.reservation_id));
  end if;
  select * into c from public.public_swimming_types where type_id=(p_input->>'typeId')::uuid and is_active for share;
  if not found or c.pricing_version is distinct from (p_input->>'pricingVersion')::bigint then raise exception 'Public swimming rates changed. Refresh your booking' using errcode='40001'; end if;
  adults:=(p_input->>'adultCount')::integer; children:=(p_input->>'childCount')::integer; eligible:=(p_input->>'eligibleGuests')::integer;
  start_at:=(p_input->>'startDatetime')::timestamptz; finish:=(p_input->>'endDatetime')::timestamptz;
  if adults is null or adults<1 or children is null or children<0 or adults+children>30 or eligible is null or eligible<0 or eligible>adults+children then
    raise exception 'Choose at least one adult, up to 30 guests, and count each PWD/senior once' using errcode='22023'; end if;
  if not exists(select 1 from public.public_booking_slots() s where s.type_id=c.type_id and s.starts_at=start_at and s.ends_at=finish and s.remaining_capacity>=adults+children) then
    raise exception 'Choose a session on one of the next three available public swimming dates' using errcode='40001'; end if;
  if length(btrim(coalesce(p_input->>'firstName',''))) not between 1 and 100 or length(btrim(coalesce(p_input->>'lastName',''))) not between 1 and 100
    or coalesce(p_input->>'phone','') !~ '^\+639[0-9]{9}$' or length(btrim(coalesce(p_input->>'address',''))) not between 3 and 1000 then
    raise exception 'Complete the guest and contact information' using errcode='22023'; end if;
  if jsonb_typeof(p_input->'selectedServices') is distinct from 'array' or jsonb_array_length(p_input->'selectedServices')>100 then raise exception 'Choose valid services' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_input->'selectedServices') x group by x->>'serviceId' having count(*)>1) then raise exception 'Choose each service once' using errcode='22023'; end if;
  for line in select value from jsonb_array_elements(p_input->'selectedServices') loop
    select * into service from public.services where service_id=(line->>'serviceId')::uuid and is_active for share;
    qty:=(line->>'quantity')::integer;
    if not found or qty is null or qty<1 or qty>least(coalesce(service.max_quantity,10000),10000)
      or service.billing_type='duration' and qty>floor(extract(epoch from finish-start_at)/3600) then raise exception 'Service hours cannot exceed the chosen public swimming session; review service limits' using errcode='22023'; end if;
    services_total:=services_total+service.price*qty;
  end loop;
  if p_staff then
    insert into public.walk_in_guests(first_name,last_name,phone_number,address) values(btrim(p_input->>'firstName'),btrim(p_input->>'lastName'),p_input->>'phone',btrim(p_input->>'address')) returning walk_in_guest_id into wid;
  else update public.guests set first_name=btrim(p_input->>'firstName'),last_name=btrim(p_input->>'lastName'),phone_number=p_input->>'phone',address=btrim(p_input->>'address') where id=p_actor; end if;
  admission:=adults*c.adult_rate+children*c.child_rate;
  insert into public.reservations(guest_id,walk_in_guest_id,reference_number,booking_type,booking_mode,commercial_type,start_datetime,end_datetime,adult_count,child_count,status,payment_deadline_at,
    public_type_id,public_pricing_snapshot,public_admission_amount,public_request_id,public_request_payload,special_requests,booking_policy_version,terms_policy_id,privacy_policy_id,adult_rate_at_booking,child_rate_at_booking)
    values(case when p_staff then null else p_actor end,wid,'PS-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),case when p_staff then 'walk_in' else 'online' end,c.mode,'public_swimming',start_at,finish,adults,children,'pending',clock_timestamp()+interval '30 minutes',
      c.type_id,to_jsonb(c),admission,p_request,p_input,nullif(btrim(p_input->>'specialRequests'),''),(p_input->>'bookingPolicyVersion')::bigint,(p_input->>'termsPolicyId')::uuid,(p_input->>'privacyPolicyId')::uuid,c.adult_rate,c.child_rate) returning * into r;
  rid:=r.reservation_id;
  for line in select value from jsonb_array_elements(p_input->'selectedServices') loop
    select * into service from public.services where service_id=(line->>'serviceId')::uuid;
    insert into public.reservation_services(reservation_id,service_id,quantity,price_at_time,billing_type) values(rid,service.service_id,(line->>'quantity')::integer,service.price,service.billing_type);
  end loop;
  insert into public.transactions(reservation_id,total_amount,status) values(rid,admission+services_total,'unpaid') on conflict(reservation_id) do update set total_amount=excluded.total_amount;
  perform set_config('app.public_guest_creation',rid::text,true);
  discount:=public.set_booking_discount(rid,p_actor,eligible,p_input->>'promoCode',admission+services_total,'Public swimming booking; verify declared eligible guest IDs at arrival',not p_staff);
  perform set_config('app.public_guest_creation','',true);
  bill:=(discount->>'totalAmount')::numeric;
  if bill is distinct from (p_input->>'expectedTotal')::numeric then raise exception 'The quoted total changed. Review booking details again' using errcode='40001'; end if;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details) values(case when p_staff then p_actor else null end,p_actor,'Created public swimming booking','reservation',rid,jsonb_build_object('adults',adults,'children',children,'total',bill));
  insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
    select s.role,s.id,p_actor,'Public swimming booking saved',r.reference_number||' requires full payment; verify declared PWD/senior IDs at arrival.','/admin/reservations','reservation',rid from public.staff_users s where s.is_active and (s.role='admin' or exists(select 1 from public.role_permissions p where p.role=s.role and 'reservations'=any(p.permissions)));
  return jsonb_build_object('id',rid,'referenceNumber',r.reference_number,'totalAmount',bill,'paymentDeadlineAt',case when bill=0 then null else r.payment_deadline_at end,'status',case when bill=0 then 'confirmed' else 'pending' end);
end $$;

create or replace function public.public_edit_booking(p_reservation uuid,p_guest uuid,p_expected jsonb,p_patch jsonb,p_staff boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; t public.transactions%rowtype; service public.services%rowtype; old_line public.reservation_services%rowtype;
  line jsonb; adults integer; children integer; qty integer; price numeric; admission numeric; services_total numeric:=0; old_services numeric; result jsonb;
begin
  perform pg_advisory_xact_lock(73124,1);
  select * into r from public.reservations where reservation_id=p_reservation for update;
  if not found or r.commercial_type<>'public_swimming' or r.room_pricing then raise exception 'Choose a public swimming reservation' using errcode='22023'; end if;
  if p_staff then
    if not exists(select 1 from public.staff_users s where s.id=p_guest and s.is_active and (s.role='admin' or s.role='staff' and exists(select 1 from public.role_permissions p where p.role=s.role and 'edit_reservation'=any(p.permissions)))) then raise exception 'Reservation edit permission required' using errcode='42501'; end if;
  elsif p_guest is null or r.guest_id is distinct from p_guest or not exists(select 1 from public.guests where id=p_guest and is_active) then raise exception 'Booking owner required' using errcode='42501'; end if;
  select * into t from public.transactions where reservation_id=p_reservation for update;
  perform public.assert_booking_discount_snapshot(p_reservation,p_expected);
  if r.updated_at is distinct from (p_expected->>'updatedAt')::timestamptz or t.total_amount is distinct from (p_expected->>'totalAmount')::numeric or t.paid_amount is distinct from (p_expected->>'paidAmount')::numeric then raise exception 'Booking changed. Reload before saving' using errcode='40001'; end if;
  if r.status not in ('pending','confirmed') or r.checked_out_at is not null or r.status='pending' and r.payment_deadline_at<=clock_timestamp()
    or exists(select 1 from public.payments where reservation_id=p_reservation and status='pending')
    or exists(select 1 from public.refund_requests where reservation_id=p_reservation and status in ('pending','reviewed','approved','payout_submitted'))
    or exists(select 1 from public.reservation_reschedules where reservation_id=p_reservation and status='pending') then raise exception 'Resolve open reviews before editing this booking' using errcode='40001'; end if;
  adults:=(p_patch->>'adultCount')::integer; children:=(p_patch->>'childCount')::integer;
  if adults is null or adults<1 or children is null or children<0 or adults+children>30 or adults+children<t.discount_eligible_guests then raise exception 'Choose valid guest counts covering declared eligible guests' using errcode='22023'; end if;
  if (adults,children) is distinct from (r.adult_count,r.child_count) and (r.checked_in_at is not null or r.start_datetime<=clock_timestamp()) then raise exception 'Guest counts can only change before check-in' using errcode='40001'; end if;
  if jsonb_typeof(p_patch->'services') is distinct from 'array' or jsonb_array_length(p_patch->'services')>100 or exists(select 1 from jsonb_array_elements(p_patch->'services') x group by x->>'serviceId' having count(*)>1) then raise exception 'Choose valid services once each' using errcode='22023'; end if;
  if not p_staff and (t.paid_amount>=t.total_amount or r.checked_in_at is not null) and exists(select 1 from public.reservation_services s where s.reservation_id=p_reservation and s.quantity>coalesce((select (x->>'quantity')::integer from jsonb_array_elements(p_patch->'services') x where x->>'serviceId'=s.service_id::text),0)) then raise exception 'Paid services can only be increased. Contact resort staff for reductions' using errcode='40001'; end if;
  select coalesce(sum(quantity*price_at_time),0) into old_services from public.reservation_services where reservation_id=p_reservation;
  for line in select value from jsonb_array_elements(p_patch->'services') loop
    select * into service from public.services where service_id=(line->>'serviceId')::uuid for share;
    select * into old_line from public.reservation_services where reservation_id=p_reservation and service_id=(line->>'serviceId')::uuid;
    qty:=(line->>'quantity')::integer; price:=coalesce(old_line.price_at_time,service.price);
    if service.service_id is null or (not service.is_active and (old_line.quantity is null or qty>old_line.quantity)) or qty is null or qty<1 or qty>greatest(coalesce(service.max_quantity,10000),coalesce(old_line.quantity,0))
      or coalesce(old_line.billing_type,service.billing_type)='duration' and qty>floor(extract(epoch from r.end_datetime-r.start_datetime)/3600) then raise exception 'Choose available services within the session duration' using errcode='22023'; end if;
    services_total:=services_total+qty*price;
  end loop;
  admission:=adults*(r.public_pricing_snapshot->>'adult_rate')::numeric+children*(r.public_pricing_snapshot->>'child_rate')::numeric;
  update public.reservations set adult_count=adults,child_count=children,public_admission_amount=admission,
    special_requests=case when p_patch ? 'specialRequests' then nullif(btrim(p_patch->>'specialRequests'),'') else special_requests end,
    updated_at=clock_timestamp() where reservation_id=p_reservation;
  -- Keep existing rows/prices where possible; catalog-room triggers reconcile claims atomically.
  delete from public.reservation_services s where s.reservation_id=p_reservation and not exists(select 1 from jsonb_array_elements(p_patch->'services') x where x->>'serviceId'=s.service_id::text);
  for line in select value from jsonb_array_elements(p_patch->'services') loop
    update public.reservation_services set quantity=(line->>'quantity')::integer where reservation_id=p_reservation and service_id=(line->>'serviceId')::uuid;
    if not found then insert into public.reservation_services(reservation_id,service_id,quantity,price_at_time,billing_type)
      select p_reservation,s.service_id,(line->>'quantity')::integer,s.price,s.billing_type from public.services s where service_id=(line->>'serviceId')::uuid; end if;
  end loop;
  perform set_config('app.booking_discount',p_reservation::text,true);
  update public.transactions set total_amount=t.total_amount+admission-r.public_admission_amount+services_total-old_services where reservation_id=p_reservation;
  result:=public.reprice_booking_discount(p_reservation);
  -- API expectedTotal is the interim total before recalculating the saved discount.
  if (p_patch->>'expectedTotal')::numeric is distinct from t.total_amount+admission-r.public_admission_amount+services_total-old_services then raise exception 'Bill changed. Review the quote again' using errcode='40001'; end if;
  perform public.refresh_reservation_payment_totals(p_reservation);
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details) values(case when p_staff then p_guest else null end,p_guest,'Updated public swimming guests and services','reservation',p_reservation,result||jsonb_build_object('adults',adults,'children',children));
  return result||jsonb_build_object('adultCount',adults,'childCount',children,'services',coalesce((select jsonb_agg(jsonb_build_object('serviceId',s.service_id,'name',c.name,'quantity',s.quantity,'priceAtTime',s.price_at_time,'billingType',s.billing_type)) from public.reservation_services s join public.services c using(service_id) where s.reservation_id=p_reservation),'[]'::jsonb));
end $$;

create or replace function public.public_reschedule_booking(p_reservation uuid,p_guest uuid,p_start timestamptz,p_end timestamptz,p_expected_start timestamptz,p_expected_additional numeric,p_reason text,p_staff boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; t public.transactions%rowtype; fee numeric; history_id uuid; result jsonb;
begin
  perform pg_advisory_xact_lock(73124,1);
  select * into r from public.reservations where reservation_id=p_reservation for update;
  if p_staff then
    if not exists(select 1 from public.staff_users s where s.id=p_guest and s.is_active and (s.role='admin' or s.role='staff' and exists(select 1 from public.role_permissions p where p.role=s.role and 'edit_reservation'=any(p.permissions)))) then raise exception 'Reservation edit permission required' using errcode='42501'; end if;
  elsif p_guest is null or r.guest_id is distinct from p_guest or not exists(select 1 from public.guests where id=p_guest and is_active) then raise exception 'Booking owner required' using errcode='42501'; end if;
  if r.commercial_type<>'public_swimming' or r.room_pricing or r.status<>'confirmed' or r.checked_in_at is not null or r.start_datetime is distinct from p_expected_start
    or p_start=r.start_datetime or p_end-p_start<>r.end_datetime-r.start_datetime or mod(extract(epoch from p_start-r.start_datetime),86400)<>0 then raise exception 'Choose another public date for the booked session before check-in' using errcode='40001'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 5 and 2000 then raise exception 'Enter a reschedule reason' using errcode='22023'; end if;
  if exists(select 1 from public.payments where reservation_id=p_reservation and status='pending') or exists(select 1 from public.refund_requests where reservation_id=p_reservation and status in ('pending','reviewed','approved','payout_submitted')) or exists(select 1 from public.reservation_reschedules where reservation_id=p_reservation and status='pending') then raise exception 'Resolve open reviews before rescheduling' using errcode='40001'; end if;
  if not exists(select 1 from public.public_booking_slots(p_reservation) s where s.type_id=r.public_type_id and s.starts_at=p_start and s.ends_at=p_end and s.remaining_capacity>=r.adult_count+r.child_count) then raise exception 'The public session is unavailable. Choose a date within the three-day public window' using errcode='40001'; end if;
  select * into t from public.transactions where reservation_id=p_reservation for update;
  fee:=(public.reschedule_policy_snapshot(r.start_datetime,clock_timestamp())->>'noticeFee')::numeric;
  if fee is distinct from p_expected_additional then raise exception 'Reschedule fee changed. Review it again' using errcode='40001'; end if;
  if p_staff then
    insert into public.reservation_reschedule_adjustments(reservation_id,old_start,old_end,new_start,new_end,notice_fee,rate_adjustment,policy_snapshot,late_exception,reason,staff_id)
      values(p_reservation,r.start_datetime,r.end_datetime,p_start,p_end,fee,0,public.reschedule_policy_snapshot(r.start_datetime,clock_timestamp()),false,btrim(p_reason),p_guest);
  else
    insert into public.reservation_reschedules(reservation_id,requested_by,old_start,old_end,new_start,new_end,reschedule_fee,rate_adjustment,status,approved_by,approved_at,created_at,reason)
    values(p_reservation,p_guest,r.start_datetime,r.end_datetime,p_start,p_end,fee,0,'approved',null,clock_timestamp(),clock_timestamp(),btrim(p_reason)) returning reschedule_id into history_id;
  end if;
  update public.reservations set start_datetime=p_start,end_datetime=p_end,updated_at=clock_timestamp() where reservation_id=p_reservation;
  perform set_config('app.booking_discount',p_reservation::text,true);
  update public.transactions set total_amount=t.total_amount+fee where reservation_id=p_reservation;
  result:=public.reprice_booking_discount(p_reservation);
  perform public.refresh_reservation_payment_totals(p_reservation);
  insert into public.audit_logs(auth_user_id,action,entity_type,entity_id,details) values(p_guest,'Rescheduled public swimming reservation','reservation',p_reservation,jsonb_build_object('old_start',r.start_datetime,'new_start',p_start,'notice_fee',fee,'reason',p_reason));
  return result||jsonb_build_object('reservationId',p_reservation,'rescheduleId',history_id,'startDatetime',p_start,'endDatetime',p_end,'rescheduleFee',fee,'rateAdjustment',0,'totalAdditional',fee,'status','confirmed');
end $$;

create or replace function public.public_staff_edit_booking(p_reservation uuid,p_staff uuid,p_expected jsonb,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; result jsonb; fee numeric:=0; moved boolean;
begin
  perform pg_advisory_xact_lock(73124,1);
  select * into r from public.reservations where reservation_id=p_reservation for update;
  moved:=(r.start_datetime,r.end_datetime) is distinct from ((p_patch->>'startDatetime')::timestamptz,(p_patch->>'endDatetime')::timestamptz);
  if p_patch->>'bookingMode' is distinct from r.booking_mode then raise exception 'Keep the booked public swimming session' using errcode='22023'; end if;
  if moved then fee:=(public.reschedule_policy_snapshot(r.start_datetime,clock_timestamp())->>'noticeFee')::numeric; end if;
  result:=public.public_edit_booking(p_reservation,p_staff,p_expected,p_patch||jsonb_build_object('expectedTotal',(p_patch->>'expectedTotal')::numeric-fee),true);
  if moved then result:=result||public.public_reschedule_booking(p_reservation,p_staff,(p_patch->>'startDatetime')::timestamptz,(p_patch->>'endDatetime')::timestamptz,r.start_datetime,fee,p_patch->>'reason',true); end if;
  return result;
end $$;

-- Both public swimming and rooms require full balance payment, including API bypasses.
create or replace function public.guard_room_full_payment() returns trigger language plpgsql security definer set search_path='' as $$
declare required numeric;
begin
  if exists(select 1 from public.reservations where reservation_id=new.reservation_id and commercial_type in ('room_accommodation','public_swimming')) then
    if new.payment_type='downpayment' then raise exception 'Public swimming and room accommodation require full payment' using errcode='22023'; end if;
    select balance into required from public.transactions where reservation_id=new.reservation_id for update;
    if new.amount<required then raise exception 'Payment must cover the full outstanding balance' using errcode='22023'; end if;
  end if;
  return new;
end $$;
revoke all on function public.public_type_version(),public.pool_inventory_guard(),public.public_booking_slots(uuid),public.public_reserve(uuid,uuid,jsonb,boolean),public.booking_discount_package_price(uuid),public.booking_discount_package_price_before_public(uuid) from public,anon,authenticated;
grant execute on function public.public_booking_slots(uuid),public.public_reserve(uuid,uuid,jsonb,boolean) to service_role;
revoke all on function public.public_edit_booking(uuid,uuid,jsonb,jsonb,boolean),public.public_reschedule_booking(uuid,uuid,timestamptz,timestamptz,timestamptz,numeric,text,boolean),public.public_staff_edit_booking(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.public_edit_booking(uuid,uuid,jsonb,jsonb,boolean),public.public_reschedule_booking(uuid,uuid,timestamptz,timestamptz,timestamptz,numeric,text,boolean),public.public_staff_edit_booking(uuid,uuid,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
