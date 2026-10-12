-- Apply after maintenance-refunds, booking-policy-versions, role-permissions,
-- and the existing reservation-edit/additional-services-billing migrations.
-- Preserve payment/receipt history; completed refunds reduce the net amount paid.
begin;
alter table public.refund_requests add column if not exists request_kind text not null default 'cancellation'
  check (request_kind in ('cancellation', 'overpayment'));

-- Allow another request after a completed/rejected request, keeping every decision.
-- Only one pending/approved request may reserve funds for a reservation at a time.
do $$ declare v_constraint record;
begin
  for v_constraint in select c.conname from pg_catalog.pg_constraint c
    where c.conrelid = 'public.refund_requests'::regclass and c.contype = 'u'
      and c.conkey = array[(select attnum from pg_catalog.pg_attribute
        where attrelid = 'public.refund_requests'::regclass and attname = 'reservation_id')]::smallint[]
  loop execute format('alter table public.refund_requests drop constraint %I', v_constraint.conname); end loop;
end $$;
create unique index if not exists refund_requests_one_open_per_reservation
  on public.refund_requests(reservation_id) where status in ('pending', 'approved');

-- Recalculate from immutable verified payments and completed refund records.
create or replace function public.refresh_reservation_payment_totals(p_reservation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_paid numeric;
begin
  select greatest(coalesce((select sum(amount) from public.payments
    where reservation_id = p_reservation and status = 'verified'), 0)
    - coalesce((select sum(amount) from public.refund_requests
    where reservation_id = p_reservation and status = 'refunded'), 0), 0) into v_paid;
  update public.transactions set paid_amount = v_paid, status = case
    when total_amount <= v_paid then 'paid' when v_paid > 0 then 'partial' else 'unpaid' end
    where reservation_id = p_reservation;
end $$;
revoke all on function public.refresh_reservation_payment_totals(uuid) from public, anon, authenticated;

create or replace function public.update_transaction_paid_amount()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.refresh_reservation_payment_totals(coalesce(new.reservation_id, old.reservation_id));
  return null;
end $$;
create or replace function public.update_transaction_on_refund()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.refresh_reservation_payment_totals(coalesce(new.reservation_id, old.reservation_id));
  return null;
end $$;
drop trigger if exists update_transaction_on_refund on public.refund_requests;
create trigger update_transaction_on_refund after insert or update or delete on public.refund_requests
for each row execute function public.update_transaction_on_refund();

-- Serialize verification/deletion with refund requests and reservation bill edits.
-- A rejected/revoked payment must not erase funds already sent back to the guest.
create or replace function public.lock_payment_refund_funds()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_paid numeric; v_allocated numeric;
begin
  v_id := case when tg_op = 'DELETE' then old.reservation_id else new.reservation_id end;
  perform 1 from public.reservations where reservation_id = v_id for update;
  perform 1 from public.transactions where reservation_id = v_id for update;
  if tg_op <> 'INSERT' and old.status = 'verified' and
    (tg_op = 'DELETE' or new.status is distinct from 'verified' or new.amount is distinct from old.amount) then
    select coalesce(sum(amount), 0) into v_paid from public.payments
      where reservation_id = v_id and status = 'verified' and payment_id <> old.payment_id;
    if tg_op = 'UPDATE' and new.status = 'verified' then v_paid := v_paid + new.amount; end if;
    select coalesce(sum(amount), 0) into v_allocated from public.refund_requests
      where reservation_id = v_id and status in ('pending', 'approved', 'refunded');
    if v_paid < v_allocated then raise exception 'Resolve allocated refunds before changing verified payments' using errcode = '40001'; end if;
  end if;
  if tg_op = 'UPDATE' and new.reservation_id is distinct from old.reservation_id then
    raise exception 'A payment cannot be moved to another reservation' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists lock_payment_refund_funds on public.payments;
create trigger lock_payment_refund_funds before insert or update or delete on public.payments
for each row execute function public.lock_payment_refund_funds();

create or replace function public.request_overpayment_refund(p_reservation uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_r public.reservations%rowtype; v_t public.transactions%rowtype;
  v_actor uuid := auth.uid(); v_net_paid numeric; v_amount numeric; v_id uuid;
begin
  select * into v_r from public.reservations where reservation_id = p_reservation for update;
  if not found or v_actor is null or v_r.guest_id is distinct from v_actor then
    raise exception 'You can only request refunds for your own reservation' using errcode = '42501'; end if;
  select * into v_t from public.transactions where reservation_id = p_reservation for update;
  if not found then raise exception 'Reservation bill not found' using errcode = '22023'; end if;
  if exists (select 1 from public.refund_requests where reservation_id = p_reservation and status in ('pending', 'approved')) then
    raise exception 'A refund request is already awaiting review or payout' using errcode = '40001'; end if;
  if exists (select 1 from public.payments where reservation_id = p_reservation and status = 'pending')
    or (v_r.status <> 'cancelled' and exists (select 1 from public.reservation_reschedules where reservation_id = p_reservation and status = 'pending')) then
    raise exception 'Wait for pending payments or reservation changes to be reviewed first' using errcode = '40001'; end if;
  select coalesce((select sum(amount) from public.payments where reservation_id = p_reservation and status = 'verified'), 0)
    - coalesce((select sum(amount) from public.refund_requests where reservation_id = p_reservation and status = 'refunded'), 0)
    into v_net_paid;
  v_amount := round(greatest(v_net_paid - v_t.total_amount, 0), 2);
  if v_amount <= 0 then raise exception 'No verified excess payment is available for refund' using errcode = '22023'; end if;
  insert into public.refund_requests(reservation_id, guest_id, amount, request_kind, policy_snapshot)
    values(p_reservation, v_actor, v_amount, 'overpayment',
      'Refund only the verified payment above the reservation bill, after prior refunds. Staff review and a documented GCash payout are required.')
    returning refund_id into v_id;
  insert into public.audit_logs(auth_user_id, action, entity_type, entity_id, details)
    values(v_actor, 'Requested excess payment refund', 'refund_request', v_id,
      jsonb_build_object('reservation_id', p_reservation, 'amount', v_amount,
        'net_verified_paid', v_net_paid, 'total_amount', v_t.total_amount, 'status', 'pending'));
  return v_id;
end $$;
revoke all on function public.request_overpayment_refund(uuid) from public, anon;
grant execute on function public.request_overpayment_refund(uuid) to authenticated;

create or replace function public.get_guest_refund_overview()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'refunds', coalesce((select jsonb_agg(jsonb_build_object(
      'refund_id', f.refund_id, 'reservation_id', f.reservation_id, 'reference_number', r.reference_number,
      'amount', f.amount, 'request_kind', f.request_kind, 'status', f.status, 'requested_at', f.requested_at,
      'review_reason', f.review_reason, 'gcash_reference', f.gcash_reference) order by f.requested_at desc)
      from public.refund_requests f join public.reservations r using (reservation_id)
      where r.guest_id = auth.uid() and f.guest_id = auth.uid()), '[]'::jsonb),
    'eligible', coalesce((select jsonb_agg(jsonb_build_object(
      'reservation_id', r.reservation_id, 'reference_number', r.reference_number,
      'amount', t.overpaid_amount) order by r.created_at desc)
      from public.reservations r join public.transactions t using (reservation_id)
      where r.guest_id = auth.uid() and t.overpaid_amount > 0
        and not exists (select 1 from public.refund_requests f where f.reservation_id = r.reservation_id and f.status in ('pending', 'approved'))
        and not exists (select 1 from public.payments p where p.reservation_id = r.reservation_id and p.status = 'pending')
        and (r.status = 'cancelled' or not exists (select 1 from public.reservation_reschedules s where s.reservation_id = r.reservation_id and s.status = 'pending'))), '[]'::jsonb));
$$;
revoke all on function public.get_guest_refund_overview() from public, anon;
grant execute on function public.get_guest_refund_overview() to authenticated;

-- Cancelling after an excess refund must subtract completed payouts. If an excess
-- request is still open, expand that request and require a fresh cancellation review.
create or replace function public.cancel_reservation_with_refund(p_reservation uuid, p_reason text, p_admin boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_r public.reservations%rowtype; v_actor uuid := auth.uid(); v_amount numeric;
  v_refund uuid; v_previous public.refund_requests%rowtype; v_policy public.booking_policy_versions%rowtype;
  v_snapshot text; v_basis text;
begin
  if p_admin is null then raise exception 'Specify the cancellation actor type' using errcode = '22023'; end if;
  select * into v_r from public.reservations where reservation_id = p_reservation for update;
  if not found then raise exception 'Reservation not found' using errcode = '22023'; end if;
  if p_admin then
    if not exists (select 1 from public.staff_users s where s.id = v_actor and s.is_active
      and (s.role = 'admin' or exists (select 1 from public.role_permissions rp
        where rp.role = s.role and 'cancel_reservation' = any(rp.permissions)))) then
      raise exception 'Cancellation permission required' using errcode = '42501'; end if;
  elsif v_actor is null or v_r.guest_id is distinct from v_actor then
    raise exception 'Not your reservation' using errcode = '42501';
  end if;
  if v_r.status not in ('pending', 'payment_submitted', 'confirmed', 'reschedule_requested') then
    raise exception 'Reservation cannot be cancelled' using errcode = '22023'; end if;
  perform 1 from public.transactions where reservation_id = p_reservation for update;
  if exists (select 1 from public.payments where reservation_id = p_reservation and status = 'pending') then
    raise exception 'Wait for pending payments to be reviewed before cancelling' using errcode = '40001'; end if;
  select * into v_policy from public.booking_policy_versions where version = v_r.booking_policy_version;
  if not found then
    select * into v_policy from public.booking_policy_versions order by version desc limit 1;
    v_basis := 'legacy_current_at_cancellation';
  else v_basis := 'booked_policy'; end if;
  if not found then raise exception 'Booking policy is not configured' using errcode = '22023'; end if;
  if not p_admin and v_r.start_datetime - now() < make_interval(hours => v_policy.guest_cancellation_notice_hours) then
    raise exception 'Cancellation notice window has passed' using errcode = '22023'; end if;
  select greatest(coalesce((select sum(amount) from public.payments where reservation_id = p_reservation and status = 'verified'), 0)
    - coalesce((select sum(amount) from public.refund_requests where reservation_id = p_reservation and status = 'refunded'), 0), 0)
    into v_amount;
  v_snapshot := format('Policy version %s (captured at cancellation). Cancellation: %s Refund: %s Refund review requests: %s.',
    v_policy.version, v_policy.cancellation_text, v_policy.refund_text,
    case when v_policy.refund_review_enabled then 'enabled' else 'disabled' end);
  update public.reservations set status = 'cancelled', cancelled_at = now(), cancellation_reason = trim(p_reason)
    where reservation_id = p_reservation;
  update public.invoices set status = 'void' where reservation_id = p_reservation;
  select * into v_previous from public.refund_requests where reservation_id = p_reservation and status in ('pending', 'approved') for update;
  v_refund := v_previous.refund_id;
  if v_amount > 0 and v_policy.refund_review_enabled then
    if v_refund is null then
      insert into public.refund_requests(reservation_id, guest_id, amount, request_kind, policy_snapshot, policy_version)
        values(p_reservation, v_r.guest_id, v_amount, 'cancellation', v_snapshot, v_policy.version) returning refund_id into v_refund;
    else
      update public.refund_requests set amount = v_amount, request_kind = 'cancellation', status = 'pending',
        policy_snapshot = v_snapshot, policy_version = v_policy.version, reviewed_by = null, reviewed_at = null, review_reason = null
        where refund_id = v_refund;
    end if;
    insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id, details)
      values(case when p_admin then v_actor else null end, v_actor, 'Created or updated cancellation refund request', 'refund_request', v_refund,
        jsonb_build_object('reservation_id', p_reservation, 'amount', v_amount, 'previous_amount', v_previous.amount,
          'previous_status', v_previous.status, 'previous_kind', v_previous.request_kind,
          'policy_version', v_policy.version, 'policy_snapshot', v_snapshot, 'policy_basis', v_basis, 'status', 'pending'));
  end if;
  insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id, details)
    values(case when p_admin then v_actor else null end, v_actor, 'Cancelled reservation', 'reservation', p_reservation,
      jsonb_build_object('old_status', v_r.status, 'new_status', 'cancelled', 'reason', trim(p_reason),
        'net_verified_payment_total', v_amount, 'refund_id', v_refund, 'policy_version', v_policy.version,
        'policy_snapshot', v_snapshot, 'policy_basis', v_basis, 'refund_review_enabled', v_policy.refund_review_enabled));
  return v_refund;
