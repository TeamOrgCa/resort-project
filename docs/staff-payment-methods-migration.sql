-- Apply after staff-cash-payments, payment-review-and-notifications,
-- overpayment-refunds and the existing booking/billing migrations.
-- Cash keeps its existing RPC. Other active catalog methods use the atomic
-- staff-entry RPC below. Existing payments and grants are not rewritten.
begin;

-- Entry permission can verify only the new payment currently being recorded by
-- record_staff_payment. It does not grant general approval of guest submissions.
create or replace function public.can_review_payment(p_method uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_users s where s.id=auth.uid() and s.is_active
    and s.active_session_id is not null and s.active_session_id::text=auth.jwt()->>'session_id'
    and (s.role='admin' or exists(select 1 from public.role_permissions rp where rp.role=s.role
      and ('payment_approval'=any(rp.permissions) or ('payment_entry'=any(rp.permissions) and (
        exists(select 1 from public.payment_methods m where m.payment_method_id=p_method and lower(btrim(m.type))='cash')
        or exists(select 1 from public.payments p where p.payment_id::text=current_setting('app.staff_recorded_payment',true)
          and p.payment_method_id=p_method and p.status='pending')))))));
$$;
revoke all on function public.can_review_payment(uuid) from public,anon;
grant execute on function public.can_review_payment(uuid) to authenticated;

create or replace function public.record_staff_payment(
  p_reservation uuid,p_amount numeric,p_reference text,p_expected_balance numeric,
  p_method uuid,p_received boolean,p_account_name text,p_account_number text,p_proof text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); r public.reservations%rowtype; t public.transactions%rowtype;
  p public.payments%rowtype; receipt public.receipts%rowtype; method public.payment_methods%rowtype;
  v_reference text:=regexp_replace(upper(btrim(p_reference)),'[ -]','','g');
  v_previous text:=current_setting('app.staff_recorded_payment',true);
  v_replayed boolean:=false; v_confirmed boolean:=false;
