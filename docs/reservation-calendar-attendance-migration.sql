-- Apply after role-permissions and reservation lifecycle migrations.
-- Existing reservations have unknown attendance until staff record actual arrival.
begin;
alter table public.reservations add column if not exists checked_in_at timestamptz;
alter table public.reservations add column if not exists checked_in_by uuid references public.staff_users(id);

create or replace function public.guard_reservation_attendance()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Invoker context: browser clients cannot forge arrival records.
  if current_user in ('anon','authenticated') then
    if tg_op = 'INSERT' then
      if new.checked_in_at is not null or new.checked_in_by is not null then
        raise exception 'Use the staff check-in action to record arrival' using errcode='42501';
      end if;
    elsif new.checked_in_at is distinct from old.checked_in_at or new.checked_in_by is distinct from old.checked_in_by then
      raise exception 'Use the staff check-in action to record arrival' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_reservation_attendance on public.reservations;
create trigger guard_reservation_attendance before insert or update on public.reservations
for each row execute function public.guard_reservation_attendance();

create or replace function public.check_in_reservation(p_reservation uuid, p_staff uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_r public.reservations%rowtype;
begin
  if not exists(select 1 from public.staff_users s where s.id=p_staff and s.is_active
    and (s.role='admin' or exists(select 1 from public.role_permissions rp where rp.role=s.role and 'edit_reservation'=any(rp.permissions)))) then
    raise exception 'Reservation check-in permission required' using errcode='42501';
  end if;
  select * into v_r from public.reservations where reservation_id=p_reservation for update;
  if not found then raise exception 'Reservation not found' using errcode='P0002'; end if;
  if v_r.checked_in_at is not null then return to_jsonb(v_r); end if;
  if v_r.status <> 'confirmed' or (v_r.start_datetime at time zone 'Asia/Manila')::date <> (clock_timestamp() at time zone 'Asia/Manila')::date
    or v_r.end_datetime <= clock_timestamp() then
    raise exception 'Only a confirmed reservation arriving today can be checked in' using errcode='40001';
  end if;
  update public.reservations set checked_in_at=clock_timestamp(),checked_in_by=p_staff
    where reservation_id=p_reservation returning * into v_r;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff,p_staff,'Recorded guest check-in','reservation',p_reservation,
      jsonb_build_object('checked_in_at',v_r.checked_in_at,'reference_number',v_r.reference_number));
  return to_jsonb(v_r);
end $$;
revoke all on function public.check_in_reservation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.check_in_reservation(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