end $$;
revoke all on function public.cancel_reservation_with_refund(uuid,text,boolean) from public, anon;
grant execute on function public.cancel_reservation_with_refund(uuid,text,boolean) to authenticated;

create or replace function public.transition_refund(p_id uuid, p_action text, p_reason text default null,
  p_reference text default null, p_proof text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.refund_requests%rowtype; v_actor uuid := auth.uid(); v_reservation uuid;
  v_total numeric; v_available numeric; v_status text;
  v_permission text := case when p_action = 'refunded' then 'refund_payout' else 'refund_review' end;
begin
  if not exists (select 1 from public.staff_users s where s.id = v_actor and s.is_active and
    (s.role = 'admin' or exists (select 1 from public.role_permissions rp
      where rp.role = s.role and v_permission = any(rp.permissions)))) then
    raise exception 'Insufficient staff permission' using errcode = '42501'; end if;
  select reservation_id into v_reservation from public.refund_requests where refund_id = p_id;
  if not found then raise exception 'Refund request not found' using errcode = '22023'; end if;
  -- Match the reservation -> bill -> refund locking order used by guest requests.
  select status into v_status from public.reservations where reservation_id = v_reservation for update;
  select total_amount into v_total from public.transactions where reservation_id = v_reservation for update;
  select * into v_r from public.refund_requests where refund_id = p_id for update;
  if p_action in ('approved', 'refunded') then
    select coalesce((select sum(amount) from public.payments where reservation_id = v_reservation and status = 'verified'), 0)
      - coalesce((select sum(amount) from public.refund_requests where reservation_id = v_reservation
        and refund_id <> p_id and status in ('pending', 'approved', 'refunded')), 0) into v_available;
    if v_r.request_kind = 'overpayment' then v_available := v_available - v_total;
    elsif v_status is distinct from 'cancelled' then
      raise exception 'Cancellation refunds require a cancelled reservation' using errcode = '40001'; end if;
    if v_r.amount > greatest(v_available, 0) or v_total is null then
      raise exception 'The bill or payments changed. Reject this request with a reason and request a fresh review' using errcode = '40001'; end if;
    if exists (select 1 from public.payments where reservation_id = v_reservation and status = 'pending')
      or (v_status <> 'cancelled' and exists (select 1 from public.reservation_reschedules where reservation_id = v_reservation and status = 'pending')) then
      raise exception 'Resolve pending payments or reservation changes before refunding' using errcode = '40001'; end if;
  end if;
  if (p_action = 'approved' and v_r.status = 'pending') or (p_action = 'rejected' and v_r.status in ('pending', 'approved')) then
    if p_action = 'rejected' and length(trim(coalesce(p_reason, ''))) < 3 then
      raise exception 'A rejection reason is required' using errcode = '22023'; end if;
    update public.refund_requests set status = p_action, reviewed_by = v_actor, reviewed_at = now(),
      review_reason = nullif(trim(p_reason), '') where refund_id = p_id;
  elsif p_action = 'refunded' and v_r.status = 'approved' then
    if length(trim(coalesce(p_reference, ''))) < 6 or length(trim(coalesce(p_proof, ''))) < 1 then
      raise exception 'GCash reference and proof are required' using errcode = '22023'; end if;
    if exists (select 1 from public.refund_requests where refund_id <> p_id and status = 'refunded'
      and regexp_replace(upper(gcash_reference), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(p_reference), '[^A-Z0-9]', '', 'g')) then
      raise exception 'This GCash payout reference has already been recorded' using errcode = '23505'; end if;
    update public.refund_requests set status = 'refunded', refunded_by = v_actor, refunded_at = now(),
      gcash_reference = trim(p_reference), proof_path = trim(p_proof) where refund_id = p_id;
  else raise exception 'Invalid refund status transition' using errcode = '22023'; end if;
  insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id, details)
    values(v_actor, v_actor, 'Refund ' || p_action, 'refund_request', p_id,
      jsonb_build_object('reservation_id', v_r.reservation_id, 'request_kind', v_r.request_kind,
        'old_status', v_r.status, 'new_status', p_action, 'amount', v_r.amount, 'reason', p_reason,
        'gcash_reference', p_reference, 'proof_path', p_proof));
end $$;
revoke all on function public.transition_refund(uuid,text,text,text,text) from public, anon;
grant execute on function public.transition_refund(uuid,text,text,text,text) to authenticated;
create unique index if not exists refund_requests_normalized_payout_reference_unique
on public.refund_requests ((regexp_replace(upper(gcash_reference), '[^A-Z0-9]', '', 'g')))
where status = 'refunded' and gcash_reference is not null;

-- Align existing completed refunds with net billing without modifying receipts.
select public.refresh_reservation_payment_totals(reservation_id)
  from (select distinct reservation_id from public.refund_requests where status = 'refunded') r;
notify pgrst, 'reload schema';
commit;
