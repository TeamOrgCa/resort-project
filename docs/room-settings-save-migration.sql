-- Apply AFTER swimming-room-eight-hour-rate-migration.sql.
-- Saves Room Settings independently of older room_operate configuration handlers.
-- Prices, capacities, cleaning buffers, rate history and audit records commit together.
begin;
create or replace function public.room_configure_classification(p_staff uuid,p_room uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.physical_rooms%rowtype; c public.room_classifications%rowtype;
  a public.room_assignments%rowtype; included integer; maximum integer; buffer integer;
begin
  if not public.room_staff_allowed(p_staff,'configuration') or not public.room_staff_allowed(p_staff,'rooms') then
    raise exception 'Admin room configuration access required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(73124,1);
  select * into r from public.physical_rooms where room_id=p_room for update;
  if not found then raise exception 'Room not found. Refresh Room Settings' using errcode='22023'; end if;
  included:=(p_input->>'included_capacity')::integer;
  maximum:=(p_input->>'maximum_capacity')::integer;
  buffer:=(p_input->>'cleaning_buffer_minutes')::integer;
  if jsonb_typeof(p_input->'name') is distinct from 'string' or length(btrim(p_input->>'name')) not between 2 and 100
    or included is null or maximum is null or buffer is null
    or included not between 1 and 100 or maximum not between included and 100 or buffer not between 0 and 1440 then
    raise exception 'Enter valid room name, capacities and cleaning buffer' using errcode='22023'; end if;
  if exists(select 1 from public.room_assignments claim join public.physical_rooms pr using(room_id)
    where pr.classification_id=r.classification_id and claim.state in ('reserved','occupied') and claim.occupants>maximum) then
    raise exception 'Capacity cannot invalidate existing room reservations' using errcode='40001'; end if;
  perform public.room_save_rates(p_staff,r.classification_id,(p_input->>'pricing_version')::bigint,p_input);
  update public.room_classifications set name=btrim(p_input->>'name'),included_capacity=included,maximum_capacity=maximum,
    cleaning_buffer_minutes=buffer where classification_id=r.classification_id returning * into c;
  -- Fail atomically if an older rate publisher is still installed.
  if c.rate_3_hours is distinct from (p_input->>'rate_3_hours')::numeric
    or c.rate_12_hours is distinct from (p_input->>'rate_12_hours')::numeric
    or (p_input ? 'rate_8_hours' and c.rate_8_hours is distinct from (p_input->>'rate_8_hours')::numeric)
    or c.additional_guest_rate is distinct from (p_input->>'additional_guest_rate')::numeric
    or c.extension_hourly_rate is distinct from (p_input->>'extension_hourly_rate')::numeric
    or c.pricing_version is distinct from (p_input->>'pricing_version')::bigint+1 then
    raise exception 'Room prices were not published. Apply swimming-room-eight-hour-rate-migration.sql and retry' using errcode='22023'; end if;
  for a in select claim.* from public.room_assignments claim join public.physical_rooms pr using(room_id)
    where pr.classification_id=c.classification_id and claim.state in ('reserved','occupied') loop
    perform public.room_assert_available(a.room_id,a.starts_at,a.expected_checkout,a.assignment_id);
  end loop;
  update public.physical_rooms set updated_at=clock_timestamp() where room_id=p_room;
  perform public.room_log(p_room,null,p_staff,'configure','Room classification settings saved',to_jsonb(c));
  return jsonb_build_object('success',true,'room_id',p_room,'classification',to_jsonb(c));
end $$;
revoke all on function public.room_configure_classification(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.room_configure_classification(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
