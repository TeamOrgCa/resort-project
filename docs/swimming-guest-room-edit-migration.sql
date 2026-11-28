-- Apply AFTER swimming-guest-manage-migration.sql.
-- Room changes, guest/service edits, inventory and the quoted net bill commit together.
-- Existing charges, payments, receipts and included private rooms are retained.
begin;
select pg_advisory_xact_lock(73124,1);

-- A removal is an immutable credit entry, never deletion of a purchased charge.
alter table public.room_charges drop constraint if exists room_charges_kind_check;
alter table public.room_charges add constraint room_charges_kind_check
  check(kind in ('accommodation','additional_guest','extension','additional_service','room_adjustment'));
alter table public.room_charges drop constraint if exists room_charges_amount_check;
alter table public.room_charges add constraint room_charges_amount_check
  check((kind='room_adjustment' and amount<0) or (kind<>'room_adjustment' and amount>=0));

create or replace function public.guard_swimming_room_credit()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.kind='room_adjustment' and (not public.swimming_guest_change_allowed(new.reservation_id)
    or coalesce(current_setting('app.swimming_room_edit',true),'')<>new.reservation_id::text) then
    raise exception 'Room credits require the authorized room editing action' using errcode='42501'; end if;
  return new;
end $$;
drop trigger if exists guard_swimming_room_credit on public.room_charges;
create trigger guard_swimming_room_credit before insert on public.room_charges for each row execute function public.guard_swimming_room_credit();

