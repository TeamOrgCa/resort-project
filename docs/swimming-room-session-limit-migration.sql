-- Apply AFTER swimming-individual-room-stays-migration.sql.
-- Swimming rooms, including staff-approved extensions, must fit inside the pool session.
-- Existing saved assignments and charges are not rewritten.
begin;
select pg_advisory_xact_lock(73124,1);
-- Reject an invalid duration before choosing physical inventory or writing charges.
do $$ declare body text; needle text := 'finish:=case when individual then r.start_datetime+hours*interval ''1 hour'' else r.end_datetime end;';
begin
  body:=pg_get_functiondef('public.swimming_allocate_rooms(uuid,uuid,jsonb,boolean)'::regprocedure);
  if position('Additional rooms must end within the swimming session' in body)=0 then
    if position(needle in body)=0 then raise exception 'Apply swimming-individual-room-stays-migration.sql first'; end if;
    execute replace(body,needle,needle||chr(10)||'    if finish>r.end_datetime then raise exception ''Additional rooms must end within the swimming session. Choose a shorter room duration'' using errcode=''22023''; end if;');
  end if;
end $$;
create or replace function public.guard_swimming_room_session()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype;
begin
  select * into r from public.reservations where reservation_id=new.reservation_id for share;
  if found and not r.room_pricing and r.commercial_type in ('public_swimming','private_swimming')
    and (new.starts_at<r.start_datetime or new.expected_checkout>r.end_datetime) then
    raise exception 'Additional rooms and extensions must stay within the swimming session and end by swimming checkout' using errcode='22023';
  end if;
  return new;
end $$;
drop trigger if exists guard_swimming_room_session on public.room_assignments;
create trigger guard_swimming_room_session before insert or update of starts_at,expected_checkout,reservation_id on public.room_assignments
  for each row execute function public.guard_swimming_room_session();
revoke all on function public.guard_swimming_room_session() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