begin
  if not exists(select 1 from public.staff_users s join public.role_permissions rp on rp.role=s.role
    where s.id=v_actor and s.is_active and s.role in ('staff','cashier')
      and s.active_session_id is not null and s.active_session_id::text=auth.jwt()->>'session_id'
      and 'payment_entry'=any(rp.permissions)) then
    raise exception 'Active staff payment-entry permission required' using errcode='42501'; end if;
  if p_received is distinct from true or p_amount is null or p_amount='NaN'::numeric
    or p_amount<=0 or p_amount>99999999.99 or p_amount<>round(p_amount,2)
    or p_expected_balance is null or p_expected_balance='NaN'::numeric
    or p_expected_balance<=0 or p_expected_balance>99999999.99
    or p_reference is null or p_reference !~ '^[A-Za-z0-9][A-Za-z0-9 -]{5,99}$'
    or length(v_reference)<6 or nullif(btrim(p_account_name),'') is null or length(p_account_name)>120
    or p_account_number is null or p_account_number !~ '^[0-9]{6,20}$' then
    raise exception 'Confirm received funds and enter valid amount, reference and sender details' using errcode='22023'; end if;
  if p_proof is null or split_part(p_proof,'/',1)<>v_actor::text or split_part(p_proof,'/',2)<>'staff'
    or length(split_part(p_proof,'/',3))<1 or position('..' in p_proof)>0
    or not exists(select 1 from storage.objects where bucket_id='payment-proofs' and name=p_proof) then
    raise exception 'Your uploaded staff payment proof is required' using errcode='42501'; end if;
  select * into method from public.payment_methods where payment_method_id=p_method;
  if not found or lower(btrim(method.type))='cash' or lower(btrim(method.name))='cash' then
    raise exception 'Select an available non-cash payment method' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(424243,hashtext(v_reference));
  select * into r from public.reservations where reservation_id=p_reservation for update;
  if not found then raise exception 'Reservation not found' using errcode='P0002'; end if;
  select * into p from public.payments where regexp_replace(upper(reference_number),'[^A-Z0-9]','','g')=v_reference;
  if found then
    if p.reservation_id is distinct from p_reservation or p.amount is distinct from p_amount
      or p.payment_method_id is distinct from p_method or p.status is distinct from 'verified'
      or p.account_name is distinct from btrim(p_account_name) or p.account_number is distinct from p_account_number
      or p.proof_path is distinct from p_proof then
      raise exception 'This transaction reference is already used by a different payment' using errcode='23505'; end if;
    v_replayed:=true;
  else
    if method.is_active is distinct from true then raise exception 'This payment method is inactive' using errcode='22023'; end if;
    select * into t from public.transactions where reservation_id=p_reservation for update;
    if not found then raise exception 'Reservation bill not found' using errcode='P0002'; end if;
    perform public.refresh_reservation_payment_totals(p_reservation);
    select * into t from public.transactions where reservation_id=p_reservation;
    if r.status not in ('pending','confirmed') then raise exception 'This reservation cannot accept a new payment' using errcode='40001'; end if;
    if r.status='pending' and (r.payment_deadline_at is null or r.payment_deadline_at<=clock_timestamp()) then
      raise exception 'The reservation payment deadline has expired' using errcode='40001'; end if;
    if exists(select 1 from public.payments where reservation_id=p_reservation and status='pending')
      or exists(select 1 from public.reservation_reschedules where reservation_id=p_reservation and status='pending') then
      raise exception 'Resolve pending payment or reschedule reviews before recording payment' using errcode='40001'; end if;
    if exists(select 1 from public.refund_requests where reservation_id=p_reservation and status in ('pending','reviewed','approved','payout_submitted')) then
      raise exception 'Resolve the open refund before recording payment' using errcode='40001'; end if;
    if coalesce(t.balance,0)<=0 or t.balance is distinct from p_expected_balance then
      raise exception 'The balance changed. Refresh the ledger and review the amount' using errcode='40001'; end if;
    if p_amount>t.balance then raise exception 'Payment exceeds the remaining balance' using errcode='22023'; end if;
    if r.status='pending' and coalesce(t.paid_amount,0)+p_amount<ceil(t.total_amount*100*0.20)/100 then
      raise exception 'The initial payment must cover the required 20%% downpayment' using errcode='22023'; end if;
    v_confirmed:=r.status='pending';
    insert into public.payments(reservation_id,amount,payment_method_id,payment_type,status,reference_number,
      account_name,account_number,proof_path,ocr_status)
    values(p_reservation,p_amount,p_method,case when p_amount=t.balance then 'full' when coalesce(t.paid_amount,0)=0 then 'downpayment' else 'additional' end,
      'pending',v_reference,btrim(p_account_name),p_account_number,p_proof,'not_applicable') returning * into p;
    perform set_config('app.staff_recorded_payment',p.payment_id::text,true);
    update public.payments set status='verified',paid_at=clock_timestamp() where payment_id=p.payment_id returning * into p;
    perform set_config('app.staff_recorded_payment',coalesce(v_previous,''),true);
    perform public.refresh_reservation_payment_totals(p_reservation);
    select * into t from public.transactions where reservation_id=p_reservation;
    select * into r from public.reservations where reservation_id=p_reservation;
    if r.status<>'confirmed' then raise exception 'Booking confirmation is not configured. Payment was not recorded' using errcode='55000'; end if;
    update public.invoices set status=case when t.balance=0 then 'paid' when coalesce(t.paid_amount,0)>0 then 'partially_paid' else 'issued' end
      where invoice_id=(select invoice_id from public.invoices where reservation_id=p_reservation and status<>'void' order by created_at desc,invoice_id desc limit 1);
    select * into receipt from public.receipts where payment_id=p.payment_id;
    if not found then raise exception 'Receipt creation is not configured. Payment was not recorded' using errcode='55000'; end if;
    insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(v_actor,v_actor,'Recorded staff payment','payment',p.payment_id,jsonb_build_object('reservation_id',p_reservation,
      'amount',p_amount,'payment_method_id',p_method,'payment_method',method.name,'transaction_reference',v_reference,
      'funds_received',true,'proof_path',p_proof,'balance_before',p_expected_balance,'balance_after',t.balance,'receipt_number',receipt.receipt_number));
  end if;
  select * into t from public.transactions where reservation_id=p_reservation;
  select * into receipt from public.receipts where payment_id=p.payment_id;
  if receipt.receipt_id is null then raise exception 'Receipt is unavailable. Contact the administrator' using errcode='55000'; end if;
  return jsonb_build_object('payment',to_jsonb(p),'reservation',to_jsonb(r),'receipt',to_jsonb(receipt),
    'remainingBalance',t.balance,'overpaidAmount',t.overpaid_amount,'alreadyRecorded',v_replayed,'reservationConfirmed',v_confirmed);
end $$;
revoke all on function public.record_staff_payment(uuid,numeric,text,numeric,uuid,boolean,text,text,text) from public,anon;
grant execute on function public.record_staff_payment(uuid,numeric,text,numeric,uuid,boolean,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
