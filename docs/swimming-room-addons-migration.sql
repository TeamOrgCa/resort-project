-- Apply AFTER customer-room-booking-migration.sql, public-swimming-booking-migration.sql,
-- public-swimming-calendar-migration.sql and public-swimming-package-validation-migration.sql.
-- New private pool bookings include two physical Standard rooms. Existing bookings
-- are not backfilled. Paid add-ons use saved room rates for the full pool session.
-- Follow with private-swimming-room-reserve-migration.sql to permanently protect
-- the two included Standard rooms from public and room-only bookings.
begin;
alter table public.reservations add column if not exists swimming_room_choices jsonb;

create or replace function public.guard_swimming_room_choices() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated') and
    ((tg_op='INSERT' and new.swimming_room_choices is not null) or
     (tg_op='UPDATE' and new.swimming_room_choices is distinct from old.swimming_room_choices)) then
    raise exception 'Use the authorized swimming room booking action' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_swimming_room_choices on public.reservations;
create trigger guard_swimming_room_choices before insert or update on public.reservations for each row execute function public.guard_swimming_room_choices();

-- Internal allocator: called under the same lock used by room management,
-- maintenance, room-only bookings and pool reservations. A shortage rolls back
-- the entire request, including any earlier rooms allocated in this call.
create or replace function public.swimming_allocate_rooms(p_reservation uuid,p_actor uuid,p_rooms jsonb,p_included boolean default false)
returns numeric language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; c public.room_classifications%rowtype;
  item jsonb; candidate record; chosen uuid; qty integer; n integer; count_rooms integer:=0;
  hours numeric; unit_price numeric; total numeric:=0; actor uuid;
begin
  perform pg_advisory_xact_lock(73124,1);
  select * into r from public.reservations where reservation_id=p_reservation for update;
  if not found or r.room_pricing or r.commercial_type not in ('private_swimming','public_swimming') then
    raise exception 'Choose a swimming reservation' using errcode='22023'; end if;
  hours:=extract(epoch from r.end_datetime-r.start_datetime)/3600;
  if hours is null or hours<=0 or hours>24 then raise exception 'Rooms must cover a swimming session of up to 24 hours' using errcode='22023'; end if;
  if jsonb_typeof(p_rooms) is distinct from 'array' or jsonb_array_length(p_rooms)>20
    or exists(select 1 from jsonb_array_elements(p_rooms) x group by lower(x->>'classificationId') having count(*)>1) then
    raise exception 'Choose each room type once, up to 20 extra rooms' using errcode='22023'; end if;
  select id into actor from public.staff_users where id=p_actor and is_active;
  for item in select value from jsonb_array_elements(p_rooms) order by value->>'classificationId' loop
    if jsonb_typeof(item->'quantity') is distinct from 'number' or (item->>'quantity') !~ '^[0-9]+$'
      or jsonb_typeof(item->'pricingVersion') is distinct from 'number' or (item->>'pricingVersion') !~ '^[0-9]+$' then
      raise exception 'Choose valid room quantities and saved rates' using errcode='22023'; end if;
    qty:=(item->>'quantity')::integer; count_rooms:=count_rooms+qty;
    if qty not between 1 and 20 or count_rooms>20 then raise exception 'Choose up to 20 extra rooms' using errcode='22023'; end if;
    select * into c from public.room_classifications where classification_id=(item->>'classificationId')::uuid for share;
    if not found or c.pricing_version is distinct from (item->>'pricingVersion')::bigint then
      raise exception 'Room rates changed. Refresh your room choices' using errcode='40001'; end if;
    if p_included and (r.commercial_type<>'private_swimming' or c.code<>'standard' or qty<>2 or jsonb_array_length(p_rooms)<>1) then
      raise exception 'Private swimming includes two Standard rooms' using errcode='22023'; end if;
    unit_price:=case when p_included then 0 else
      case when hours<=3 then c.rate_3_hours else c.rate_12_hours end + greatest(0,ceil(hours-12))*c.extension_hourly_rate end;
    for n in 1..qty loop
      chosen:=null;
      for candidate in select room_id,room_number from public.physical_rooms
        where classification_id=c.classification_id and is_active and status<>'maintenance' order by room_number for update loop
        begin
          perform public.room_assert_available(candidate.room_id,r.start_datetime,r.end_datetime);
          chosen:=candidate.room_id; exit;
        exception when serialization_failure or invalid_parameter_value then null; end;
      end loop;
      if chosen is null then raise exception 'Not enough % rooms are available for this swimming session. Choose another session or refresh your room choices',c.name using errcode='40001'; end if;
      insert into public.room_assignments(room_id,reservation_id,occupants,starts_at,expected_checkout,pricing_snapshot)
        values(chosen,p_reservation,least(c.included_capacity,greatest(1,r.adult_count+r.child_count)),r.start_datetime,r.end_datetime,
          jsonb_build_object('swimming_room',true,'included',p_included,'classification_id',c.classification_id,'name',c.name,
            'duration_hours',hours,'version',c.pricing_version,'accommodation',unit_price,'extension_hourly_rate',c.extension_hourly_rate));
      if not p_included then
        insert into public.room_charges(room_id,reservation_id,kind,description,amount,created_by,auth_actor_id)
          values(chosen,p_reservation,'accommodation',candidate.room_number||' - extra '||c.name||' for swimming session ('||trim_scale(hours)::text||' hours)',unit_price,actor,p_actor);
      end if;
      perform public.room_log(chosen,p_reservation,p_actor,'reservation_created',case when p_included then 'Standard room included in private swimming package' else 'Extra room reserved for swimming session' end,
        jsonb_build_object('included',p_included,'amount',unit_price,'duration_hours',hours,'included_capacity',c.included_capacity));
      total:=total+unit_price;
    end loop;
  end loop;
  return total;
