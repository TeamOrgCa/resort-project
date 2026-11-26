-- Apply AFTER swimming-room-session-limit-migration.sql.
-- Declared guests across additional rooms cannot exceed swimming admission guests.
-- The included private package rooms do not consume declared additional-room places.
-- Existing saved bookings, assignments and charges are not rewritten.
begin;
select pg_advisory_xact_lock(73124,1);
do $$ declare body text; needle text := 'select id into actor from public.staff_users where id=p_actor and is_active;';
begin
  body:=pg_get_functiondef('public.swimming_allocate_rooms(uuid,uuid,jsonb,boolean)'::regprocedure);
  if position('Guests across additional rooms cannot exceed' in body)=0 then
    if position(needle in body)=0 then raise exception 'Apply the current swimming individual room stays and session limit migrations first'; end if;
    execute replace(body,needle,
      'if not p_included and (select coalesce(sum(case when jsonb_typeof(x->''occupants'')=''number'' then (x->>''occupants'')::numeric else 0 end),0) from jsonb_array_elements(p_rooms) x)>r.adult_count+r.child_count then'||chr(10)||
      '    raise exception ''Guests across additional rooms cannot exceed the booking''''s total number of guests'' using errcode=''22023''; end if;'||chr(10)||needle);
  end if;
end $$;

-- Keep the rule intact if a guest or staff member later reduces admissions.
create or replace function public.guard_swimming_room_guest_count()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not new.room_pricing and new.commercial_type in ('private_swimming','public_swimming')
    and jsonb_typeof(new.swimming_room_choices)='array'
    and (select coalesce(sum(case when jsonb_typeof(x->'occupants')='number' then (x->>'occupants')::numeric else 0 end),0)
      from jsonb_array_elements(new.swimming_room_choices) x)>new.adult_count+new.child_count then
    raise exception 'Guests across additional rooms cannot exceed the booking''s total number of guests. Review the room guest counts first' using errcode='22023';
  end if;
  return new;
end $$;
drop trigger if exists guard_swimming_room_guest_count on public.reservations;
create trigger guard_swimming_room_guest_count before update of adult_count,child_count,swimming_room_choices on public.reservations
  for each row execute function public.guard_swimming_room_guest_count();
revoke all on function public.guard_swimming_room_guest_count() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
