-- Apply AFTER overpayment-refunds-migration.sql and reservation-edit-migration.sql.
-- No money is released by these functions. Existing payment/receipt history stays intact.
begin;

alter table public.transactions add column if not exists cancellation_deposit_base numeric(10,2);
-- Recover the first verified payment's immutable receipt bill snapshot where
-- available; otherwise capture the recorded legacy bill once.
update public.transactions t set cancellation_deposit_base = coalesce((
  select rc.transaction_total_at_time from public.receipts rc
  where rc.payment_id=(select p.payment_id from public.payments p
    where p.reservation_id=t.reservation_id and p.status='verified'
    order by coalesce(p.verified_at,p.created_at),p.payment_id limit 1)
    and rc.transaction_total_at_time is not null and rc.transaction_total_at_time>=0
  order by rc.issued_at,rc.receipt_id limit 1),t.total_amount)
where cancellation_deposit_base is null and exists
  (select 1 from public.payments p where p.reservation_id=t.reservation_id and p.status='verified');
create or replace function public.freeze_cancellation_deposit_base()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and old.cancellation_deposit_base is not null then
    if new.cancellation_deposit_base is distinct from old.cancellation_deposit_base then
      raise exception 'The initial deposit basis cannot be changed' using errcode='22023'; end if;
  else
    new.cancellation_deposit_base := case when exists
      (select 1 from public.payments where reservation_id=new.reservation_id and status='verified')
      then case when tg_op='UPDATE' then old.total_amount else new.total_amount end else null end;
  end if;
  return new;
end $$;
drop trigger if exists freeze_cancellation_deposit_base on public.transactions;
create trigger freeze_cancellation_deposit_base before insert or update on public.transactions
for each row execute function public.freeze_cancellation_deposit_base();

alter table public.reservations add column if not exists cancellation_initiator text check(cancellation_initiator in ('guest','resort'));
alter table public.reservations add column if not exists cancelled_by uuid;
alter table public.reservations add column if not exists cancellation_snapshot jsonb;
-- changed_by references staff_users; guest actions belong in auth_user_id in the
-- audit trail, not in that staff-only foreign key.
create or replace function public.log_reservation_status_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status is distinct from new.status then
    insert into public.reservation_status_logs(reservation_id,old_status,new_status,changed_by)
      values(new.reservation_id,old.status,new.status,case when exists
        (select 1 from public.staff_users where id=auth.uid()) then auth.uid() else null end);
  end if;
  return new;
end $$;
alter table public.refund_requests add column if not exists cancellation_event_id uuid;
alter table public.refund_requests add column if not exists calculation_snapshot jsonb;
alter table public.refund_requests add column if not exists workflow_version integer not null default 1;
alter table public.refund_requests alter column workflow_version set default 2;
alter table public.refund_requests add column if not exists payment_reviewed_by uuid references public.staff_users(id);
alter table public.refund_requests add column if not exists payment_reviewed_at timestamptz;
alter table public.refund_requests add column if not exists payment_review_notes text;
alter table public.refund_requests add column if not exists payout_submitted_by uuid references public.staff_users(id);
alter table public.refund_requests add column if not exists payout_submitted_at timestamptz;
alter table public.refund_requests add column if not exists payout_method text;
alter table public.refund_requests add column if not exists payout_verification_notes text;
-- Replace only the status constraint; preserve the existing payout-evidence check.
do $$ declare c record;
begin
  for c in select conname from pg_catalog.pg_constraint
    where conrelid='public.refund_requests'::regclass and contype='c'
      and pg_catalog.pg_get_constraintdef(oid) like '%status%pending%' loop
    execute format('alter table public.refund_requests drop constraint %I',c.conname);
  end loop;
end $$;
alter table public.refund_requests add constraint refund_workflow_status
  check(status in ('pending','reviewed','approved','payout_submitted','rejected','refunded'));
create unique index if not exists refund_cancellation_event_unique
  on public.refund_requests(cancellation_event_id) where cancellation_event_id is not null;
drop index if exists public.refund_requests_one_open_per_reservation;
create unique index refund_requests_one_open_per_reservation on public.refund_requests(reservation_id)
  where status in ('pending','reviewed','approved','payout_submitted');