-- Admissions and room occupants may decrease in one atomic edit. Validate the
-- replacement room set before returning; other guest-count edits keep this guard.
do $$ declare body text;
begin
  body:=pg_get_functiondef('public.guard_swimming_room_guest_count()'::regprocedure);
  if position('app.swimming_room_edit' in body)=0 then
    execute regexp_replace(body,'\mbegin\M','begin'||chr(10)||
      '  if public.swimming_guest_change_allowed(new.reservation_id) and coalesce(current_setting(''app.swimming_room_edit'',true),'''')=new.reservation_id::text then return new; end if;','i');
  end if;
end $$;

-- Same public inventory as booking, excluding this owner's existing assignments.
-- Maintenance and other reservations remain blocked, including cleaning buffers.
create or replace function public.swimming_room_edit_catalog(p_reservation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; catalog jsonb; rooms jsonb;
begin
  select * into r from public.reservations where reservation_id=p_reservation;
  if not found or r.room_pricing or r.commercial_type not in ('private_swimming','public_swimming') then
    raise exception 'Choose a swimming booking' using errcode='22023'; end if;
  catalog:=public.room_guest_catalog(r.start_datetime,r.end_datetime);
  select coalesce(jsonb_agg(jsonb_build_object('room_id',pr.room_id,'classification_id',pr.classification_id,'private_swimming_only',pr.private_swimming_only,
    'unavailable',pr.status='maintenance' or exists(select 1 from public.room_assignments a where a.room_id=pr.room_id and a.reservation_id<>p_reservation and a.state='occupied' and a.expected_checkout<clock_timestamp())
      or exists(select 1 from public.room_maintenance m where m.room_id=pr.room_id and m.completed_at is null and m.ends_at<clock_timestamp()),
    'blocks',coalesce((select jsonb_agg(jsonb_build_object('start_datetime',s,'end_datetime',e)) from (
      select a.starts_at-make_interval(mins=>c.cleaning_buffer_minutes) s,a.expected_checkout+make_interval(mins=>c.cleaning_buffer_minutes) e
        from public.room_assignments a join public.reservations booking using(reservation_id) where a.room_id=pr.room_id and a.reservation_id<>p_reservation
        and (a.state='occupied' or a.state='reserved' and booking.status in ('pending','payment_submitted','confirmed','reschedule_requested')
          and (booking.status<>'pending' or booking.payment_deadline_at is null or booking.payment_deadline_at>clock_timestamp()))
      union all select m.starts_at-make_interval(mins=>c.cleaning_buffer_minutes),m.ends_at from public.room_maintenance m where m.room_id=pr.room_id and m.completed_at is null
      union all select m.start_datetime,m.end_datetime from public.maintenance_blocks m where m.status='active'
    ) windows where s<r.end_datetime and e>r.start_datetime),'[]'::jsonb)) order by pr.room_number),'[]'::jsonb) into rooms
    from public.physical_rooms pr join public.room_classifications c using(classification_id) where pr.is_active;
  return jsonb_set(catalog,'{rooms}',rooms);
end $$;

create or replace function public.edit_guest_swimming_rooms(p_reservation uuid,p_guest uuid,p_expected jsonb,p_patch jsonb,p_rooms jsonb,p_expected_final numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; t public.transactions%rowtype; a public.room_assignments%rowtype;
  line jsonb; kept uuid[]:=array[]::uuid[]; seen uuid[]:=array[]::uuid[]; old_snapshot jsonb;
  candidate record; chosen uuid;
  unchanged boolean; old_choices jsonb; normalized jsonb; result jsonb; final_total numeric; final_paid numeric; credit numeric;
begin
  perform pg_advisory_xact_lock(73124,1);
  select * into r from public.reservations where reservation_id=p_reservation for update;
  if not found or p_guest is null or r.guest_id is distinct from p_guest or (auth.uid() is not null and auth.uid()<>p_guest)
    or not exists(select 1 from public.guests where id=p_guest and is_active) then raise exception 'Booking owner required' using errcode='42501'; end if;
  if r.room_pricing or r.commercial_type not in ('public_swimming','private_swimming') or r.status not in ('pending','confirmed')
    or r.checked_in_at is not null or r.start_datetime<=clock_timestamp()
    or exists(select 1 from public.room_assignments where reservation_id=p_reservation and (state='occupied' or checked_in_at is not null)) then
    raise exception 'Additional rooms can only be edited before check-in' using errcode='40001'; end if;
  if jsonb_typeof(p_rooms) is distinct from 'array' or jsonb_array_length(p_rooms)>20 or p_expected_final is null
    or p_expected_final::text in ('NaN','Infinity','-Infinity') or p_expected_final<0 then raise exception 'Choose valid additional rooms and review the total' using errcode='22023'; end if;
  select * into t from public.transactions where reservation_id=p_reservation for update;
  select coalesce(jsonb_agg(jsonb_build_object('assignmentId',assignment_id,'roomId',room_id,'occupants',occupants,
    'startsAt',extract(epoch from starts_at),'checkout',extract(epoch from expected_checkout),'pricingSnapshot',pricing_snapshot) order by assignment_id),'[]'::jsonb)
    into old_snapshot from public.room_assignments where reservation_id=p_reservation and state='reserved';
  if old_snapshot is distinct from p_expected->'swimmingRooms' then raise exception 'Room assignments changed. Reload the booking before saving' using errcode='40001'; end if;
  if (select coalesce(sum((x->>'occupants')::integer),0) from jsonb_array_elements(p_rooms) x)>(p_patch->>'adultCount')::integer+(p_patch->>'childCount')::integer then
    raise exception 'Guests across additional rooms cannot exceed booking guests' using errcode='22023'; end if;
  old_choices:=r.swimming_room_choices;
  for line in select value from jsonb_array_elements(p_rooms) loop
    if jsonb_typeof(line->'quantity') is distinct from 'number' or (line->>'quantity')::numeric<>1
      or jsonb_typeof(line->'occupants') is distinct from 'number' or jsonb_typeof(line->'durationHours') is distinct from 'number'
      or jsonb_typeof(line->'pricingVersion') is distinct from 'number' or jsonb_typeof(line->'classificationId') is distinct from 'string' then
      raise exception 'Set valid guests and duration for each room separately' using errcode='22023'; end if;
    unchanged:=false;
    if line ? 'assignmentId' then
      if (line->>'assignmentId')::uuid=any(seen) then raise exception 'Choose each room assignment once' using errcode='22023'; end if;
      seen:=array_append(seen,(line->>'assignmentId')::uuid);
      select * into a from public.room_assignments where assignment_id=(line->>'assignmentId')::uuid and reservation_id=p_reservation
        and state='reserved' and pricing_snapshot->>'swimming_room'='true' and pricing_snapshot->>'included'='false' for update;
      if not found then raise exception 'The additional room changed or does not belong to this booking' using errcode='40001'; end if;
      unchanged:=(line->>'classificationId')::uuid=(a.pricing_snapshot->>'classification_id')::uuid
        and (line->>'occupants')::numeric=a.occupants and (line->>'durationHours')::numeric=extract(epoch from a.expected_checkout-a.starts_at)/3600;
      if unchanged then kept:=array_append(kept,a.assignment_id); end if;
    end if;
  end loop;
  perform set_config('app.swimming_guest_manage',p_reservation::text,true);
  perform set_config('app.swimming_room_edit',p_reservation::text,true);
  -- The room guest guard is deferred only inside this operation, so counts and
  -- room occupants can decrease together without changing the expected snapshot.
  if r.commercial_type='public_swimming' then
    result:=public.public_edit_booking(p_reservation,p_guest,p_expected,p_patch);
  elsif t.discount_amount<>0 or t.discount_eligible_guests<>0 or t.discount_promo_code is not null then
    result:=public.edit_guest_reservation_bill_with_discount(p_reservation,p_guest,p_expected,p_patch);
  else result:=public.edit_guest_reservation_bill(p_reservation,p_guest,p_expected,p_patch);
  end if;
  for a in select * from public.room_assignments where reservation_id=p_reservation and state='reserved'
    and pricing_snapshot->>'swimming_room'='true' and pricing_snapshot->>'included'='false' and not(assignment_id=any(kept)) order by assignment_id for update loop
    update public.room_assignments set state='cancelled' where assignment_id=a.assignment_id;
    credit:=coalesce((a.pricing_snapshot->>'accommodation')::numeric,0)+coalesce((a.pricing_snapshot->>'additional_guest_charge')::numeric,0);
    if credit>0 then
      insert into public.room_charges(room_id,reservation_id,kind,description,amount,created_by,auth_actor_id)
        values(a.room_id,p_reservation,'room_adjustment','Additional room credit - '||coalesce(a.pricing_snapshot->>'name','Room')||' ('||trim_scale(extract(epoch from a.expected_checkout-a.starts_at)/3600)::text||' hours)',-credit,null,p_guest);
    end if;
    perform public.room_log(a.room_id,p_reservation,p_guest,'reservation_released','Guest removed or changed additional room; saved room charge credited',jsonb_build_object('assignment_id',a.assignment_id,'credit',credit));
  end loop;
  -- Allocate the whole requested set longest-first, including unchanged rooms.
  -- A kept short stay must not occupy the only room that can fit a new long stay.
  -- Its assignment ID and price remain intact even if the physical room changes.
  update public.room_assignments set state='cancelled' where assignment_id=any(kept);
  for line in select value from jsonb_array_elements(p_rooms) order by (value->>'durationHours')::numeric desc loop
    if line ? 'assignmentId' and (line->>'assignmentId')::uuid=any(kept) then
      select * into a from public.room_assignments where assignment_id=(line->>'assignmentId')::uuid;
      chosen:=null;
      for candidate in select * from public.physical_rooms where classification_id=(a.pricing_snapshot->>'classification_id')::uuid
        and is_active and not private_swimming_only and status<>'maintenance' order by (room_id=a.room_id) desc,room_number for update loop
        begin
          perform public.room_assert_available(candidate.room_id,a.starts_at,a.expected_checkout,a.assignment_id);
          chosen:=candidate.room_id; exit;
        exception when serialization_failure or invalid_parameter_value then null; end;
      end loop;
      if chosen is null then raise exception 'Not enough rooms are available for the saved room stays. Refresh room availability' using errcode='40001'; end if;
      update public.room_assignments set state='reserved',room_id=chosen where assignment_id=a.assignment_id;
      if chosen<>a.room_id then perform public.room_log(chosen,p_reservation,p_guest,'rescheduled','Physical room reassigned during guest room edit; saved room price retained',jsonb_build_object('previous_room_id',a.room_id,'assignment_id',a.assignment_id)); end if;
    else
      perform public.swimming_allocate_rooms(p_reservation,p_guest,jsonb_build_array(line-'assignmentId'),false);
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('classificationId',pricing_snapshot->>'classification_id','quantity',1,'pricingVersion',(pricing_snapshot->>'version')::bigint,
    'occupants',occupants,'durationHours',extract(epoch from expected_checkout-starts_at)/3600) order by assignment_id),'[]'::jsonb)
    into normalized from public.room_assignments where reservation_id=p_reservation and state='reserved' and pricing_snapshot->>'swimming_room'='true' and pricing_snapshot->>'included'='false';
  update public.reservations set swimming_room_choices=normalized,updated_at=clock_timestamp() where reservation_id=p_reservation;
  if (select coalesce(sum((x->>'occupants')::integer),0) from jsonb_array_elements(normalized) x)>(p_patch->>'adultCount')::integer+(p_patch->>'childCount')::integer then
    raise exception 'Guests across additional rooms cannot exceed booking guests' using errcode='22023'; end if;
  select total_amount,paid_amount into final_total,final_paid from public.transactions where reservation_id=p_reservation;
  if final_total is distinct from p_expected_final then raise exception 'Room prices or the bill changed. Refresh rooms and review the new total' using errcode='40001'; end if;
  insert into public.audit_logs(auth_user_id,action,entity_type,entity_id,details)
    values(p_guest,'Guest edited additional swimming rooms','reservation',p_reservation,jsonb_build_object('before_rooms',old_choices,'after_rooms',normalized,'before_total',t.total_amount,'after_total',final_total));
  perform set_config('app.swimming_room_edit','',true);
  return result||jsonb_build_object('totalAmount',final_total,'paidAmount',final_paid,'remainingBalance',greatest(0,final_total-final_paid),'overpaidAmount',greatest(0,final_paid-final_total));
end $$;
revoke all on function public.guard_swimming_room_credit(),public.swimming_room_edit_catalog(uuid),public.edit_guest_swimming_rooms(uuid,uuid,jsonb,jsonb,jsonb,numeric) from public,anon,authenticated;
grant execute on function public.swimming_room_edit_catalog(uuid),public.edit_guest_swimming_rooms(uuid,uuid,jsonb,jsonb,jsonb,numeric) to service_role;
notify pgrst,'reload schema';
commit;
