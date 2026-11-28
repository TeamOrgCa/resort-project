-- Apply AFTER swimming-staff-room-extension-migration.sql, guest-auto-reschedule-migration.sql,
-- guest-booking-edit-migration.sql and guest-discounts-promos-refund-details-migration.sql.
-- Guest counts/services may change without repricing saved swimming room charges.
-- Reschedules preserve room durations, occupants, prices and assignment history.
begin;
select pg_advisory_xact_lock(73124,1);

-- Only the existing authenticated/ownership-checked, service-role RPCs set this scope.
create or replace function public.swimming_guest_change_allowed(p_reservation uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(current_setting('app.swimming_guest_manage',true),'')=p_reservation::text
    and exists(select 1 from public.reservations where reservation_id=p_reservation
      and commercial_type in ('private_swimming','public_swimming') and not room_pricing);
$$;

do $$ declare signature text; f regprocedure; body text; injection text;
begin
  foreach signature in array array[
    'public.edit_guest_reservation_bill(uuid,uuid,jsonb,jsonb)',
    'public.edit_guest_reservation_bill_with_discount(uuid,uuid,jsonb,jsonb)',
    'public.reschedule_guest_reservation(uuid,uuid,jsonb,timestamptz,timestamptz,numeric,numeric,text)',
    'public.reschedule_guest_reservation_with_discount(uuid,uuid,jsonb,timestamptz,timestamptz,numeric,numeric,text)',
    'public.public_edit_booking(uuid,uuid,jsonb,jsonb,boolean)',
    'public.public_reschedule_booking(uuid,uuid,timestamptz,timestamptz,timestamptz,numeric,text,boolean)'
  ] loop
    f:=to_regprocedure(signature);
    if f is null then raise exception 'Install the prerequisite booking/edit/discount/reschedule migrations first: %',signature; end if;
    body:=pg_get_functiondef(f);
    if signature like 'public.reschedule_guest_reservation(%' then
      body:=replace(body,'status=''active'' and start_date<=v_last and end_date>=v_first',
        'status=''active'' and start_datetime<p_new_end and end_datetime>p_new_start');
      body:=replace(body,'where r.reservation_id<>p_reservation',
        'where r.reservation_id<>p_reservation and not r.room_pricing and r.commercial_type in (''private_swimming'',''public_swimming'')');
    end if;
    if position('app.swimming_guest_manage' in body)=0 then
      injection:='begin'||chr(10)||'  perform pg_advisory_xact_lock(73124,1);'||chr(10)||
        '  perform set_config(''app.swimming_guest_manage'',p_reservation::text,true);';
      execute regexp_replace(body,'\mbegin\M',injection,'i');
    end if;
  end loop;

  -- Retain every existing room-only protection; open only the scoped swimming path.
  foreach signature in array array['public.room_guard_bill_total()','public.room_guard_charged_schedule()','public.room_guard_legacy_edit()'] loop
    f:=signature::regprocedure; body:=pg_get_functiondef(f);
    if position('swimming_guest_change_allowed' in body)=0 then
      if signature='public.room_guard_legacy_edit()' then
        injection:='begin'||chr(10)||
          '  if tg_table_name=''reservation_services'' and public.swimming_guest_change_allowed(case when tg_op=''DELETE'' then old.reservation_id else new.reservation_id end)'||chr(10)||
          '    and not exists(select 1 from public.room_catalog_links where is_active and service_id=case when tg_op=''DELETE'' then old.service_id else new.service_id end) then'||chr(10)||
          '    if tg_op=''DELETE'' then return old; end if; return new; end if;';
      elsif signature='public.room_guard_charged_schedule()' then
        injection:='begin'||chr(10)||
          '  if public.swimming_guest_change_allowed(new.reservation_id) and new.commercial_type=old.commercial_type and new.room_pricing=old.room_pricing and new.booking_mode=old.booking_mode then return new; end if;';
      else
        injection:='begin'||chr(10)||'  if public.swimming_guest_change_allowed(new.reservation_id) then return new; end if;';
      end if;
      execute regexp_replace(body,'\mbegin\M',injection,'i');
    end if;
  end loop;

  -- The legacy synchronizer otherwise expands every swimming room to the full package.
  f:='public.room_sync_reservation()'::regprocedure; body:=pg_get_functiondef(f);
  if position('Swimming rooms are moved separately' in body)=0 then
    injection:='begin'||chr(10)||'  -- Swimming rooms are moved separately with their saved individual durations.'||chr(10)||
      '  if not new.room_pricing and new.commercial_type in (''private_swimming'',''public_swimming'') and (new.start_datetime,new.end_datetime) is distinct from (old.start_datetime,old.end_datetime) then return new; end if;';
    execute regexp_replace(body,'\mbegin\M',injection,'i');
  end if;
end $$;

-- Plan all included and additional rooms together, longest stays first. Never
-- quote fresh rates: a reschedule carries the already-purchased room stays.
create or replace function public.swimming_room_reschedule_plan(p_reservation uuid,p_start timestamptz,p_end timestamptz,p_original_start timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; a record; c public.room_classifications%rowtype; candidate record;
  shift interval; starts timestamptz; finish timestamptz; chosen uuid; used uuid[]:=array[]::uuid[]; plan jsonb:='[]'; included boolean;
begin
  perform pg_advisory_xact_lock(73124,1);
  select * into r from public.reservations where reservation_id=p_reservation;
  if not found or r.room_pricing or r.commercial_type not in ('private_swimming','public_swimming') then return plan; end if;
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<=p_start then
    raise exception 'Choose a valid swimming schedule' using errcode='22023'; end if;
  if r.checked_in_at is not null or exists(select 1 from public.room_assignments where reservation_id=p_reservation and (state='occupied' or checked_in_at is not null)) then
    raise exception 'Room stays cannot be rescheduled after check-in' using errcode='40001'; end if;
  if r.commercial_type='private_swimming' and exists(select 1 from public.room_assignments where reservation_id=p_reservation and pricing_snapshot->>'included'='true') and (select count(*) from public.room_assignments where reservation_id=p_reservation and state='reserved' and pricing_snapshot->>'included'='true')<>2 then
    raise exception 'The included room holds are unavailable. Contact resort staff' using errcode='40001'; end if;
  if (select coalesce(sum((x->>'quantity')::integer),0) from jsonb_array_elements(coalesce(r.swimming_room_choices,'[]'::jsonb)) x)
    <> (select count(*) from public.room_assignments where reservation_id=p_reservation and state='reserved' and pricing_snapshot->>'included'='false') then
    raise exception 'The additional room holds changed. Reload your booking or contact resort staff' using errcode='40001'; end if;
  shift:=p_start-coalesce(p_original_start,r.start_datetime);
  for a in select claim.*,pr.classification_id,pr.private_swimming_only from public.room_assignments claim join public.physical_rooms pr using(room_id)
    where claim.reservation_id=p_reservation and claim.state='reserved'
    order by claim.expected_checkout-claim.starts_at desc,claim.assignment_id loop
    select * into c from public.room_classifications where classification_id=a.classification_id;
    starts:=a.starts_at+shift; finish:=a.expected_checkout+shift; chosen:=null;
    included:=coalesce((a.pricing_snapshot->>'included')::boolean,a.private_swimming_only);
    if starts<p_start or finish>p_end or a.occupants>c.maximum_capacity then
      raise exception 'Saved room stays no longer fit this swimming schedule or room capacity. Contact resort staff' using errcode='40001'; end if;
    for candidate in select pr.* from public.physical_rooms pr where pr.classification_id=c.classification_id and pr.is_active
      and pr.status<>'maintenance' and pr.private_swimming_only=included and not(pr.room_id=any(used))
      order by (pr.room_id=a.room_id) desc,pr.room_number loop
      if not exists(select 1 from public.room_assignments claim join public.reservations booking using(reservation_id)
        where claim.room_id=candidate.room_id and claim.reservation_id<>p_reservation
          and (claim.state='occupied' or claim.state='reserved' and booking.status in ('pending','payment_submitted','confirmed','reschedule_requested')
            and (booking.status<>'pending' or booking.payment_deadline_at is null or booking.payment_deadline_at>clock_timestamp()))
          and (claim.state='occupied' and claim.expected_checkout<clock_timestamp() or
            claim.starts_at<finish+make_interval(mins=>c.cleaning_buffer_minutes) and claim.expected_checkout+make_interval(mins=>c.cleaning_buffer_minutes)>starts))
        and not exists(select 1 from public.room_maintenance m where m.room_id=candidate.room_id and m.completed_at is null
          and (m.ends_at<clock_timestamp() or m.starts_at<finish+make_interval(mins=>c.cleaning_buffer_minutes) and m.ends_at>starts))
        and not exists(select 1 from public.maintenance_blocks m where m.status='active' and m.start_datetime<finish and m.end_datetime>starts) then
        chosen:=candidate.room_id; exit;
      end if;
    end loop;
    if chosen is null then raise exception 'Not enough % rooms are available for your booked room stays, including cleaning buffers',c.name using errcode='40001'; end if;
    used:=array_append(used,chosen);
    plan:=plan||jsonb_build_array(jsonb_build_object('assignmentId',a.assignment_id,'previousRoomId',a.room_id,'roomId',chosen,'startsAt',starts,'checkout',finish));
  end loop;
  return plan;
end $$;

create or replace function public.swimming_move_reserved_rooms()
returns trigger language plpgsql security definer set search_path='' as $$
declare plan jsonb; item jsonb;
begin
  if new.room_pricing or new.commercial_type not in ('private_swimming','public_swimming') or (new.start_datetime,new.end_datetime) is not distinct from (old.start_datetime,old.end_datetime) then return new; end if;
  plan:=public.swimming_room_reschedule_plan(new.reservation_id,new.start_datetime,new.end_datetime,old.start_datetime);
  -- Release this booking's old intervals together before assigning the plan.
  update public.room_assignments set state='cancelled' where reservation_id=new.reservation_id and state='reserved';
  for item in select value from jsonb_array_elements(plan) loop
    update public.room_assignments set room_id=(item->>'roomId')::uuid,starts_at=(item->>'startsAt')::timestamptz,
      expected_checkout=(item->>'checkout')::timestamptz,state='reserved' where assignment_id=(item->>'assignmentId')::uuid;
    perform public.room_log((item->>'roomId')::uuid,new.reservation_id,null,'rescheduled','Swimming room stay moved with reservation; saved charges retained',item);
  end loop;
  return new;
end $$;
drop trigger if exists swimming_move_reserved_rooms on public.reservations;
create trigger swimming_move_reserved_rooms after update of start_datetime,end_datetime on public.reservations
  for each row execute function public.swimming_move_reserved_rooms();

create or replace function public.swimming_room_reschedule_calendar(p_reservation uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; day date; delta interval; result jsonb:='[]'; issue text;
begin
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>31 then raise exception 'Choose a calendar month' using errcode='22023'; end if;
  select * into r from public.reservations where reservation_id=p_reservation;
  if not found then raise exception 'Reservation not found' using errcode='22023'; end if;
  for day in select generate_series(p_from,p_to,interval '1 day')::date loop
    issue:=null; delta:=make_interval(days=>day-(r.start_datetime at time zone 'Asia/Manila')::date);
    begin
      perform public.swimming_room_reschedule_plan(p_reservation,r.start_datetime+delta,r.end_datetime+delta);
    exception when serialization_failure or invalid_parameter_value then issue:=sqlerrm; end;
    result:=result||jsonb_build_array(jsonb_build_object('date',day,'available',issue is null,'reason',issue));
  end loop;
  return result;
end $$;

revoke all on function public.swimming_guest_change_allowed(uuid),public.swimming_room_reschedule_plan(uuid,timestamptz,timestamptz,timestamptz),public.swimming_move_reserved_rooms(),public.swimming_room_reschedule_calendar(uuid,date,date) from public,anon,authenticated;
grant execute on function public.swimming_room_reschedule_calendar(uuid,date,date) to service_role;
notify pgrst,'reload schema';
commit;
