-- Apply after cancellation-refund-workflow-migration.sql if it is already installed.
-- Allow active administrators to verify their own documented payout. Approval,
-- evidence, notes, acknowledgement, accounting and audit checks remain mandatory.
begin;
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
notify pgrst,'reload schema';
commit;
