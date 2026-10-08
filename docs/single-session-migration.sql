-- Apply before deploying single-session checks. Existing guest sessions must sign in again.
alter table public.guests add column if not exists active_session_id uuid;
create index if not exists guests_active_session_idx on public.guests(active_session_id);