end $$;

create or replace function public.swimming_include_private_rooms() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.room_classifications%rowtype;
begin
  if new.commercial_type='private_swimming' and not new.room_pricing and new.status in ('pending','payment_submitted','confirmed','reschedule_requested') then
    select * into c from public.room_classifications where code='standard' for share;
    if not found then raise exception 'The two included Standard rooms are unavailable. Contact the resort' using errcode='40001'; end if;
    perform public.swimming_allocate_rooms(new.reservation_id,new.guest_id,
      jsonb_build_array(jsonb_build_object('classificationId',c.classification_id,'quantity',2,'pricingVersion',c.pricing_version)),true);
  end if;
  return new;
end $$;
drop trigger if exists swimming_include_private_rooms on public.reservations;
create trigger swimming_include_private_rooms after insert on public.reservations for each row execute function public.swimming_include_private_rooms();

-- An expired hold may have released its inventory before the expiry job runs.
-- Recheck physical rooms before any action reactivates that hold.
create or replace function public.swimming_recheck_room_hold() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.room_assignments%rowtype;
begin
  if new.status in ('pending','payment_submitted','confirmed','reschedule_requested') and
    ((old.status='pending' and old.payment_deadline_at<=clock_timestamp()) or old.status in ('expired','cancelled','rejected','no_show')) and
    exists(select 1 from public.room_assignments where reservation_id=new.reservation_id and pricing_snapshot->>'swimming_room'='true') then
    perform pg_advisory_xact_lock(73124,1);
    if not exists(select 1 from public.room_assignments where reservation_id=new.reservation_id and state in ('reserved','occupied')) then
      raise exception 'The swimming room hold has been released. Create a new booking or contact the resort' using errcode='40001'; end if;
    for a in select * from public.room_assignments where reservation_id=new.reservation_id and state in ('reserved','occupied') order by room_id loop
      if exists(select 1 from public.physical_rooms where room_id=a.room_id and status='maintenance') then
        raise exception 'An assigned swimming room is under maintenance. Contact the resort' using errcode='40001'; end if;
      perform public.room_assert_available(a.room_id,new.start_datetime,new.end_datetime,a.assignment_id);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists swimming_recheck_room_hold on public.reservations;
create trigger swimming_recheck_room_hold before update on public.reservations for each row execute function public.swimming_recheck_room_hold();

