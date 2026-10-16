-- Apply after role-permissions and the ocular visit/time-slot tables.
begin;
alter table public.ocular_visits add column if not exists review_reason text;
alter table public.ocular_visits add column if not exists reviewed_at timestamptz;
alter table public.ocular_visits add column if not exists reviewed_by uuid references public.staff_users(id);
alter table public.ocular_visits drop constraint if exists ocular_visits_status_check;
alter table public.ocular_visits add constraint ocular_visits_status_check
  check(status in ('pending','confirmed','rejected','cancelled','completed'));

create or replace function public.guard_ocular_review_write()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if current_user in ('anon','authenticated') and (new.status<>'pending' or new.reviewed_at is not null or new.reviewed_by is not null or new.review_reason is not null) then
      raise exception 'New ocular visits must await staff review' using errcode='42501'; end if;
  else
    if current_user in ('anon','authenticated') and (new.reviewed_at is distinct from old.reviewed_at or new.reviewed_by is distinct from old.reviewed_by
      or new.review_reason is distinct from old.review_reason or (new.status is distinct from old.status and new.status in ('confirmed','rejected'))) then
      raise exception 'Use the authorized ocular review action' using errcode='42501'; end if;
    if new.status is distinct from old.status and new.status in ('confirmed','rejected') and (old.status<>'pending'
      or length(btrim(coalesce(new.review_reason,''))) not between 5 and 2000 or new.reviewed_at is null or new.reviewed_by is null) then
      raise exception 'Review a pending ocular visit and document a reason' using errcode='22023'; end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_ocular_review_write on public.ocular_visits;
create trigger guard_ocular_review_write before insert or update on public.ocular_visits for each row execute function public.guard_ocular_review_write();

create or replace function public.review_ocular_visit(p_visit uuid,p_action text,p_reason text,p_staff uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_visit public.ocular_visits%rowtype; v_time time; v_status text;
begin
  if not exists(select 1 from public.staff_users s where s.id=p_staff and s.is_active
    and (s.role='admin' or exists(select 1 from public.role_permissions rp where rp.role=s.role and 'ocular_approval'=any(rp.permissions)))) then
    raise exception 'Ocular approval permission required' using errcode='42501'; end if;
  if p_action is null or p_action not in ('approve','reject') or length(btrim(coalesce(p_reason,''))) not between 5 and 2000 then
    raise exception 'Choose approve or reject and enter a reason of 5 to 2000 characters' using errcode='22023'; end if;
  v_status:=case when p_action='approve' then 'confirmed' else 'rejected' end;
  select * into v_visit from public.ocular_visits where visit_id=p_visit for update;
  if not found then raise exception 'Ocular visit not found' using errcode='P0002'; end if;
  if v_visit.status=v_status and v_visit.reviewed_by=p_staff and v_visit.review_reason=btrim(p_reason) then
    return to_jsonb(v_visit)||jsonb_build_object('alreadyReviewed',true); end if;
  if v_visit.status<>'pending' then raise exception 'This ocular visit was already reviewed. Refresh the calendar' using errcode='40001'; end if;
  if p_action='approve' then
    select start_time into v_time from public.ocular_time_slots where slot_id=v_visit.time_slot_id;
    if v_time is null or ((v_visit.scheduled_date+v_time) at time zone 'Asia/Manila')<=clock_timestamp() then
      raise exception 'Only a future ocular visit with an available time slot can be approved' using errcode='40001'; end if;
  end if;
  update public.ocular_visits set status=v_status,review_reason=btrim(p_reason),reviewed_at=clock_timestamp(),reviewed_by=p_staff
    where visit_id=p_visit returning * into v_visit;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff,p_staff,case when p_action='approve' then 'Approved ocular visit' else 'Rejected ocular visit' end,'ocular_visit',p_visit,
      jsonb_build_object('reference_number',v_visit.reference_number,'reason',btrim(p_reason),'status',v_status,'scheduled_date',v_visit.scheduled_date));
  return to_jsonb(v_visit)||jsonb_build_object('alreadyReviewed',false);
end $$;
revoke all on function public.review_ocular_visit(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.review_ocular_visit(uuid,text,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
