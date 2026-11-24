-- Apply AFTER room-rates-discounts-migration.sql and guest-payment-methods-migration.sql.
-- Room bookings share physical inventory and the existing billing/payment ledger.
begin;
alter table public.room_charges alter column created_by drop not null;
alter table public.room_charges add column if not exists auth_actor_id uuid;
alter table public.reservations add column if not exists room_request_id uuid;
alter table public.reservations add column if not exists room_request_payload jsonb;
create unique index if not exists room_guest_request_unique on public.reservations(room_request_id) where room_request_id is not null;
create or replace function public.guard_room_commercial_type() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated') and
    ((tg_op='INSERT' and (new.commercial_type<>'private_swimming' or new.room_pricing or new.room_request_id is not null or new.room_request_payload is not null)) or
     (tg_op='UPDATE' and (new.commercial_type is distinct from old.commercial_type or new.room_pricing is distinct from old.room_pricing
       or new.room_request_id is distinct from old.room_request_id or new.room_request_payload is distinct from old.room_request_payload))) then
    raise exception 'Use the authorized room reservation action' using errcode='42501'; end if;
  return new;
end $$;

-- Anonymous availability exposes no guest, reservation or payment identifiers.
create or replace function public.room_guest_catalog(p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<=p_from or p_to>p_from+interval '35 days' then
    raise exception 'Choose a valid room availability interval of at most 35 days' using errcode='22023'; end if;
  select jsonb_build_object('classifications',coalesce((select jsonb_agg(to_jsonb(c) order by c.code desc)
    from public.room_classifications c where exists(select 1 from public.physical_rooms r where r.classification_id=c.classification_id and r.is_active)),'[]'::jsonb),
    'rooms',coalesce((select jsonb_agg(jsonb_build_object('room_id',r.room_id,'classification_id',r.classification_id,
      'unavailable', (r.status='maintenance' or exists(select 1 from public.room_assignments a where a.room_id=r.room_id and a.state='occupied' and a.expected_checkout<now())
        or exists(select 1 from public.room_maintenance m where m.room_id=r.room_id and m.completed_at is null and m.ends_at<now())),
      'blocks',coalesce((select jsonb_agg(jsonb_build_object('start_datetime',b.s,'end_datetime',b.e)) from (
        select a.starts_at-make_interval(mins=>c.cleaning_buffer_minutes) s,a.expected_checkout+make_interval(mins=>c.cleaning_buffer_minutes) e
          from public.room_assignments a join public.reservations v using(reservation_id) where a.room_id=r.room_id
          and (a.state='occupied' or a.state='reserved' and v.status in ('pending','payment_submitted','confirmed','reschedule_requested')
            and (v.status<>'pending' or v.payment_deadline_at is null or v.payment_deadline_at>now()))
        union all select m.starts_at-make_interval(mins=>c.cleaning_buffer_minutes),m.ends_at from public.room_maintenance m
          where m.room_id=r.room_id and m.completed_at is null
        union all select m.start_datetime,m.end_datetime from public.maintenance_blocks m where m.status='active'
      ) b where b.s<p_to and b.e>p_from),'[]'::jsonb))) from public.physical_rooms r join public.room_classifications c using(classification_id) where r.is_active),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(jsonb_build_object('service_id',s.service_id,'name',s.name,'price',s.price,
      'description',s.description,'image_url',s.image_url,'max_quantity',s.max_quantity,'billing_type',s.billing_type) order by s.name)
      from public.services s where s.is_active and not exists(select 1 from public.room_catalog_links l where l.service_id=s.service_id and l.is_active)),'[]'::jsonb)) into result;
  return result;
end $$;

