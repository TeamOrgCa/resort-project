-- Superseded by public-swimming-session-room-migration.sql for configurable session lengths.
-- Apply AFTER swimming-room-guest-limit-migration.sql.
-- The full five-hour public session uses the existing configured 8-hour room rate.
-- Preserve session/guest limits, inventory protections and all saved charges.
begin;
select pg_advisory_xact_lock(73124,1);
do $$ declare body text; needle text := 'hours:=case when individual then (item->>''durationHours'')::numeric else session_hours end;';
begin
  body:=pg_get_functiondef('public.swimming_allocate_rooms(uuid,uuid,jsonb,boolean)'::regprocedure);
  if position('Five-hour rooms are only available' in body)=0 and position('full configured public swimming session' in body)=0 then
    if position(needle in body)=0 or position('Additional rooms must end within the swimming session' in body)=0
      or position('Guests across additional rooms cannot exceed' in body)=0 then
      raise exception 'Apply the individual room stays, session limit and guest limit migrations first'; end if;
    body:=replace(body,'(''3'',''8'',''12'')','(''3'',''5'',''8'',''12'')');
    body:=replace(body,'Choose a guest count and 3-, 8- or 12-hour stay for each room','Choose a guest count and an available duration for each room');
    body:=replace(body,needle,needle||chr(10)||
      '    if individual and hours=5 and (r.commercial_type<>''public_swimming'' or session_hours<>5) then'||chr(10)||
      '      raise exception ''Five-hour rooms are only available for a five-hour public swimming session'' using errcode=''22023''; end if;');
    execute body;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
