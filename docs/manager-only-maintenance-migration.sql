-- Apply after docs/timed-maintenance-auto-ocular-migration.sql.
-- Only active Managers (stored role staff) with edit_reservation can create or
-- release maintenance blocks. Admin and Cashier access remains read-only.
-- Replaces existing RPC bodies without changing records or role grants.
begin;

create or replace function public.create_timed_maintenance_block(p_name text,p_reason text,p_start timestamptz,p_end timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_day date; v_id uuid; v_actor uuid:=auth.uid();
begin
  if not exists(select 1 from public.staff_users s where s.id=v_actor and s.is_active and
    s.role='staff' and public.refund_staff_permission('edit_reservation')) then
    raise exception 'Authorized manager required' using errcode='42501'; end if;
  if length(trim(coalesce(p_name,''))) not between 1 and 120 or length(trim(coalesce(p_reason,''))) not between 1 and 2000
    or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
    or p_end<=p_start or p_end>p_start+interval '366 days' then
    raise exception 'Enter a valid maintenance period, name and internal reason' using errcode='22023'; end if;
  for v_day in select generate_series((p_start at time zone 'Asia/Manila')::date,
    ((p_end-interval '1 microsecond') at time zone 'Asia/Manila')::date,interval '1 day')::date order by 1 loop
    perform pg_advisory_xact_lock(424242,hashtext(v_day::text));
  end loop;
  -- Ignore expired pending bookings without writing unrelated operational rows.
  if exists(select 1 from public.reservations where status in ('pending','payment_submitted','confirmed','reschedule_requested')
    and (status<>'pending' or payment_deadline_at is null or payment_deadline_at>clock_timestamp())
    and start_datetime<p_end and end_datetime>p_start) then
    raise exception 'An active reservation overlaps this period' using errcode='23P01'; end if;
  if exists(select 1 from public.ocular_visits v join public.ocular_time_slots s on s.slot_id=v.time_slot_id
    where v.status in ('pending','confirmed')
    and ((v.scheduled_date+s.start_time) at time zone 'Asia/Manila')<p_end
    and ((v.scheduled_date+s.end_time) at time zone 'Asia/Manila')>p_start) then
    raise exception 'An ocular visit overlaps this period. Cancel it before blocking this time' using errcode='23P01'; end if;
  insert into public.maintenance_blocks(name,reason,start_date,end_date,start_datetime,end_datetime,created_by)
    values(trim(p_name),trim(p_reason),(p_start at time zone 'Asia/Manila')::date,
      ((p_end-interval '1 microsecond') at time zone 'Asia/Manila')::date,p_start,p_end,v_actor) returning block_id into v_id;
  insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
    select 'guest',id,v_actor,'Scheduled maintenance',
      format('The resort is unavailable due to maintenance from %s to %s (Philippine time).',
        to_char(p_start at time zone 'Asia/Manila','YYYY-MM-DD HH24:MI'),to_char(p_end at time zone 'Asia/Manila','YYYY-MM-DD HH24:MI')),
      '/booking','maintenance_block',v_id from public.guests;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(v_actor,v_actor,'Created maintenance block','maintenance_block',v_id,
      jsonb_build_object('name',trim(p_name),'reason',trim(p_reason),'start_datetime',p_start,'end_datetime',p_end));
  return v_id;
end $$;
-- Retire the date-only write entry point so old callers cannot reintroduce leaks.
drop function if exists public.create_maintenance_block(text,text,date,date);
create or replace function public.release_maintenance_block(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_block public.maintenance_blocks%rowtype; v_actor uuid:=auth.uid();
begin
  if not exists(select 1 from public.staff_users s where s.id=v_actor and s.is_active and
    s.role='staff' and public.refund_staff_permission('edit_reservation')) then
    raise exception 'Authorized manager required' using errcode='42501'; end if;
  select * into v_block from public.maintenance_blocks where block_id=p_id for update;
  if not found or v_block.status<>'active' then raise exception 'Active block not found' using errcode='22023'; end if;
  update public.maintenance_blocks set status='released',released_by=v_actor,released_at=clock_timestamp() where block_id=p_id;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(v_actor,v_actor,'Released maintenance block','maintenance_block',p_id,to_jsonb(v_block));
end $$;

revoke all on function public.create_timed_maintenance_block(text,text,timestamptz,timestamptz) from public,anon;
grant execute on function public.create_timed_maintenance_block(text,text,timestamptz,timestamptz) to authenticated;
revoke all on function public.release_maintenance_block(uuid) from public,anon;
grant execute on function public.release_maintenance_block(uuid) to authenticated;

commit;
