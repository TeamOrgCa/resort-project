-- Apply after maintenance-refunds-migration.sql and before deploying role permissions.
create table if not exists public.role_permissions (
  role text primary key check (role in ('staff', 'cashier')),
  permissions text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_users(id)
);

insert into public.role_permissions (role, permissions) values
  ('staff', array['dashboard','reservations','create_reservation','cancel_reservation','reschedule_approval','ocular_approval','transactions','payment_approval','payment_entry','refund_review','refund_payout','records','reports','analytics','audit']),
  ('cashier', array['transactions','payment_approval'])
on conflict (role) do nothing;

alter table public.role_permissions enable row level security;
drop policy if exists "Active staff can read role permissions" on public.role_permissions;
create policy "Active staff can read role permissions" on public.role_permissions
  for select to authenticated using (
    exists (select 1 from public.staff_users where id = auth.uid() and is_active = true)
  );
-- Writes use the service role through the admin-only API.

-- Align the existing refund RPC and private proof bucket with configurable grants.
create or replace function public.transition_refund(p_id uuid, p_action text, p_reason text default null,
  p_reference text default null, p_proof text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.refund_requests%rowtype; v_actor uuid := auth.uid();
  v_permission text := case when p_action = 'refunded' then 'refund_payout' else 'refund_review' end;
begin
  if not exists (
    select 1 from public.staff_users s where s.id = v_actor and s.is_active and
      (s.role = 'admin' or exists (
        select 1 from public.role_permissions rp where rp.role = s.role and v_permission = any(rp.permissions)
      ))
  ) then raise exception 'Insufficient staff permission' using errcode = '42501'; end if;
  select * into v_r from public.refund_requests where refund_id = p_id for update;
  if not found then raise exception 'Refund request not found' using errcode = '22023'; end if;
  if p_action in ('approved', 'rejected') and v_r.status = 'pending' then
    if p_action = 'rejected' and length(trim(coalesce(p_reason, ''))) < 3 then
      raise exception 'A rejection reason is required' using errcode = '22023'; end if;
    update public.refund_requests set status = p_action, reviewed_by = v_actor, reviewed_at = now(),
      review_reason = nullif(trim(p_reason), '') where refund_id = p_id;
  elsif p_action = 'refunded' and v_r.status = 'approved' then
    if length(trim(coalesce(p_reference, ''))) < 6 or length(trim(coalesce(p_proof, ''))) < 1 then
      raise exception 'GCash reference and proof are required' using errcode = '22023'; end if;
    update public.refund_requests set status = 'refunded', refunded_by = v_actor, refunded_at = now(),
      gcash_reference = trim(p_reference), proof_path = trim(p_proof) where refund_id = p_id;
  else raise exception 'Invalid refund status transition' using errcode = '22023'; end if;
  insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id, details)
    values(v_actor, v_actor, 'Refund ' || p_action, 'refund_request', p_id,
      jsonb_build_object('reservation_id', v_r.reservation_id, 'old_status', v_r.status,
        'new_status', p_action, 'amount', v_r.amount, 'reason', p_reason,
        'gcash_reference', p_reference, 'proof_path', p_proof));
end $$;

drop policy if exists "Staff upload refund proof" on storage.objects;
create policy "Staff upload refund proof" on storage.objects for insert to authenticated
with check (bucket_id = 'refund-proofs' and exists (
  select 1 from public.staff_users s where s.id = auth.uid() and s.is_active and
    (s.role = 'admin' or exists (select 1 from public.role_permissions rp
      where rp.role = s.role and 'refund_payout' = any(rp.permissions)))
));
drop policy if exists "Staff read refund proof" on storage.objects;
create policy "Staff read refund proof" on storage.objects for select to authenticated
using (bucket_id = 'refund-proofs' and exists (
  select 1 from public.staff_users s where s.id = auth.uid() and s.is_active and
    (s.role = 'admin' or exists (select 1 from public.role_permissions rp
      where rp.role = s.role and ('refund_review' = any(rp.permissions) or 'refund_payout' = any(rp.permissions))))
));