create or replace function public.swimming_attach_rooms(p_reservation uuid,p_actor uuid,p_rooms jsonb)
returns numeric language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; total numeric;
begin
  perform pg_advisory_xact_lock(73124,1);
  select * into r from public.reservations where reservation_id=p_reservation for update;
  if not found or p_actor is null or not (
    r.guest_id=p_actor and exists(select 1 from public.guests where id=p_actor and is_active) or
    exists(select 1 from public.staff_users s where s.id=p_actor and s.is_active and (s.role='admin' or s.role='staff' and exists(
      select 1 from public.role_permissions p where p.role=s.role and 'create_reservation'=any(p.permissions))))) then
    raise exception 'Booking owner or reservation creation permission required' using errcode='42501'; end if;
  if r.status<>'pending' or r.checked_in_at is not null or r.payment_deadline_at<=clock_timestamp()
    or not exists(select 1 from public.transactions where reservation_id=p_reservation and paid_amount=0)
    or exists(select 1 from public.payments where reservation_id=p_reservation and status in ('pending','verified')) then
    raise exception 'Rooms can only be selected while creating an unpaid swimming booking' using errcode='40001'; end if;
  if r.swimming_room_choices is not null then
    if r.swimming_room_choices is distinct from p_rooms then raise exception 'Room choices have already been saved' using errcode='40001'; end if;
    select coalesce(sum((pricing_snapshot->>'accommodation')::numeric),0) into total from public.room_assignments
      where reservation_id=p_reservation and pricing_snapshot->>'swimming_room'='true' and pricing_snapshot->>'included'='false';
    return total;
  end if;
  total:=public.swimming_allocate_rooms(p_reservation,p_actor,p_rooms,false);
  update public.reservations set swimming_room_choices=p_rooms where reservation_id=p_reservation;
  return total;
end $$;

-- Room charges and promo application commit together. On a stale quote or promo,
-- no room charge survives, so the existing private creation route can release
-- its uncommitted booking without deleting immutable billing history.
create or replace function public.swimming_finalize_booking(p_reservation uuid,p_actor uuid,p_rooms jsonb,p_code text,p_expected_gross numeric,p_expected_net numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare gross numeric; net numeric; result jsonb; guest_booking boolean;
begin
  perform public.swimming_attach_rooms(p_reservation,p_actor,p_rooms);
  select total_amount into gross from public.transactions where reservation_id=p_reservation for update;
  if gross is distinct from p_expected_gross then raise exception 'Room prices changed. Return to the form and review the total' using errcode='40001'; end if;
  if nullif(btrim(p_code),'') is not null then
    select coalesce(guest_id=p_actor,false) into guest_booking from public.reservations where reservation_id=p_reservation;
    result:=public.apply_new_booking_promo(p_reservation,p_actor,p_code,gross,guest_booking,p_expected_net);
    net:=(result->>'totalAmount')::numeric;
  else net:=gross;
  end if;
  if net is distinct from p_expected_net then raise exception 'The quoted total changed. Return to the form and review it' using errcode='40001'; end if;
  return jsonb_build_object('totalAmount',net);
end $$;

-- Keep the public save atomic and preserve its original request idempotency.
do $$ declare body text; begin
  body:=pg_get_functiondef('public.public_reserve(uuid,uuid,jsonb,boolean)'::regprocedure);
  if position('swimming_attach_rooms' in body)=0 then
    if position('services_total numeric:=0; bill' in body)=0 or position('admission+services_total,''Public swimming booking' in body)=0 then
      raise exception 'Apply the public swimming booking migrations before swimming-room-addons-migration.sql'; end if;
    body:=replace(body,'services_total numeric:=0; bill','services_total numeric:=0; swimming_rooms_total numeric:=0; bill');
    body:=replace(body,'  perform set_config(''app.public_guest_creation'',rid::text,true);',
      '  swimming_rooms_total:=public.swimming_attach_rooms(rid,p_actor,coalesce(p_input->''swimmingRooms'',''[]''::jsonb));'||chr(10)||'  perform set_config(''app.public_guest_creation'',rid::text,true);');
    body:=replace(body,'admission+services_total,''Public swimming booking','admission+services_total+swimming_rooms_total,''Public swimming booking');
    execute body;
  end if;
end $$;
revoke all on function public.guard_swimming_room_choices(),public.swimming_allocate_rooms(uuid,uuid,jsonb,boolean),public.swimming_include_private_rooms(),public.swimming_recheck_room_hold(),public.swimming_attach_rooms(uuid,uuid,jsonb),public.swimming_finalize_booking(uuid,uuid,jsonb,text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.swimming_finalize_booking(uuid,uuid,jsonb,text,numeric,numeric) to service_role;
notify pgrst,'reload schema';
commit;
