-- Apply after account-access-migration.sql. Guest logins lock after four failures for one minute.
begin;
create or replace function public.record_login_attempt(
  p_email text, p_device_id uuid, p_kind text, p_result text, p_user_id uuid default null
)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_locked_until timestamptz;
begin
  if p_kind not in ('guest', 'staff') or p_result not in ('success', 'failed', 'blocked', 'device_conflict', 'denied', 'logout') then
    raise exception 'Invalid login audit event';
  end if;

  if p_result = 'failed' then
    insert into public.login_lock_state(email, failed_attempts, updated_at)
    values (v_email, 0, now()) on conflict (email) do nothing;

    update public.login_lock_state
    set failed_attempts = case when locked_until > now() then failed_attempts when locked_until is not null and locked_until <= now() then 1 else failed_attempts + 1 end,
        locked_until = case
          when locked_until > now() then locked_until
          when (case when locked_until is not null and locked_until <= now() then 1 else failed_attempts + 1 end) >= case when p_kind = 'guest' then 4 else 5 end
          then now() + interval '1 minute' else null end,
        updated_at = now()
    where email = v_email
    returning locked_until into v_locked_until;
  elsif p_result = 'success' then
    delete from public.login_lock_state where email = v_email;
  end if;

  insert into public.audit_logs(action, entity_type, attempted_email, auth_user_id, device_id)
  values (
    case when p_result = 'logout' then 'Logout'
         when p_result = 'failed' and v_locked_until is not null then 'Login locked'
         else 'Login ' || replace(p_result, '_', ' ') end,
    p_kind || '_session', v_email, p_user_id, p_device_id
  );
  return v_locked_until;
end;
$$;

create or replace function public.guest_login_attempt_state(p_email text)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'attemptsRemaining', case when s.locked_until > now() then 0
      when s.locked_until <= now() then 4 else greatest(4-coalesce(s.failed_attempts,0),0) end,
    'lockedUntil', case when s.locked_until > now() then s.locked_until else null end)
  from (select 1) seed left join public.login_lock_state s on s.email=lower(trim(p_email));
$$;
revoke all on function public.guest_login_attempt_state(text) from public,anon,authenticated;
grant execute on function public.guest_login_attempt_state(text) to service_role;
notify pgrst,'reload schema';
commit;