-- Only this atomic creation path may apply a guest-declared PWD/senior count.
-- Existing guest promo/edit permissions remain unchanged outside this scope.
create or replace function public.set_booking_discount(p_reservation uuid,p_actor uuid,p_eligible integer,p_code text,
  p_expected_total numeric,p_reason text,p_guest boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; t public.transactions%rowtype; s public.staff_users%rowtype; p public.promo_codes%rowtype; result jsonb;
begin
  select * into r from public.reservations where reservation_id=p_reservation for update;
  select * into t from public.transactions where reservation_id=p_reservation for update;
  if not found then raise exception 'Reservation bill not found' using errcode='22023'; end if;
  if p_actor is null then raise exception 'An authenticated actor is required' using errcode='42501'; end if;
  if p_guest then
    if r.guest_id is distinct from p_actor or r.status<>'pending' or t.paid_amount>0 or ((p_eligible<>0 or t.discount_eligible_guests<>0) and not (r.commercial_type='room_accommodation' and r.room_pricing and coalesce(current_setting('app.room_guest_creation',true),'')=r.reservation_id::text)) then
      raise exception 'Only an unpaid booking owner can apply a new-booking discount' using errcode='42501'; end if;
  else
    select * into s from public.staff_users where id=p_actor and is_active;
    if not found or not (s.role='admin' or (s.role='staff' and exists(select 1 from public.role_permissions where role=s.role and 'edit_reservation'=any(permissions)))
      or (s.role='cashier' and exists(select 1 from public.role_permissions where role=s.role and 'transactions'=any(permissions) and 'payment_entry'=any(permissions)))) then
      raise exception 'Manager or cashier billing permission required' using errcode='42501'; end if;
  end if;
  if r.status not in ('pending','confirmed') or r.checked_out_at is not null
    or exists(select 1 from public.payments where reservation_id=p_reservation and status='pending')
    or exists(select 1 from public.refund_requests where reservation_id=p_reservation and status in ('pending','reviewed','approved','payout_submitted')) then
    raise exception 'Resolve open reviews/refunds before changing this bill' using errcode='40001'; end if;
  if p_expected_total is distinct from t.total_amount then raise exception 'Bill changed. Reload before applying a discount' using errcode='40001'; end if;
  if p_eligible is null or p_eligible<0 or p_eligible>r.adult_count+r.child_count or length(btrim(coalesce(p_reason,''))) not between 5 and 1000 then
    raise exception 'Enter a valid eligible guest count and a reason of 5-1000 characters' using errcode='22023'; end if;
  if nullif(btrim(p_code),'') is not null then
    if upper(btrim(p_code))=t.discount_promo_code then
      p.code:=t.discount_promo_code; p.discount_type:=t.discount_promo_type; p.discount_value:=t.discount_promo_value;
    else
    select * into p from public.promo_codes where code=upper(btrim(p_code)) and is_active
      and (starts_at is null or starts_at<=(now() at time zone 'Asia/Manila')::date)
      and (ends_at is null or ends_at>=(now() at time zone 'Asia/Manila')::date) for key share;
    if not found then raise exception 'Promo code is unavailable or expired' using errcode='22023'; end if;
    end if;
  end if;
  update public.transactions set discount_eligible_guests=p_eligible,discount_promo_code=p.code,
    discount_promo_type=p.discount_type,discount_promo_value=coalesce(p.discount_value,0) where reservation_id=p_reservation;
  result:=public.reprice_booking_discount(p_reservation);
  if (result->>'totalAmount')::numeric=0 and r.status='pending' then
    update public.reservations set status='confirmed' where reservation_id=p_reservation;
    result:=public.reprice_booking_discount(p_reservation); -- Update a newly issued zero-total invoice too.
  end if;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(case when p_guest then null else p_actor end,p_actor,'Updated booking discount','reservation',p_reservation,
      result||jsonb_build_object('before_total',t.total_amount,'previous_discount',t.discount_amount,'promo_code',p.code,'reason',btrim(p_reason)));
  return result;
end $$;

create or replace function public.room_guest_reserve(p_guest uuid,p_request uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.reservations%rowtype; c public.room_classifications%rowtype; s public.services%rowtype;
  item jsonb; candidate record; rid uuid; aid uuid; ref text; chosen uuid; start_at timestamptz; finish timestamptz;
  heads integer:=0; eligible integer; duration integer; count_rooms integer; occupants integer; quantity integer;
  base numeric; extras numeric; services_total numeric:=0; gross numeric; net numeric; discount jsonb; deadline timestamptz;
begin
  if p_guest is null or p_request is null or not exists(select 1 from public.guests where id=p_guest and is_active)
    or exists(select 1 from public.staff_users where id=p_guest) then raise exception 'An active customer account is required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(73124,1);
  select * into existing from public.reservations where room_request_id=p_request for update;
  if found then
    if existing.guest_id is distinct from p_guest or existing.room_request_payload is distinct from p_input then
      raise exception 'This booking request was already used. Review the saved reservation' using errcode='40001'; end if;
    return jsonb_build_object('id',existing.reservation_id,'referenceNumber',existing.reference_number,'status',existing.status,
      'paymentDeadlineAt',existing.payment_deadline_at,'totalAmount',(select total_amount from public.transactions where reservation_id=existing.reservation_id));
  end if;
  start_at:=(p_input->>'startDatetime')::timestamptz; finish:=(p_input->>'endDatetime')::timestamptz;
  duration:=(p_input->>'durationHours')::integer; eligible:=(p_input->>'eligibleGuests')::integer;
  if start_at is null or not isfinite(start_at) or start_at<clock_timestamp()+interval '1 hour' or duration is null or duration not in (3,12)
    or extract(minute from start_at at time zone 'Asia/Manila')::integer % 30 <> 0
    or extract(second from start_at at time zone 'Asia/Manila') <> 0
    or finish is distinct from start_at+make_interval(hours=>duration) then
    raise exception 'Choose an available 3-hour or 12-hour stay in 30-minute intervals, at least one hour ahead (Philippine time)' using errcode='22023'; end if;
  if jsonb_typeof(p_input->'rooms') is distinct from 'array' or jsonb_array_length(p_input->'rooms') not between 1 and 20
    or jsonb_typeof(p_input->'selectedServices') is distinct from 'array' then raise exception 'Choose at least one room and valid services' using errcode='22023'; end if;
  count_rooms:=jsonb_array_length(p_input->'rooms');
  for item in select value from jsonb_array_elements(p_input->'rooms') loop
    select * into c from public.room_classifications where classification_id=(item->>'classificationId')::uuid for update;
    occupants:=(item->>'occupants')::integer;
    if not found or (item->>'pricingVersion')::bigint is distinct from c.pricing_version then raise exception 'Room rates changed. Return to booking details to refresh the quote' using errcode='40001'; end if;
    if occupants is null or occupants<1 or occupants>c.maximum_capacity or (occupants>c.included_capacity and c.additional_guest_rate<=0) then
      raise exception 'Choose occupants within each room capacity and configured additional guest rates' using errcode='22023'; end if;
    heads:=heads+occupants;
  end loop;
  if heads not between 1 and 30 or eligible is null or eligible<0 or eligible>heads then raise exception 'Choose up to 30 guests and count each PWD/senior guest once' using errcode='22023'; end if;
  if coalesce(p_input->>'phone','') !~ '^\+639[0-9]{9}$' or length(btrim(coalesce(p_input->>'firstName',''))) not between 1 and 100
    or length(btrim(coalesce(p_input->>'lastName',''))) not between 1 and 100 or length(btrim(coalesce(p_input->>'address',''))) not between 3 and 1000 then
    raise exception 'Complete your guest and contact details' using errcode='22023'; end if;
  -- Validate all service prices and quantities before writing any booking lines.
  if jsonb_array_length(p_input->'selectedServices')>100 or exists(select 1 from jsonb_array_elements(p_input->'selectedServices') x group by x->>'serviceId' having count(*)>1) then
    raise exception 'Choose each service once' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_input->'selectedServices') loop
    select * into s from public.services where service_id=(item->>'serviceId')::uuid and is_active for share;
    quantity:=(item->>'quantity')::integer;
    if not found or quantity is null or quantity<1 or quantity>coalesce(s.max_quantity,10000) or quantity>10000
      or (s.billing_type='fixed' and quantity<>1) or exists(select 1 from public.room_catalog_links l where l.service_id=s.service_id and l.is_active) then
      raise exception 'A selected service or quantity is unavailable. Refresh booking details' using errcode='22023'; end if;
    services_total:=services_total+s.price*quantity;
  end loop;
  update public.guests set first_name=btrim(p_input->>'firstName'),last_name=btrim(p_input->>'lastName'),phone_number=p_input->>'phone',address=btrim(p_input->>'address') where id=p_guest;
  insert into public.reservations(guest_id,reference_number,booking_type,booking_mode,commercial_type,room_pricing,start_datetime,end_datetime,
    adult_count,child_count,status,payment_deadline_at,booking_policy_version,terms_policy_id,privacy_policy_id,special_requests,room_request_id,room_request_payload)
    values(p_guest,'RM-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),'online','custom','room_accommodation',true,start_at,finish,
      heads,0,'pending',clock_timestamp()+interval '30 minutes',(p_input->>'bookingPolicyVersion')::bigint,
      (p_input->>'termsPolicyId')::uuid,(p_input->>'privacyPolicyId')::uuid,nullif(btrim(p_input->>'specialRequests'),''),p_request,p_input)
    returning reservation_id,reference_number,payment_deadline_at into rid,ref,deadline;
  -- Add legacy service lines before immutable room charges lock older editors.
  for item in select value from jsonb_array_elements(p_input->'selectedServices') loop
    select * into s from public.services where service_id=(item->>'serviceId')::uuid;
    insert into public.reservation_services(reservation_id,service_id,quantity,price_at_time,billing_type)
      values(rid,s.service_id,(item->>'quantity')::integer,s.price,s.billing_type);
  end loop;
  insert into public.transactions(reservation_id,total_amount,status) values(rid,services_total,'unpaid')
    on conflict(reservation_id) do update set total_amount=excluded.total_amount;
  for item in select value from jsonb_array_elements(p_input->'rooms') loop
    select * into c from public.room_classifications where classification_id=(item->>'classificationId')::uuid;
    chosen:=null;
    for candidate in select room_id,room_number from public.physical_rooms where classification_id=c.classification_id and is_active and status<>'maintenance' order by room_number for update loop
      begin perform public.room_assert_available(candidate.room_id,start_at,finish); chosen:=candidate.room_id; exit;
      exception when serialization_failure or invalid_parameter_value then null; end;
    end loop;
    if chosen is null then raise exception 'Not enough rooms are available for this stay. Return to booking details and refresh' using errcode='40001'; end if;
    occupants:=(item->>'occupants')::integer; base:=case when duration=3 then c.rate_3_hours else c.rate_12_hours end;
    extras:=greatest(0,occupants-c.included_capacity)*c.additional_guest_rate;
    insert into public.room_assignments(room_id,reservation_id,occupants,starts_at,expected_checkout,pricing_snapshot)
      values(chosen,rid,occupants,start_at,finish,jsonb_build_object('duration_hours',duration,'version',c.pricing_version,'accommodation',base,'additional_guest_rate',c.additional_guest_rate)) returning assignment_id into aid;
    insert into public.room_charges(room_id,reservation_id,kind,description,amount,auth_actor_id)
      values(chosen,rid,'accommodation',candidate.room_number||' accommodation ('||duration||' hours)',base,p_guest);
    if extras>0 then insert into public.room_charges(room_id,reservation_id,kind,description,amount,auth_actor_id)
      values(chosen,rid,'additional_guest',candidate.room_number||' additional guests',extras,p_guest); end if;
    perform public.room_log(chosen,rid,p_guest,'reservation_created','Customer reserved a room',jsonb_build_object('occupants',occupants,'duration_hours',duration,'eligible_guests_declared',eligible));
  end loop;
  select total_amount into gross from public.transactions where reservation_id=rid;
  perform set_config('app.room_guest_creation',rid::text,true);
  discount:=public.set_booking_discount(rid,p_guest,eligible,p_input->>'promoCode',gross,'Customer-declared eligibility; verify applicable IDs at arrival',true);
  perform set_config('app.room_guest_creation','',true);
  net:=(discount->>'totalAmount')::numeric;
  if (p_input->>'expectedTotal')::numeric is distinct from net then raise exception 'Prices or discounts changed. Return to booking details and review the total' using errcode='40001'; end if;
  insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
    select employee.role,employee.id,p_guest,'Room booking saved',ref||' · '||count_rooms||' room(s). Full payment required.'||case when eligible>0 then ' Verify '||eligible||' declared PWD/senior ID(s) at arrival.' else '' end,
      '/admin/rooms','reservation',rid from public.staff_users employee where employee.is_active and public.room_staff_allowed(employee.id,'rooms');
  insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
    values('guest',p_guest,p_guest,'Room booking saved',ref||case when net=0 then ' is confirmed; the discount covers the bill.' else ' is saved. Submit full payment before the payment deadline.' end,'/manage','reservation',rid);
  return jsonb_build_object('id',rid,'referenceNumber',ref,'totalAmount',net,'paymentDeadlineAt',case when net=0 then null else deadline end,
    'status',case when net=0 then 'confirmed' else 'pending' end);
end $$;

-- Enforce full room payment even if a client bypasses the payment selector.
create or replace function public.guard_room_full_payment() returns trigger language plpgsql security definer set search_path='' as $$
declare required numeric;
begin
  if exists(select 1 from public.reservations where reservation_id=new.reservation_id and commercial_type='room_accommodation') then
    if new.payment_type='downpayment' then raise exception 'Room accommodation requires full payment' using errcode='22023'; end if;
    select balance into required from public.transactions where reservation_id=new.reservation_id for update;
    if new.amount<required then raise exception 'Room accommodation payment must cover the full outstanding balance' using errcode='22023'; end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_room_full_payment on public.payments;
create trigger guard_room_full_payment before insert on public.payments for each row execute function public.guard_room_full_payment();
revoke all on function public.room_guest_catalog(timestamptz,timestamptz),public.room_guest_reserve(uuid,uuid,jsonb),public.guard_room_full_payment() from public,anon,authenticated;
grant execute on function public.room_guest_catalog(timestamptz,timestamptz),public.room_guest_reserve(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
