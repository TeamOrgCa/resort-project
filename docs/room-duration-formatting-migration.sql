-- Apply AFTER swimming-room-addons-migration.sql. Safe after the dedicated
-- private-room migration too: preserve its inventory filters and all pricing.
-- Existing charge/history records are immutable and are formatted at display.
begin;
do $$ declare body text; begin
  body:=pg_get_functiondef('public.swimming_allocate_rooms(uuid,uuid,jsonb,boolean)'::regprocedure);
  if position($new$||trim_scale(hours)::text||' hours)'$new$ in body)=0 then
    if position($old$||hours||' hours)'$old$ in body)=0 then
      raise exception 'Unexpected swimming room allocator. Apply swimming-room-addons-migration.sql first';
    end if;
    body:=replace(body,$old$||hours||' hours)'$old$,$new$||trim_scale(hours)::text||' hours)'$new$);
    execute body;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
