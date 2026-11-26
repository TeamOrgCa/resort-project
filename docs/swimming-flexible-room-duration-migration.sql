-- Apply AFTER public-swimming-session-room-migration.sql.
-- Public and private additional rooms may use any positive whole-hour duration within swimming checkout.
-- Individual rooms use the preceding 3/8/12-hour base rate plus rounded-up hourly extensions.
-- Grouped legacy requests retain their pricing; saved charges and stays are not rewritten.
begin;
select pg_advisory_xact_lock(73124,1);
create or replace function public.swimming_allocate_rooms(p_reservation uuid,p_actor uuid,p_rooms jsonb,p_included boolean default false)
returns numeric language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; c public.room_classifications%rowtype;
  item jsonb; candidate record; chosen uuid; qty integer; n integer; count_rooms integer:=0;
  session_hours numeric; hours numeric; finish timestamptz; unit_price numeric; extra_price numeric; heads integer; extras integer;
  individual boolean; total numeric:=0; actor uuid;
  base_hours integer; base_price numeric; extension_hours integer; extension_charge numeric;
begin
  perform pg_advisory_xact_lock(73124,1);
  select * into r from public.reservations where reservation_id=p_reservation for update;
  if not found or r.room_pricing or r.commercial_type not in ('private_swimming','public_swimming') then
    raise exception 'Choose a swimming reservation' using errcode='22023'; end if;
  session_hours:=extract(epoch from r.end_datetime-r.start_datetime)/3600;
  if session_hours is null or session_hours<=0 or session_hours>24 then raise exception 'Choose a swimming session of up to 24 hours' using errcode='22023'; end if;
  if jsonb_typeof(p_rooms) is distinct from 'array' or jsonb_array_length(p_rooms)>20 then
    raise exception 'Choose up to 20 additional rooms' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_rooms) x group by lower(x->>'classificationId')
    having count(*)>1 and bool_or(not (x ? 'occupants' and x ? 'durationHours'))) then
    raise exception 'Set guests and duration separately for each additional room' using errcode='22023'; end if;
  if not p_included and (select coalesce(sum(case when jsonb_typeof(x->'occupants')='number' then (x->>'occupants')::numeric else 0 end),0)
    from jsonb_array_elements(p_rooms) x)>r.adult_count+r.child_count then
    raise exception 'Guests across additional rooms cannot exceed the booking''s total number of guests' using errcode='22023'; end if;
  select id into actor from public.staff_users where id=p_actor and is_active;
  -- All rooms begin together; allocate the longest stays first so shorter stays
  -- cannot consume the only room available for a longer requested duration.
  for item in select value from jsonb_array_elements(p_rooms) order by value->>'classificationId',
    case when jsonb_typeof(value->'durationHours')='number' then (value->>'durationHours')::numeric else session_hours end desc loop
    if jsonb_typeof(item->'quantity') is distinct from 'number' or (item->>'quantity') !~ '^[0-9]+$'
      or jsonb_typeof(item->'pricingVersion') is distinct from 'number' or (item->>'pricingVersion') !~ '^[0-9]+$' then
      raise exception 'Choose valid room quantities and saved rates' using errcode='22023'; end if;
    qty:=(item->>'quantity')::integer; count_rooms:=count_rooms+qty;
    if qty not between 1 and 20 or count_rooms>20 then raise exception 'Choose up to 20 additional rooms' using errcode='22023'; end if;
    select * into c from public.room_classifications where classification_id=(item->>'classificationId')::uuid for share;
    if not found or c.pricing_version is distinct from (item->>'pricingVersion')::bigint then
      raise exception 'Room rates changed. Refresh your room choices' using errcode='40001'; end if;
    individual:=item ? 'occupants' or item ? 'durationHours';
    if individual and (p_included or qty<>1 or jsonb_typeof(item->'durationHours') is distinct from 'number'
      or case when jsonb_typeof(item->'durationHours')='number' then (item->>'durationHours')::numeric<1 or (item->>'durationHours')::numeric>24 or (item->>'durationHours')::numeric<>trunc((item->>'durationHours')::numeric) else true end or jsonb_typeof(item->'occupants') is distinct from 'number'
      or coalesce(item->>'occupants','') !~ '^[0-9]+$') then
      raise exception 'Choose a guest count and whole room hours within your swimming stay' using errcode='22023'; end if;
    hours:=case when individual then (item->>'durationHours')::numeric else session_hours end;
    -- Normalize JSON fractional hours to the exact swimming checkout when equal.
    if individual and abs(hours-session_hours)<=0.000000001 then hours:=trim_scale(session_hours); end if;
    finish:=case when not individual or hours=session_hours then r.end_datetime else r.start_datetime+hours*interval '1 hour' end;
    if finish>r.end_datetime then
      raise exception 'Additional rooms must end within the swimming session. Choose a shorter room duration' using errcode='22023'; end if;
    heads:=case when individual then (item->>'occupants')::integer else least(c.included_capacity,greatest(1,r.adult_count+r.child_count)) end;
    if heads<1 or heads>c.maximum_capacity then raise exception 'Guests must stay within the selected room capacity' using errcode='22023'; end if;
    if p_included and (r.commercial_type<>'private_swimming' or c.code<>'standard' or qty<>2 or jsonb_array_length(p_rooms)<>1) then
      raise exception 'Private swimming includes two Standard rooms' using errcode='22023'; end if;
    if p_included then
      base_hours:=3; base_price:=0; extension_hours:=0; extension_charge:=0; unit_price:=0;
    elsif individual then
      base_hours:=case when hours>=12 then 12 when hours>=8 then 8 else 3 end;
      base_price:=case base_hours when 3 then c.rate_3_hours when 8 then c.rate_8_hours else c.rate_12_hours end;
      if base_price is null or base_price<=0 then
        raise exception 'The %-hour room rate is not configured. Please contact the resort',base_hours using errcode='22023'; end if;
      extension_hours:=greatest(0,ceil(hours-base_hours));
      if extension_hours>0 and (c.extension_hourly_rate is null or c.extension_hourly_rate<=0) then
        raise exception 'The hourly room extension rate is not configured. Please contact the resort' using errcode='22023'; end if;
      extension_charge:=extension_hours*c.extension_hourly_rate;
      unit_price:=base_price+extension_charge;
    else
      -- Compatibility for older grouped requests; existing charges are never repriced.
      base_hours:=case when hours<=3 then 3 when hours<=8 then 8 else 12 end;
      base_price:=case base_hours when 3 then c.rate_3_hours when 8 then c.rate_8_hours else c.rate_12_hours end;
      if base_price is null or base_price<=0 then
        raise exception 'The %-hour room rate is not configured. Please contact the resort',base_hours using errcode='22023'; end if;
      extension_hours:=greatest(0,ceil(hours-12));
      extension_charge:=extension_hours*c.extension_hourly_rate;
      unit_price:=base_price+extension_charge;
    end if;
    extras:=case when p_included then 0 else greatest(0,heads-c.included_capacity) end;
    extra_price:=extras*c.additional_guest_rate;
    for n in 1..qty loop
      chosen:=null;
      for candidate in select room_id,room_number from public.physical_rooms
        where classification_id=c.classification_id and is_active and status<>'maintenance' and private_swimming_only=p_included
        order by room_number for update loop
        begin
          perform public.room_assert_available(candidate.room_id,r.start_datetime,finish);
          chosen:=candidate.room_id; exit;
        exception when serialization_failure or invalid_parameter_value then null; end;
      end loop;
      if chosen is null then raise exception 'Not enough % rooms are available for the selected room duration',c.name using errcode='40001'; end if;
      insert into public.room_assignments(room_id,reservation_id,occupants,starts_at,expected_checkout,pricing_snapshot)
        values(chosen,p_reservation,heads,r.start_datetime,finish,
          jsonb_build_object('swimming_room',true,'included',p_included,'classification_id',c.classification_id,'name',c.name,
            'duration_hours',hours,'version',c.pricing_version,'accommodation',unit_price,'base_hours',base_hours,'base_rate',base_price,
            'extension_hours',extension_hours,'extension_charge',extension_charge,'extension_hourly_rate',c.extension_hourly_rate,
            'extra_guests',extras,'additional_guest_rate',c.additional_guest_rate,'additional_guest_charge',extra_price));
      if not p_included then
        insert into public.room_charges(room_id,reservation_id,kind,description,amount,created_by,auth_actor_id)
          values(chosen,p_reservation,'accommodation',candidate.room_number||' - extra '||c.name||' for swimming session ('||trim_scale(hours)::text||' hours)',case when individual then base_price else unit_price end,actor,p_actor);
        if individual and extension_charge>0 then
          insert into public.room_charges(room_id,reservation_id,kind,description,amount,created_by,auth_actor_id)
            values(chosen,p_reservation,'extension',candidate.room_number||' - room extension ('||extension_hours||' billed hours)',extension_charge,actor,p_actor);
        end if;
        if extra_price>0 then
          insert into public.room_charges(room_id,reservation_id,kind,description,amount,created_by,auth_actor_id)
            values(chosen,p_reservation,'additional_guest',candidate.room_number||' - '||extras||' extra guest(s) for '||trim_scale(hours)::text||'-hour room stay',extra_price,actor,p_actor);
        end if;
      end if;
      perform public.room_log(chosen,p_reservation,p_actor,'reservation_created',case when p_included then 'Standard room included in private swimming package' else 'Extra room reserved for swimming session' end,
        jsonb_build_object('included',p_included,'amount',unit_price+extra_price,'duration_hours',hours,'occupants',heads,'extra_guests',extras));
      total:=total+unit_price+extra_price;
    end loop;
  end loop;
  return total;
end $$;
notify pgrst,'reload schema';
commit;
