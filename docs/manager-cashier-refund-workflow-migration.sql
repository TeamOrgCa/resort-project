-- Apply AFTER admin-read-only-manager-refunds-migration.sql and
-- non-refundable-reschedule-fees-migration.sql, and after all older refund migrations.
-- Safe to reapply. Preserves refund amounts, snapshots, historical review notes,
-- completed payouts and existing statuses. Legacy reviewed requests can be approved directly.
-- Deploy together with the manager -> cashier -> manager application changes.
begin;

-- Keep unrelated grants; retire the cashier-review step and incompatible refund grants.
update public.role_permissions set permissions=array(
  select distinct p from unnest(array_remove(array_remove(permissions,'refund_review'),'refund_payout')
    || array['transactions','refund_approval','refund_verify']) p
) where role='staff';
update public.role_permissions set permissions=array(
  select distinct p from unnest(array_remove(array_remove(array_remove(permissions,'refund_review'),'refund_approval'),'refund_verify')
    || array['transactions','refund_payout']) p
) where role='cashier';

-- Enforce role boundaries even when permission arrays are forged or RPCs are called directly.
create or replace function public.refund_staff_permission(p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_users s where s.id=auth.uid() and s.is_active and s.role<>'admin'
    and p_permission<>'refund_review'
    and (p_permission not in ('refund_approval','refund_verify') or s.role='staff')
    and (p_permission<>'refund_payout' or s.role='cashier')
    and exists(select 1 from public.role_permissions rp where rp.role=s.role and p_permission=any(rp.permissions)));
$$;
revoke all on function public.refund_staff_permission(text) from public,anon;
grant execute on function public.refund_staff_permission(text) to authenticated;

create or replace function public.transition_refund_workflow(p_id uuid,p_action text,p_reason text default null,
  p_reference text default null,p_proof text default null,p_method text default 'GCash',p_verified boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare f public.refund_requests%rowtype; v_id uuid; r public.reservations%rowtype;
  v_total numeric; v_available numeric; v_other numeric; v_new text; v_permission text;
begin
  if p_action is null or p_action not in ('approved','rejected','payout_submitted','refunded') then
    raise exception 'Refunds go directly to manager approval; a separate payment-review step is not supported' using errcode='22023';
  end if;
  v_permission:=case when p_action='payout_submitted' then 'refund_payout' when p_action='refunded' then 'refund_verify' else 'refund_approval' end;
  if not public.refund_staff_permission(v_permission) then raise exception 'Refund permission required' using errcode='42501'; end if;
  if p_action in ('approved','rejected') and not exists(select 1 from public.staff_users where id=auth.uid() and role='staff' and is_active) then
    raise exception 'Only an authorized manager can approve or reject refunds' using errcode='42501'; end if;
  select reservation_id into v_id from public.refund_requests where refund_id=p_id;
  if not found then raise exception 'Refund request not found' using errcode='22023'; end if;
  select * into r from public.reservations where reservation_id=v_id for update;
  select total_amount into v_total from public.transactions where reservation_id=v_id for update;
  select * into f from public.refund_requests where refund_id=p_id for update;
  if f.workflow_version=1 and f.request_kind='cancellation' and p_action<>'rejected' then
    raise exception 'A manager must classify and recalculate this legacy cancellation before processing' using errcode='40001'; end if;
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
  if p_action='approved' and f.status in ('pending','reviewed') then
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
    if f.payout_submitted_by=auth.uid() then
      raise exception 'A different authorized manager must verify this payout' using errcode='42501'; end if;
    if f.gcash_reference is null or f.proof_path is null or not exists(select 1 from storage.objects where bucket_id='refund-proofs' and name=f.proof_path) then
      raise exception 'Payout evidence is missing' using errcode='22023'; end if;
    update public.refund_requests set status='refunded',refunded_by=auth.uid(),refunded_at=now(),payout_verification_notes=trim(p_reason) where refund_id=p_id; v_new:='refunded';
  else raise exception 'Invalid refund transition. Refresh the request and complete the preceding step' using errcode='22023'; end if;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(auth.uid(),auth.uid(),'Refund '||v_new,'refund_request',p_id,jsonb_build_object('reservation_id',v_id,'amount',f.amount,
      'old_status',f.status,'new_status',v_new,'reason',p_reason,'reference',coalesce(p_reference,f.gcash_reference),
      'proof',coalesce(p_proof,f.proof_path),'verified',p_verified,
      'same_actor_verification',p_action='refunded' and f.payout_submitted_by=auth.uid()));
  perform public.notify_refund_workflow(f.guest_id,'Refund '||replace(v_new,'_',' '),
    format('Reservation %s: PHP %s refund. %s%s',r.reference_number,f.amount,
      case v_new when 'approved' then 'Approved by a manager; awaiting manual transfer by a cashier through an approved payment method.'
        when 'payout_submitted' then 'Transfer documented; awaiting verification by an authorized manager. The refund is not completed yet.'
        when 'refunded' then 'Transfer verified. Refund completed.' else 'Request rejected. ' end,
      case when v_new='rejected' then trim(p_reason) else '' end),'refund_request',p_id);
end $$;

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
      case when v_id is null then 'No refund request is needed.' else 'A refund request was created automatically. A manager will approve or reject it, a cashier will transfer approved funds, and a manager will verify the transfer.' end),
    case when v_id is null then 'reservation' else 'refund_request' end,coalesce(v_id,p_reservation));
  return v_quote || jsonb_build_object('refundId',v_id,'status','cancelled');
end $$;

create or replace function public.recalculate_legacy_cancellation_refund(p_id uuid,p_initiator text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare f public.refund_requests%rowtype; v_res uuid; q jsonb;
begin
  if not public.refund_staff_permission('refund_approval') then
    raise exception 'Manager refund approval permission required' using errcode='42501'; end if;
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
    format('Verified cancellation refund: PHP %s; retained deposit: PHP %s. Manager documentation: %s. A positive refund is awaiting manager approval.',q->>'refundableAmount',q->>'deduction',trim(p_reason)), 'refund_request',p_id);
end $$;

revoke all on function public.transition_refund_workflow(uuid,text,text,text,text,text,boolean) from public,anon;
grant execute on function public.transition_refund_workflow(uuid,text,text,text,text,text,boolean) to authenticated;
revoke all on function public.cancel_reservation_evaluated(uuid,text,text,text) from public,anon;
grant execute on function public.cancel_reservation_evaluated(uuid,text,text,text) to authenticated;
revoke all on function public.recalculate_legacy_cancellation_refund(uuid,text,text) from public,anon;
grant execute on function public.recalculate_legacy_cancellation_refund(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
