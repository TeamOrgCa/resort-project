-- Run once on an existing database before deploying the account access routes.
alter table public.audit_logs add column if not exists attempted_email text;
alter table public.audit_logs add column if not exists auth_user_id uuid;
alter table public.audit_logs add column if not exists device_id uuid;

create table if not exists public.login_lock_state (
  email text primary key,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.login_lock_state enable row level security;

alter table public.audit_logs enable row level security;
drop policy if exists "Staff can read audit logs" on public.audit_logs;
create policy "Staff can read audit logs" on public.audit_logs for select to authenticated
using (exists (select 1 from public.staff_users where id = auth.uid() and is_active));
drop policy if exists "Staff can record own audit logs" on public.audit_logs;
create policy "Staff can record own audit logs" on public.audit_logs for insert to authenticated
with check (user_id = auth.uid());

create or replace function public.check_login_lock(p_email text)
returns timestamptz
language sql security definer set search_path = public
as $$
  select locked_until from public.login_lock_state where email = lower(trim(p_email));
$$;

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
    set failed_attempts = case when locked_until is not null and locked_until <= now() then 1 else failed_attempts + 1 end,
        locked_until = case
          when (case when locked_until is not null and locked_until <= now() then 1 else failed_attempts + 1 end) >= 5
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

revoke all on function public.check_login_lock(text) from public, anon, authenticated;
revoke all on function public.record_login_attempt(text, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.check_login_lock(text) to service_role;
grant execute on function public.record_login_attempt(text, uuid, text, text, uuid) to service_role;

-- The reservation audit trigger must still write when the actor is a guest.
do $$ begin
  if to_regprocedure('public.log_service_change()') is not null then
    execute 'alter function public.log_service_change() security definer';
    execute 'alter function public.log_service_change() set search_path = public';
  end if;
end $$;

-- Notification recipients are individual accounts, including each staff role.
alter table public.notifications drop constraint if exists notifications_recipient_role_check;
alter table public.notifications add constraint notifications_recipient_role_check
check (recipient_role in ('guest', 'staff', 'cashier', 'admin'));

-- Convert historical shared staff alerts before enforcing individual recipients.
update public.notifications notice
set recipient_role = staff.role
from public.staff_users staff
where notice.recipient_role = 'staff' and notice.recipient_id = staff.id;

insert into public.notifications (
  recipient_role, recipient_id, actor_id, title, message, action_url,
  entity_type, entity_id, is_read, created_at
)
select staff.role, staff.id, notice.actor_id, notice.title, notice.message,
       notice.action_url, notice.entity_type, notice.entity_id, notice.is_read, notice.created_at
from public.notifications notice
join public.staff_users staff on staff.is_active = true
where notice.recipient_role = 'staff' and notice.recipient_id is null
  and (
    (notice.entity_type = 'payment' and staff.role in ('cashier', 'admin'))
    or (notice.entity_type = 'review' and staff.role = 'admin')
    or (coalesce(notice.entity_type, '') not in ('payment', 'review') and staff.role in ('admin', 'staff'))
  );
delete from public.notifications where recipient_id is null;
alter table public.notifications alter column recipient_id set not null;

drop policy if exists "Guests can view own notifications" on public.notifications;
drop policy if exists "Guests can update own notifications" on public.notifications;
drop policy if exists "Guests can insert own notifications" on public.notifications;
drop policy if exists "Staff can view notifications" on public.notifications;
drop policy if exists "Staff can update notifications" on public.notifications;
drop policy if exists "Authenticated users can create staff notifications" on public.notifications;
drop policy if exists "Recipients can view own notifications" on public.notifications;
drop policy if exists "Recipients can mark own notifications read" on public.notifications;

create policy "Recipients can view own notifications"
on public.notifications for select to authenticated
using (
  recipient_id = auth.uid()
  and (
    recipient_role = 'guest'
    or exists (
      select 1 from public.staff_users
      where id = auth.uid() and is_active = true and role = recipient_role
    )
  )
);

create policy "Recipients can mark own notifications read"
on public.notifications for update to authenticated
using (
  recipient_id = auth.uid()
  and (
    recipient_role = 'guest'
    or exists (
      select 1 from public.staff_users
      where id = auth.uid() and is_active = true and role = recipient_role
    )
  )
)
with check (
  recipient_id = auth.uid()
  and (
    recipient_role = 'guest'
    or exists (
      select 1 from public.staff_users
      where id = auth.uid() and is_active = true and role = recipient_role
    )
  )
);

revoke update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;
