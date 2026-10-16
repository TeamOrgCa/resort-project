-- Run after the account-access, reservation and refund migrations, before deploying the app.
begin;
alter table public.guests add column if not exists is_active boolean not null default true;
alter table public.audit_logs add column if not exists details jsonb;

create or replace function public.require_guest_account_admin()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if not exists (select 1 from public.staff_users s where s.id = v_actor and s.is_active
    and s.role = 'admin' and s.active_session_id is not null
    and s.active_session_id::text = auth.jwt()->>'session_id') then
    raise exception 'Only an active administrator may manage guest accounts' using errcode = '42501';
  end if;
  return v_actor;
end $$;
revoke all on function public.require_guest_account_admin() from public, anon;
grant execute on function public.require_guest_account_admin() to authenticated;

-- The legacy own-staff-profile update policy must not allow self-promotion or session forgery.
-- Staff administration already uses trusted server writes; ordinary profile fields stay editable.
create or replace function public.guard_staff_access_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and (new.role is distinct from old.role or new.is_active is distinct from old.is_active
    or new.active_session_id is distinct from old.active_session_id) then
    perform public.require_guest_account_admin();
  end if;
  return new;
end $$;
drop trigger if exists guard_staff_access_fields on public.staff_users;
create trigger guard_staff_access_fields before update on public.staff_users
  for each row execute function public.guard_staff_access_fields();

create or replace function public.admin_guest_accounts(p_search text default '', p_status text default 'all', p_page integer default 0, p_page_size integer default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_guest_account_admin();
  if p_status is null or p_status not in ('all','active','inactive') or p_page is null or p_page < 0
    or p_page > 1000000 or p_page_size is null or p_page_size < 1 or p_page_size > 50
    or p_search is null or length(p_search) > 200 then
    raise exception 'Invalid guest account filters' using errcode = '22023';
  end if;
  return (with filtered as (
    select g.id, g.first_name, g.middle_name, g.last_name, g.email, g.phone_number, g.is_active, g.created_at,
      (u.email_confirmed_at is not null) as email_confirmed
    from public.guests g join auth.users u on u.id = g.id
    where not exists (select 1 from public.staff_users s where s.id = g.id)
      and (p_status = 'all' or g.is_active = (p_status = 'active'))
      and (btrim(p_search) = '' or position(lower(btrim(p_search)) in
        lower(concat_ws(' ',g.first_name,g.middle_name,g.last_name,g.email,g.phone_number))) > 0)
  ), page_rows as (select * from filtered order by created_at desc, id limit p_page_size offset p_page * p_page_size)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id) from page_rows p),'[]'::jsonb),
    'total',(select count(*) from filtered)));
end $$;
revoke all on function public.admin_guest_accounts(text,text,integer,integer) from public, anon;
grant execute on function public.admin_guest_accounts(text,text,integer,integer) to authenticated;

create or replace function public.set_guest_account_status(p_guest uuid, p_is_active boolean, p_expected_active boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.require_guest_account_admin(); v_guest public.guests%rowtype;
begin
  if p_is_active is null or p_expected_active is null or coalesce(length(p_reason),0) > 1000 then
    raise exception 'Invalid guest account status' using errcode = '22023';
  end if;
  if exists (select 1 from public.staff_users where id = p_guest) then
    raise exception 'Manage staff access through Staff Accounts' using errcode = '22023';
  end if;
  select * into v_guest from public.guests where id = p_guest for update;
  if not found then raise exception 'Guest account not found' using errcode = 'P0002'; end if;
  if v_guest.is_active = p_is_active then return jsonb_build_object('id',p_guest,'is_active',p_is_active); end if;
  if v_guest.is_active is distinct from p_expected_active then
    raise exception 'Guest account status changed. Refresh before trying again' using errcode = '40001';
  end if;
  update public.guests set is_active = p_is_active, active_session_id = null, updated_at = now() where id = p_guest;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(v_actor,v_actor,case when p_is_active then 'Guest reactivated' else 'Guest deactivated' end,'guest_account',p_guest,
      jsonb_build_object('before',jsonb_build_object('is_active',v_guest.is_active),'after',jsonb_build_object('is_active',p_is_active),
        'reason',nullif(btrim(p_reason),''),'sessions_cleared',true));
  return jsonb_build_object('id',p_guest,'is_active',p_is_active);
end $$;
revoke all on function public.set_guest_account_status(uuid,boolean,boolean,text) from public, anon;
grant execute on function public.set_guest_account_status(uuid,boolean,boolean,text) to authenticated;

-- Guests may edit their profile, but cannot change their own account status.
create or replace function public.guard_guest_account_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and ((tg_op = 'INSERT' and (not new.is_active or new.active_session_id is not null))
    or (tg_op = 'UPDATE' and (new.is_active is distinct from old.is_active or new.active_session_id is distinct from old.active_session_id))) then
    perform public.require_guest_account_admin();
  end if;
  return new;
end $$;
drop trigger if exists guard_guest_account_status on public.guests;
create trigger guard_guest_account_status before insert or update on public.guests
  for each row execute function public.guard_guest_account_status();

-- Block inactive guests writing directly through Supabase or a guest RPC, even with an old JWT.
-- Service jobs and staff operations keep their existing permissions and booking workflows.
create or replace function public.guard_inactive_guest_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.guests where id = auth.uid() and not is_active)
    and not exists (select 1 from public.staff_users where id = auth.uid() and is_active) then
    raise exception 'Your guest account has been deactivated. Please contact the resort' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
do $$ declare v_table text; begin
  foreach v_table in array array['guests','reservations','reservation_reschedules','reservation_services','reservation_units',
    'payments','refund_requests','ocular_visits','reviews'] loop
    if to_regclass('public.' || v_table) is not null then
      execute format('drop trigger if exists guard_inactive_guest_write on public.%I',v_table);
      execute format('create trigger guard_inactive_guest_write before insert or update or delete on public.%I for each row execute function public.guard_inactive_guest_write()',v_table);
    end if;
  end loop;
end $$;
commit;
