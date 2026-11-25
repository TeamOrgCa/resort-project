-- Apply after private-swimming-room-reserve-migration.sql.
-- One guest, stay, reference and bill; each physical room retains its own
-- occupants, price snapshot, charges and operational history.
begin;
select pg_advisory_xact_lock(73124,1);

create or replace function public.room_reserve_multiple_priced(p_staff uuid,p_room uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.physical_rooms%rowtype; c public.room_classifications%rowtype; item jsonb; selections jsonb;
  heads integer; room_heads integer; duration integer; extra integer; eligible integer; counted integer:=0;
  start_at timestamptz; finish timestamptz; base numeric; additions numeric; extension numeric; gross numeric:=0; net numeric;
  wid uuid; rid uuid; aid uuid; cid uuid; ref text; result jsonb; snapshot jsonb;
begin
  if not public.room_staff_allowed(p_staff,'room_operations') or not public.room_staff_allowed(p_staff,'rooms') or
    not exists(select 1 from public.staff_users s where s.id=p_staff and s.is_active and (s.role='admin' or exists(
      select 1 from public.role_permissions rp where rp.role=s.role and 'create_reservation'=any(rp.permissions)))) then
    raise exception 'Room reservation permission required' using errcode='42501'; end if;
  selections:=p_input->'rooms';
  if jsonb_typeof(selections) is distinct from 'array' then
    raise exception 'Select the rooms for this reservation' using errcode='22023'; end if;
  if jsonb_array_length(selections) not between 1 and 100 or
    exists(select 1 from jsonb_array_elements(selections) x where jsonb_typeof(x) is distinct from 'object') or
    exists(select 1 from jsonb_array_elements(selections) x group by (x->>'room_id')::uuid having count(*)>1) or
    (selections->0->>'room_id')::uuid is distinct from p_room or
    (selections->0->>'pricing_version')::bigint is distinct from (p_input->>'pricing_version')::bigint then
    raise exception 'Select each room once and review its configured rates' using errcode='22023'; end if;
  heads:=(p_input->>'occupants')::integer; duration:=(p_input->>'duration_hours')::integer;
  extra:=(p_input->>'extension_hours')::integer; eligible:=(p_input->>'eligible_guests')::integer;
  if heads is null or heads not between 1 and 100 or duration is null or duration not in (3,12) or
    extra is null or extra<0 or extra>168 or eligible is null or eligible<0 or eligible>heads then
    raise exception 'Choose a 3-hour or 12-hour stay, valid extension hours and guest counts' using errcode='22023'; end if;
  start_at:=(p_input->>'starts_at')::timestamptz; finish:=start_at+make_interval(hours=>duration+extra);
  if start_at is null or not isfinite(start_at) or start_at<=clock_timestamp() or
    (p_input->>'ends_at')::timestamptz is distinct from finish then
    raise exception 'Review the scheduled check-in and calculated checkout' using errcode='22023'; end if;
  if length(btrim(coalesce(p_input->>'first_name','')))<1 or length(btrim(coalesce(p_input->>'last_name','')))<1 or
    length(btrim(coalesce(p_input->>'address','')))<3 or coalesce(p_input->>'phone','') !~ '^\+639[0-9]{9}$' then
    raise exception 'Enter the guest name, Philippine mobile number and address' using errcode='22023'; end if;
  if coalesce(p_input->>'commercial_type','') not in ('private_swimming','public_swimming','room_accommodation') or
    (jsonb_array_length(selections)>1 and p_input->>'commercial_type'<>'room_accommodation') then
    raise exception 'Choose Room Accommodation for a multiple-room reservation' using errcode='22023'; end if;

  -- The shared inventory lock also serializes swimming room allocation,
  -- maintenance and rate changes. Validate every room before writing any bill.
  perform pg_advisory_xact_lock(73124,1);
  for item in select value from jsonb_array_elements(selections) order by (value->>'room_id')::uuid loop
    select * into r from public.physical_rooms where room_id=(item->>'room_id')::uuid for update;
    if not found or not r.is_active then raise exception 'Select an active physical room' using errcode='22023'; end if;
    if r.private_swimming_only then
      raise exception 'This room is reserved for the included private swimming package. Choose another room' using errcode='40001'; end if;
    select * into c from public.room_classifications where classification_id=r.classification_id for update;
    if (item->>'pricing_version')::bigint is distinct from c.pricing_version then
      raise exception 'Room rates changed. Refresh the room quote' using errcode='40001'; end if;
    room_heads:=(item->>'occupants')::integer;
    if room_heads is null or room_heads<1 or room_heads>c.maximum_capacity then
      raise exception 'Review the guest count for each room' using errcode='22023'; end if;
    counted:=counted+room_heads;
    base:=case when duration=3 then c.rate_3_hours else c.rate_12_hours end;
    additions:=greatest(0,room_heads-c.included_capacity)*c.additional_guest_rate;
    extension:=extra*c.extension_hourly_rate;
    if base<=0 or (extra>0 and c.extension_hourly_rate<=0) or (room_heads>c.included_capacity and c.additional_guest_rate<=0) then
      raise exception 'Configure room accommodation, extension and additional guest rates first' using errcode='22023'; end if;
    gross:=gross+base+additions+extension;
    perform public.room_assert_available(r.room_id,start_at,finish);
  end loop;
  if heads<>counted then raise exception 'The total guest count must match the occupants assigned to the rooms' using errcode='22023'; end if;

  insert into public.walk_in_guests(first_name,last_name,phone_number,address)
    values(btrim(p_input->>'first_name'),btrim(p_input->>'last_name'),p_input->>'phone',btrim(p_input->>'address')) returning walk_in_guest_id into wid;
  insert into public.reservations(walk_in_guest_id,reference_number,booking_mode,booking_type,commercial_type,room_pricing,start_datetime,end_datetime,adult_count,child_count,status)
    values(wid,'RM-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),'custom','walk_in',p_input->>'commercial_type',true,start_at,finish,heads,0,'pending')
    returning reservation_id,reference_number into rid,ref;
  insert into public.transactions(reservation_id,total_amount,status) values(rid,0,'unpaid');
  for item in select value from jsonb_array_elements(selections) order by (value->>'room_id')::uuid loop
    select * into r from public.physical_rooms where room_id=(item->>'room_id')::uuid;
    select * into c from public.room_classifications where classification_id=r.classification_id;
    room_heads:=(item->>'occupants')::integer;
    base:=case when duration=3 then c.rate_3_hours else c.rate_12_hours end;
    additions:=greatest(0,room_heads-c.included_capacity)*c.additional_guest_rate; extension:=extra*c.extension_hourly_rate;
    snapshot:=jsonb_build_object('version',c.pricing_version,'duration_hours',duration,'accommodation',base,
      'extension_hours',extra,'extension_hourly_rate',c.extension_hourly_rate,'additional_guest_rate',c.additional_guest_rate);
    insert into public.room_assignments(room_id,reservation_id,occupants,starts_at,expected_checkout,pricing_snapshot)
      values(r.room_id,rid,room_heads,start_at,finish,snapshot) returning assignment_id into aid;
    insert into public.room_charges(room_id,reservation_id,kind,description,amount,created_by)
      values(r.room_id,rid,'accommodation',r.room_number||' accommodation ('||duration||' hours)',base,p_staff);
    if additions>0 then insert into public.room_charges(room_id,reservation_id,kind,description,amount,created_by)
      values(r.room_id,rid,'additional_guest',r.room_number||' additional guests',additions,p_staff); end if;
    if extra>0 then
      insert into public.room_charges(room_id,reservation_id,kind,description,amount,created_by)
        values(r.room_id,rid,'extension',r.room_number||' initial extension ('||extra||' hours)',extension,p_staff) returning charge_id into cid;
      insert into public.room_extensions(assignment_id,old_checkout,new_checkout,hours,hourly_rate,charge_id,approved_by)
        values(aid,start_at+make_interval(hours=>duration),finish,extra,c.extension_hourly_rate,cid,p_staff);
    end if;
  end loop;
  -- Existing billing applies one PWD/senior or promo discount to the combined
  -- accommodation charge and retains all extension/additional guest charges.
  if eligible>0 or nullif(btrim(p_input->>'promo_code'),'') is not null then
    result:=public.set_booking_discount(rid,p_staff,eligible,p_input->>'promo_code',gross,p_input->>'discount_reason',false);
  end if;
  select total_amount into net from public.transactions where reservation_id=rid;
  if (p_input->>'expected_total')::numeric is distinct from net then
    raise exception 'Pricing or discount changed. Review the quote again' using errcode='40001'; end if;
  for item in select value from jsonb_array_elements(selections) loop
    select pricing_snapshot into snapshot from public.room_assignments where reservation_id=rid and room_id=(item->>'room_id')::uuid;
    perform public.room_log((item->>'room_id')::uuid,rid,p_staff,'reservation_created','Room assigned using configured stay rates',
      snapshot||jsonb_build_object('total',net,'room_count',jsonb_array_length(selections)));
  end loop;
  return jsonb_build_object('reservation_id',rid,'reference_number',ref,'total_amount',net,'discount',result);
end $$;

-- Preserve the single-room RPC contract while sharing the validated creation
-- and billing implementation. Older clients need no payload changes.
create or replace function public.room_reserve_priced(p_staff uuid,p_room uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  return public.room_reserve_multiple_priced(p_staff,p_room,case when p_input ? 'rooms' then p_input else
    p_input||jsonb_build_object('rooms',jsonb_build_array(jsonb_build_object('room_id',p_room,
      'occupants',p_input->'occupants','pricing_version',p_input->'pricing_version'))) end);
end $$;
revoke all on function public.room_reserve_multiple_priced(uuid,uuid,jsonb),public.room_reserve_priced(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.room_reserve_multiple_priced(uuid,uuid,jsonb),public.room_reserve_priced(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
