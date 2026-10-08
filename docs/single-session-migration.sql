-- Apply before deploying single-session checks. Existing guest and staff sessions must sign in again.
alter table public.guests add column if not exists active_session_id uuid;
create index if not exists guests_active_session_idx on public.guests(active_session_id);
-- Legacy staff values were separate cookie tokens, not Supabase session IDs.
update public.staff_users staff
set active_session_id = null
where active_session_id is not null
  and not exists (select 1 from auth.sessions auth_session where auth_session.id = staff.active_session_id);
