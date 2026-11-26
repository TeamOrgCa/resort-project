-- Apply AFTER swimming-flexible-room-duration-migration.sql.
-- Guest room choices remain inside the swimming session. Authorized staff may
-- extend occupied rooms beyond it using configured rates and inventory checks.
-- Existing assignments, swimming checkout times and saved charges are unchanged.
begin;
select pg_advisory_xact_lock(73124,1);

-- Scope the exception to the existing, permission-checked extension operation.
do $$ declare body text; needle text := 'update public.room_assignments set expected_checkout=finish where assignment_id=a.assignment_id;';
begin
  body:=pg_get_functiondef('public.room_operate_base(uuid,uuid,text,jsonb)'::regprocedure);
  if position('app.staff_room_extension_assignment' in body)=0 then
    if position(needle in body)=0 then raise exception 'Apply the current room management and room rates migrations first'; end if;
    body:=replace(body,needle,
      'perform set_config(''app.staff_room_extension_assignment'',a.assignment_id::text,true);'||chr(10)||
      'perform set_config(''app.staff_room_extension_actor'',p_staff::text,true);'||chr(10)||
      needle||chr(10)||
      'perform set_config(''app.staff_room_extension_assignment'','''',true);'||chr(10)||
      'perform set_config(''app.staff_room_extension_actor'','''',true);');
    execute body;
  end if;
end $$;

create or replace function public.guard_swimming_room_session()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; staff uuid;
begin
  select * into r from public.reservations where reservation_id=new.reservation_id for share;
  if found and not r.room_pricing and r.commercial_type in ('public_swimming','private_swimming') then
    if new.starts_at<r.start_datetime then
      raise exception 'Additional rooms must start within the swimming session' using errcode='22023';
    end if;
    if new.expected_checkout>r.end_datetime then
      if tg_op='UPDATE' then
        if old.state='occupied' and new.state='occupied' and new.room_id=old.room_id
          and new.reservation_id=old.reservation_id and new.starts_at=old.starts_at
          and new.expected_checkout>old.expected_checkout
          and coalesce(current_setting('app.staff_room_extension_assignment',true),'')=new.assignment_id::text then
          staff:=nullif(current_setting('app.staff_room_extension_actor',true),'')::uuid;
          if public.room_staff_allowed(staff,'rooms') and public.room_staff_allowed(staff,'room_operations') then
            return new;
          end if;
        end if;
      end if;
      raise exception 'Additional rooms must end within the swimming session unless extended by authorized staff' using errcode='22023';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_swimming_room_session() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