drop index if exists public.refund_requests_normalized_payout_reference_unique;
create unique index refund_requests_normalized_payout_reference_unique
  on public.refund_requests((regexp_replace(upper(gcash_reference),'[^A-Z0-9]','','g')))
  where status in ('payout_submitted','refunded') and gcash_reference is not null;
revoke insert,update,delete on public.refund_requests from anon,authenticated;

-- Cashiers can inspect records, document transfers and independently verify another
-- staff member's transfer. Approval/rejection remains administrator-only.
update public.role_permissions set permissions=(select array_agg(distinct p) from
  unnest(permissions || array['refund_review','refund_payout','refund_verify']) p) where role='cashier';

create or replace function public.refund_staff_permission(p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_users s where s.id=auth.uid() and s.is_active
    and (s.role='admin' or exists(select 1 from public.role_permissions rp
      where rp.role=s.role and p_permission=any(rp.permissions))));
$$;
revoke all on function public.refund_staff_permission(text) from public,anon,authenticated;

-- Notifications are committed with the financial action, so an API/network error
-- after commit cannot lose the guest/staff alert or create a second refund.
create or replace function public.notify_refund_workflow(p_guest uuid,p_title text,p_message text,p_entity text,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_guest is not null then
    insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
      values('guest',p_guest,auth.uid(),p_title,p_message,'/manage',p_entity,p_id);
  end if;
  insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
    select s.role,s.id,auth.uid(),p_title,p_message,'/admin/transactions?tab=refunds',p_entity,p_id
    from public.staff_users s where s.is_active and (s.role in ('admin','cashier') or exists
      (select 1 from public.role_permissions rp where rp.role=s.role and
        rp.permissions && array['refund_review','refund_payout','refund_verify']));
end $$;
revoke all on function public.notify_refund_workflow(uuid,text,text,text,uuid) from public,anon,authenticated;

create or replace function public.get_cancellation_preview(p_reservation uuid,p_initiator text default 'guest')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; t public.transactions%rowtype; p public.booking_policy_versions%rowtype;
  v_staff boolean:=public.refund_staff_permission('cancel_reservation'); v_gross numeric; v_previous numeric;
  v_net numeric; v_base numeric; v_deposit numeric; v_deduction numeric; v_refund numeric; v_allowed boolean;
  v_result jsonb; v_block text;
begin
  if p_initiator is null or p_initiator not in ('guest','resort') then raise exception 'Choose guest or resort cancellation' using errcode='22023'; end if;
  select * into r from public.reservations where reservation_id=p_reservation;
  if not found then raise exception 'Reservation not found' using errcode='22023'; end if;
  if auth.uid() is null or (not v_staff and (r.guest_id is distinct from auth.uid() or p_initiator<>'guest')) then
    raise exception 'Cancellation permission required' using errcode='42501'; end if;
  if p_initiator='resort' and not exists(select 1 from public.staff_users where id=auth.uid() and role='admin' and is_active) then
    raise exception 'Only an administrator may cancel for a resort-attributable reason' using errcode='42501'; end if;
  select * into t from public.transactions where reservation_id=p_reservation;
  if not found then raise exception 'Reservation bill not found' using errcode='22023'; end if;
  select * into p from public.booking_policy_versions where version=r.booking_policy_version;
  if not found then select * into p from public.booking_policy_versions order by version desc limit 1; end if;
  if not found then raise exception 'Booking policy is not configured' using errcode='22023'; end if;
  select coalesce(sum(amount),0) into v_gross from public.payments where reservation_id=p_reservation and status='verified';
  select coalesce(sum(amount),0) into v_previous from public.refund_requests where reservation_id=p_reservation and status='refunded';
  v_net:=round(greatest(v_gross-v_previous,0),2);
  v_base:=coalesce(t.cancellation_deposit_base,t.total_amount);
  v_deposit:=ceil(v_base*20)/100; -- Same cent rounding as the required 20% downpayment.
  v_deduction:=case when p_initiator='guest' then least(v_net,v_deposit) else 0 end;
  v_refund:=round(greatest(v_net-v_deduction,0),2);
  if r.status not in ('pending','payment_submitted','confirmed','reschedule_requested') then v_block:='This reservation cannot be cancelled.';
  elsif exists(select 1 from public.payments where reservation_id=p_reservation and status='pending') then v_block:='Review pending payments before cancelling.';
  elsif exists(select 1 from public.refund_requests where reservation_id=p_reservation and status='payout_submitted') then v_block:='Verify the existing refund transfer before cancelling.';
  elsif not v_staff and r.start_datetime-now()<make_interval(hours=>p.guest_cancellation_notice_hours) then v_block:='The guest cancellation notice window has passed. Contact the resort.';
  end if;
  v_allowed:=v_block is null;
  v_result:=jsonb_build_object('reservationId',p_reservation,'reference',r.reference_number,'initiator',p_initiator,
    'totalAmount',t.total_amount,'verifiedPaid',v_gross,'previousRefunds',v_previous,'netPaid',v_net,
    'depositBase',v_base,'depositAmount',v_deposit,'deduction',v_deduction,'refundableAmount',v_refund,
    'policyVersion',p.version,'noticeHours',p.guest_cancellation_notice_hours,'allowed',v_allowed,'blockedReason',v_block,
    'outcome',case when v_refund>0 then 'pending_refund' else 'no_refund' end,
    'rule',case when p_initiator='resort' then 'Full refund of remaining verified payments; no deposit deduction.'
      else 'The initial 20% deposit is retained. Only remaining verified payments above that deposit are refundable.' end);
  return v_result || jsonb_build_object('quote',md5(v_result::text));
end $$;
revoke all on function public.get_cancellation_preview(uuid,text) from public,anon;
grant execute on function public.get_cancellation_preview(uuid,text) to authenticated;

create or replace function public.cancel_reservation_evaluated(p_reservation uuid,p_reason text,p_initiator text,p_expected_quote text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; v_quote jsonb; v_id uuid; v_previous public.refund_requests%rowtype;
  v_amount numeric; v_policy text; v_staff boolean:=public.refund_staff_permission('cancel_reservation');
begin
  if length(trim(coalesce(p_reason,''))) not between 5 and 2000 then raise exception 'A documented cancellation reason (5-2000 characters) is required' using errcode='22023'; end if;
  select * into r from public.reservations where reservation_id=p_reservation for update;
  perform 1 from public.transactions where reservation_id=p_reservation for update;
  v_quote:=public.get_cancellation_preview(p_reservation,p_initiator);
  if not (v_quote->>'allowed')::boolean then raise exception '%',v_quote->>'blockedReason' using errcode='40001'; end if;
  if p_expected_quote is null or p_expected_quote is distinct from v_quote->>'quote' then
    raise exception 'Payments, refunds or the bill changed. Reload the cancellation preview before confirming' using errcode='40001'; end if;
  v_amount:=(v_quote->>'refundableAmount')::numeric;
  v_policy:=v_quote->>'rule';
  select * into v_previous from public.refund_requests where reservation_id=p_reservation
    and status in ('pending','reviewed','approved') for update;
  update public.reservations set status='cancelled',cancelled_at=now(),cancellation_reason=trim(p_reason),
    cancellation_initiator=p_initiator,cancelled_by=auth.uid(),cancellation_snapshot=v_quote where reservation_id=p_reservation;
  update public.invoices set status='void' where reservation_id=p_reservation;
  if v_amount>0 then
    if v_previous.refund_id is null then
      insert into public.refund_requests(reservation_id,guest_id,amount,request_kind,policy_snapshot,policy_version,
        cancellation_event_id,calculation_snapshot,workflow_version)
      values(p_reservation,r.guest_id,v_amount,'cancellation',v_policy,(v_quote->>'policyVersion')::bigint,
        p_reservation,v_quote,2) returning refund_id into v_id;
    else
      v_id:=v_previous.refund_id;
      update public.refund_requests set amount=v_amount,request_kind='cancellation',status='pending',
        policy_snapshot=v_policy,policy_version=(v_quote->>'policyVersion')::bigint,cancellation_event_id=p_reservation,
        calculation_snapshot=v_quote,workflow_version=2,reviewed_by=null,reviewed_at=null,review_reason=null,
        payment_reviewed_by=null,payment_reviewed_at=null,payment_review_notes=null where refund_id=v_id;
    end if;
  elsif v_previous.refund_id is not null then
    update public.refund_requests set status='rejected',reviewed_at=now(),review_reason='Cancellation evaluation: no refundable verified funds remain.' where refund_id=v_previous.refund_id;
  end if;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(case when v_staff then auth.uid() else null end,auth.uid(),'Cancelled reservation with refund evaluation','reservation',p_reservation,
      v_quote || jsonb_build_object('reason',trim(p_reason),'refund_id',v_id,'previous_refund',to_jsonb(v_previous)));
  perform public.notify_refund_workflow(r.guest_id,
    case when v_id is null then 'Reservation cancelled - no refund' else 'Reservation cancelled - pending refund' end,
    format('Reservation %s cancelled. Reason: %s. Verified payments: PHP %s; previous refunds: PHP %s; retained deposit: PHP %s; refundable: PHP %s. %s',
      r.reference_number,trim(p_reason),v_quote->>'verifiedPaid',v_quote->>'previousRefunds',v_quote->>'deduction',v_quote->>'refundableAmount',
      case when v_id is null then 'No refund request is needed.' else 'A refund request was created automatically. Staff will review and manually process it.' end),
    case when v_id is null then 'reservation' else 'refund_request' end,coalesce(v_id,p_reservation));
  return v_quote || jsonb_build_object('refundId',v_id,'status','cancelled');
end $$;
revoke all on function public.cancel_reservation_evaluated(uuid,text,text,text) from public,anon;
grant execute on function public.cancel_reservation_evaluated(uuid,text,text,text) to authenticated;

-- Old unprocessed cancellations lack a trustworthy guest/resort classification.
-- An admin must document it, recalculate, and require a new cashier review.
create or replace function public.recalculate_legacy_cancellation_refund(p_id uuid,p_initiator text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare f public.refund_requests%rowtype; v_res uuid; q jsonb;
begin
  if not exists(select 1 from public.staff_users where id=auth.uid() and role='admin' and is_active) then
    raise exception 'Administrator access required' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Document why the legacy cancellation was classified this way' using errcode='22023'; end if;
  select reservation_id into v_res from public.refund_requests where refund_id=p_id;
  perform 1 from public.reservations where reservation_id=v_res and status='cancelled' for update;
  if not found then raise exception 'A cancelled reservation is required' using errcode='22023'; end if;
  perform 1 from public.transactions where reservation_id=v_res for update;
  select * into f from public.refund_requests where refund_id=p_id for update;
  if f.workflow_version<>1 or f.request_kind<>'cancellation' or f.status not in ('pending','reviewed','approved') then
    raise exception 'Only an unprocessed legacy cancellation request can be recalculated' using errcode='22023'; end if;
  q:=public.get_cancellation_preview(v_res,p_initiator);
  if exists(select 1 from public.payments where reservation_id=v_res and status='pending') then
    raise exception 'Review pending payments first' using errcode='40001'; end if;
  update public.refund_requests set amount=case when (q->>'refundableAmount')::numeric>0 then (q->>'refundableAmount')::numeric else amount end,
    status=case when (q->>'refundableAmount')::numeric>0 then 'pending' else 'rejected' end,
    workflow_version=2,calculation_snapshot=q,cancellation_event_id=v_res,policy_snapshot=q->>'rule',
    reviewed_by=null,reviewed_at=null,review_reason=case when (q->>'refundableAmount')::numeric=0 then 'Cancelled - No Refund: deposit retained.' else null end,
    payment_reviewed_by=null,payment_reviewed_at=null,payment_review_notes=null where refund_id=p_id;
  update public.reservations set cancellation_initiator=p_initiator,cancellation_snapshot=q where reservation_id=v_res;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(auth.uid(),auth.uid(),'Recalculated legacy cancellation refund','refund_request',p_id,
      jsonb_build_object('previous',to_jsonb(f),'calculation',q,'reason',trim(p_reason)));
  perform public.notify_refund_workflow(f.guest_id,'Cancellation refund recalculated',
    format('Verified cancellation refund: PHP %s; retained deposit: PHP %s. Administrator documentation: %s. A positive refund requires a new review and approval.',q->>'refundableAmount',q->>'deduction',trim(p_reason)), 'refund_request',p_id);
end $$;
revoke all on function public.recalculate_legacy_cancellation_refund(uuid,text,text) from public,anon;
grant execute on function public.recalculate_legacy_cancellation_refund(uuid,text,text) to authenticated;

-- Preserve the old RPC signature for callers; it uses the same eligibility rules.
create or replace function public.cancel_reservation_with_refund(p_reservation uuid,p_reason text,p_admin boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_initiator text; v_quote jsonb; v_result jsonb;
begin
  if p_admin is null then raise exception 'Specify the cancellation actor type' using errcode='22023'; end if;
  if p_admin and not public.refund_staff_permission('cancel_reservation') then raise exception 'Cancellation permission required' using errcode='42501'; end if;
  v_initiator:=case when p_admin and p_reason !~* '^Guest' then 'resort' else 'guest' end;
  v_quote:=public.get_cancellation_preview(p_reservation,v_initiator);
  v_result:=public.cancel_reservation_evaluated(p_reservation,p_reason,v_initiator,v_quote->>'quote');
  return (v_result->>'refundId')::uuid;
end $$;

create or replace function public.transition_refund_workflow(p_id uuid,p_action text,p_reason text default null,
  p_reference text default null,p_proof text default null,p_method text default 'GCash',p_verified boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare f public.refund_requests%rowtype; v_id uuid; r public.reservations%rowtype;
  v_total numeric; v_available numeric; v_other numeric; v_new text; v_permission text;
begin
  v_permission:=case when p_action='payout_submitted' then 'refund_payout' when p_action='refunded' then 'refund_verify' else 'refund_review' end;
  if not public.refund_staff_permission(v_permission) then raise exception 'Refund permission required' using errcode='42501'; end if;
  if p_action in ('approved','rejected') and not exists(select 1 from public.staff_users where id=auth.uid() and role='admin' and is_active) then
    raise exception 'Only an authorized administrator can approve or reject refunds' using errcode='42501'; end if;
  select reservation_id into v_id from public.refund_requests where refund_id=p_id;
  if not found then raise exception 'Refund request not found' using errcode='22023'; end if;
  select * into r from public.reservations where reservation_id=v_id for update;
  select total_amount into v_total from public.transactions where reservation_id=v_id for update;
  select * into f from public.refund_requests where refund_id=p_id for update;
  if f.workflow_version=1 and f.request_kind='cancellation' and p_action<>'rejected' then
    raise exception 'An administrator must classify and recalculate this legacy cancellation before processing' using errcode='40001'; end if;
  if p_action<>'rejected' then
    select coalesce(sum(amount),0) into v_available from public.payments where reservation_id=v_id and status='verified';
    select coalesce(sum(amount),0) into v_other from public.refund_requests where reservation_id=v_id and refund_id<>p_id
      and status in ('pending','reviewed','approved','payout_submitted','refunded');
    v_available:=v_available-v_other;
    if f.request_kind='overpayment' then v_available:=v_available-v_total;
    elsif r.status is distinct from 'cancelled' then raise exception 'Cancellation refunds require a cancelled reservation' using errcode='40001';
    elsif f.workflow_version=2 then v_available:=v_available-coalesce((f.calculation_snapshot->>'deduction')::numeric,0);
    end if;
    if v_total is null or f.amount>greatest(v_available,0) then raise exception 'Verified funds or the bill changed; review the request again' using errcode='40001'; end if;
    if exists(select 1 from public.payments where reservation_id=v_id and status='pending') then raise exception 'Review pending payments first' using errcode='40001'; end if;
    if r.status<>'cancelled' and exists(select 1 from public.reservation_reschedules where reservation_id=v_id and status='pending') then
      raise exception 'Review pending reservation changes first' using errcode='40001'; end if;
  end if;
  if p_action='reviewed' and f.status='pending' then
    if p_verified is distinct from true or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Confirm payment records and enter review notes' using errcode='22023'; end if;
    update public.refund_requests set status='reviewed',payment_reviewed_by=auth.uid(),payment_reviewed_at=now(),payment_review_notes=trim(p_reason) where refund_id=p_id;
    v_new:='reviewed';
  elsif p_action='approved' and f.status='reviewed' then
    update public.refund_requests set status='approved',reviewed_by=auth.uid(),reviewed_at=now(),review_reason=nullif(trim(p_reason),'') where refund_id=p_id; v_new:='approved';
  elsif p_action='rejected' and f.status in ('pending','reviewed','approved') then
    if length(trim(coalesce(p_reason,'')))<5 then raise exception 'A rejection reason is required' using errcode='22023'; end if;
    update public.refund_requests set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),review_reason=trim(p_reason) where refund_id=p_id; v_new:='rejected';
  elsif p_action='payout_submitted' and f.status='approved' then
    if length(trim(coalesce(p_reference,''))) not between 6 and 100 or not exists
      (select 1 from public.payment_methods where is_active and name=p_method)
      or p_proof is null or split_part(p_proof,'/',1)<>p_id::text
      or not exists(select 1 from storage.objects where bucket_id='refund-proofs' and name=p_proof) then
      raise exception 'An active approved payment method, payout reference and uploaded proof for this refund are required' using errcode='22023'; end if;
    update public.refund_requests set status='payout_submitted',payout_submitted_by=auth.uid(),payout_submitted_at=now(),
      payout_method=p_method,gcash_reference=trim(p_reference),proof_path=p_proof where refund_id=p_id; v_new:='payout_submitted';
  elsif p_action='refunded' and f.status='payout_submitted' then
    if p_verified is distinct from true or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Verify the transfer in the receiving/payment records and enter verification notes' using errcode='22023'; end if;
    if f.payout_submitted_by=auth.uid() and not exists
      (select 1 from public.staff_users where id=auth.uid() and role='admin' and is_active) then
      raise exception 'Another authorized staff member must verify this payout; only an active administrator may verify their own transfer' using errcode='42501'; end if;
    if f.gcash_reference is null or f.proof_path is null or not exists(select 1 from storage.objects where bucket_id='refund-proofs' and name=f.proof_path) then
      raise exception 'Payout evidence is missing' using errcode='22023'; end if;
    update public.refund_requests set status='refunded',refunded_by=auth.uid(),refunded_at=now(),payout_verification_notes=trim(p_reason) where refund_id=p_id; v_new:='refunded';
  else raise exception 'Invalid refund transition. Refresh the request and complete the preceding step' using errcode='22023'; end if;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(auth.uid(),auth.uid(),'Refund '||v_new,'refund_request',p_id,jsonb_build_object('reservation_id',v_id,'amount',f.amount,
      'old_status',f.status,'new_status',v_new,'reason',p_reason,'reference',coalesce(p_reference,f.gcash_reference),
      'proof',coalesce(p_proof,f.proof_path),'verified',p_verified,
      'admin_self_verification',p_action='refunded' and f.payout_submitted_by=auth.uid()));
  perform public.notify_refund_workflow(f.guest_id,'Refund '||replace(v_new,'_',' '),
    format('Reservation %s: PHP %s refund. %s%s',r.reference_number,f.amount,
      case v_new when 'reviewed' then 'Payment records reviewed; awaiting administrator approval.' when 'approved' then 'Approved; awaiting manual transfer through an approved payment method.'
        when 'payout_submitted' then 'Transfer documented; awaiting verification by authorized staff. The refund is not completed yet.'
        when 'refunded' then 'Transfer verified. Refund completed.' else 'Request rejected. ' end,
      case when v_new='rejected' then trim(p_reason) else '' end),'refund_request',p_id);
end $$;
revoke all on function public.transition_refund_workflow(uuid,text,text,text,text,text,boolean) from public,anon;
grant execute on function public.transition_refund_workflow(uuid,text,text,text,text,text,boolean) to authenticated;
-- Old callers cannot bypass the mandatory submission/verification stages.
create or replace function public.transition_refund(p_id uuid,p_action text,p_reason text default null,p_reference text default null,p_proof text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.transition_refund_workflow(p_id,p_action,p_reason,p_reference,p_proof,'GCash',false);
end $$;

-- A transfer awaiting verification still allocates funds and prevents deletion of
-- its source payments. Existing legacy rules remain intact otherwise.
create or replace function public.lock_payment_refund_funds()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_paid numeric; v_allocated numeric;
begin
  v_id:=case when tg_op='DELETE' then old.reservation_id else new.reservation_id end;
  perform 1 from public.reservations where reservation_id=v_id for update;
  perform 1 from public.transactions where reservation_id=v_id for update;
  if exists(select 1 from public.reservations where reservation_id=v_id and status='cancelled') and
    (tg_op='INSERT' or (old.status='verified' and (tg_op='DELETE' or new.status is distinct from old.status or new.amount is distinct from old.amount))) then
    raise exception 'Cancelled reservations cannot receive new payments or have their verified payment history removed' using errcode='40001'; end if;
  if tg_op<>'INSERT' and old.status='verified' and (tg_op='DELETE' or new.status is distinct from 'verified' or new.amount is distinct from old.amount) then
    select coalesce(sum(amount),0) into v_paid from public.payments where reservation_id=v_id and status='verified' and payment_id<>old.payment_id;
    if tg_op='UPDATE' and new.status='verified' then v_paid:=v_paid+new.amount; end if;
    select coalesce(sum(amount),0) into v_allocated from public.refund_requests where reservation_id=v_id
      and status in ('pending','reviewed','approved','payout_submitted','refunded');
    if v_paid<v_allocated then raise exception 'Resolve allocated refunds before changing verified payments' using errcode='40001'; end if;
  end if;
  if tg_op='UPDATE' and new.reservation_id is distinct from old.reservation_id then raise exception 'A payment cannot be moved to another reservation' using errcode='22023'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;

-- Authenticated clients must use the audited cancellation RPC. The trigger runs
-- as invoker, so it distinguishes direct writes from security-definer RPC writes.
create or replace function public.guard_cancellation_write()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated') and
    ((new.status='cancelled' and old.status is distinct from new.status)
      or new.cancellation_snapshot is distinct from old.cancellation_snapshot
      or new.cancellation_initiator is distinct from old.cancellation_initiator
      or new.cancelled_by is distinct from old.cancelled_by) then
    raise exception 'Use the audited cancellation workflow' using errcode='42501'; end if;
  return new;
end $$;
drop trigger if exists guard_cancellation_write on public.reservations;
create trigger guard_cancellation_write before update on public.reservations for each row execute function public.guard_cancellation_write();

-- Make the overpayment workflow aware of the new open states; keep its existing
-- ownership/amount rules and separate excess-payment feature.
do $$ declare v_body text;
begin
  select pg_catalog.pg_get_functiondef('public.request_overpayment_refund(uuid)'::regprocedure) into v_body;
  v_body:=replace(v_body,'''pending'', ''approved''','''pending'', ''reviewed'', ''approved'', ''payout_submitted''');
  execute v_body;
  select pg_catalog.pg_get_functiondef('public.get_guest_refund_overview()'::regprocedure) into v_body;
  v_body:=replace(v_body,'''pending'', ''approved''','''pending'', ''reviewed'', ''approved'', ''payout_submitted''');
  v_body:=replace(v_body,'''review_reason'', f.review_reason', '''review_reason'', f.review_reason, ''payment_review_notes'', f.payment_review_notes, ''payout_verification_notes'', f.payout_verification_notes');
  execute v_body;
end $$;
-- Proof access includes authorized independent verifiers. Uploads are made only
-- through the server after permission/status checks.
drop policy if exists "Staff read refund proof" on storage.objects;
create policy "Staff read refund proof" on storage.objects for select to authenticated using(bucket_id='refund-proofs' and exists
  (select 1 from public.staff_users s where s.id=auth.uid() and s.is_active and (s.role='admin' or exists
    (select 1 from public.role_permissions rp where rp.role=s.role and rp.permissions && array['refund_review','refund_payout','refund_verify']))));
notify pgrst,'reload schema';
commit;
