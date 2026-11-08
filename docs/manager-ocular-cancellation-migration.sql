-- Apply after ocular-review and admin-read-only-manager-refunds migrations.
begin;
alter table public.ocular_visits add column if not exists cancellation_reason text;
alter table public.ocular_visits add column if not exists cancelled_at timestamptz;
alter table public.ocular_visits add column if not exists cancelled_by uuid references public.staff_users(id);

create or replace function public.guard_manager_ocular_cancellation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.role() in ('anon','authenticated') and (new.cancelled_by is distinct from old.cancelled_by
    or (exists(select 1 from public.staff_users where id=auth.uid()) and
      (new.status is distinct from old.status or new.cancellation_reason is distinct from old.cancellation_reason or new.cancelled_at is distinct from old.cancelled_at))) then
    raise exception 'Use the manager ocular cancellation action' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_manager_ocular_cancellation() from public,anon,authenticated;
drop trigger if exists guard_manager_ocular_cancellation on public.ocular_visits;
create trigger guard_manager_ocular_cancellation before update of status,cancellation_reason,cancelled_at,cancelled_by on public.ocular_visits
  for each row execute function public.guard_manager_ocular_cancellation();

create or replace function public.cancel_manager_ocular_visit(p_visit uuid,p_reason text,p_staff uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_visit public.ocular_visits%rowtype;
begin
  if not exists(select 1 from public.staff_users s where s.id=p_staff and s.role='staff' and s.is_active
    and exists(select 1 from public.role_permissions rp where rp.role=s.role and 'ocular_approval'=any(rp.permissions))) then
    raise exception 'Manager ocular approval permission required' using errcode='42501'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 5 and 2000 then
    raise exception 'Enter a cancellation reason of 5 to 2000 characters' using errcode='22023'; end if;
  select * into v_visit from public.ocular_visits where visit_id=p_visit for update;
  if not found then raise exception 'Ocular visit not found' using errcode='P0002'; end if;
  if v_visit.status='cancelled' and v_visit.cancelled_by=p_staff and v_visit.cancellation_reason=btrim(p_reason) then
    return to_jsonb(v_visit)||jsonb_build_object('alreadyCancelled',true); end if;
  if v_visit.status not in ('pending','confirmed') then
    raise exception 'Only pending or confirmed ocular visits can be cancelled. Refresh the visit' using errcode='40001'; end if;
  update public.ocular_visits set status='cancelled',cancellation_reason=btrim(p_reason),cancelled_at=clock_timestamp(),cancelled_by=p_staff
    where visit_id=p_visit returning * into v_visit;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff,p_staff,'Cancelled ocular visit','ocular_visit',p_visit,
      jsonb_build_object('reference_number',v_visit.reference_number,'reason',v_visit.cancellation_reason,'scheduled_date',v_visit.scheduled_date));
  return to_jsonb(v_visit)||jsonb_build_object('alreadyCancelled',false);
end $$;
revoke all on function public.cancel_manager_ocular_visit(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.cancel_manager_ocular_visit(uuid,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
