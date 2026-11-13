-- Apply after ocr-auto-approve-payments, ocr-toggle-manual-review,
-- payment-review-and-notifications, staff-payment-methods and their prerequisites.
-- Existing payments, verified totals, receipts and GCash OCR functions are preserved.
begin;

alter table public.payments add column if not exists receiving_account_id uuid
  references public.payment_accounts(account_id);

create or replace function public.submit_manual_guest_payment(p_payment jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; t public.transactions%rowtype;
  m public.payment_methods%rowtype; a public.payment_accounts%rowtype;
  v_id uuid; v_amount numeric; v_minimum numeric; v_reference text; v_type text;
  v_now timestamptz:=clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' or auth.uid() is not null then
    raise exception 'Server payment submission required' using errcode='42501'; end if;
  if p_payment is null or jsonb_typeof(p_payment)<>'object'
    or p_payment->>'ocr_status' is distinct from 'not_applicable' then
    raise exception 'A payment requiring manual review is required' using errcode='22023'; end if;
  select * into r from public.reservations where reservation_id=(p_payment->>'reservation_id')::uuid for update;
  if not found or r.guest_id is null or r.guest_id is distinct from (p_payment->>'guest_id')::uuid
    or not exists(select 1 from public.guests where id=r.guest_id and is_active)
    or split_part(coalesce(p_payment->>'proof_path',''),'/',1)<>r.guest_id::text
    or position('..' in coalesce(p_payment->>'proof_path',''))>0
    or coalesce(p_payment->>'proof_path','') !~* '\.(png|jpe?g|webp)$'
    or not exists(select 1 from storage.objects where bucket_id='payment-proofs' and name=p_payment->>'proof_path') then
    raise exception 'An active reservation owner and their uploaded proof are required' using errcode='42501'; end if;
  select * into t from public.transactions where reservation_id=r.reservation_id for update;
  if not found then raise exception 'Reservation bill not found' using errcode='22023'; end if;
  if r.status not in ('pending','confirmed') or exists(select 1 from public.payments where reservation_id=r.reservation_id and status='pending')
    or exists(select 1 from public.reservation_reschedules where reservation_id=r.reservation_id and status='pending')
    or exists(select 1 from public.refund_requests where reservation_id=r.reservation_id and status in ('pending','reviewed','approved','payout_submitted')) then
    raise exception 'Resolve the pending payment, reschedule or refund before submitting payment' using errcode='40001'; end if;
  if r.status='pending' and (r.payment_deadline_at is null or r.payment_deadline_at<=v_now) then
    raise exception 'Payment deadline has expired' using errcode='P0001'; end if;
  select * into m from public.payment_methods where payment_method_id=(p_payment->>'payment_method_id')::uuid for share;
  if not found or m.is_active is distinct from true or lower(btrim(m.name))='cash' or lower(btrim(m.type))='cash'
    or (m.name||' '||m.type) ~* '\mg[[:space:]]*cash\M' then
    raise exception 'Select an active non-cash method requiring manual review' using errcode='22023'; end if;
  select * into a from public.payment_accounts where account_id=(p_payment->>'receiving_account_id')::uuid for share;
  if not found or a.is_active is distinct from true or a.payment_method_id is distinct from m.payment_method_id
    or (nullif(btrim(a.account_number),'') is null and nullif(btrim(a.qr_image),'') is null) then
    raise exception 'Select an active receiving account for this method' using errcode='22023'; end if;
  v_amount:=(p_payment->>'amount')::numeric;
  v_reference:=regexp_replace(upper(btrim(p_payment->>'reference_number')),'[ -]','','g');
  v_type:=p_payment->>'payment_type';
  if v_amount is null or v_amount='NaN'::numeric or v_amount<=0 or v_amount>99999999.99 or v_amount<>round(v_amount,2)
    or v_reference is null or v_reference !~ '^[A-Z0-9]{6,100}$'
    or nullif(btrim(p_payment->>'account_name'),'') is null or length(p_payment->>'account_name')>120
    or coalesce(p_payment->>'account_number','') !~ '^[A-Za-z0-9][A-Za-z0-9@._+ -]{2,119}$' then
    raise exception 'Enter a valid amount, transaction reference and sender details' using errcode='22023'; end if;
  if coalesce(t.balance,0)<=0 then raise exception 'This reservation has no remaining balance' using errcode='40001'; end if;
  if v_type='downpayment' and coalesce(t.paid_amount,0)=0 then v_minimum:=ceil(t.total_amount*100*0.20)/100;
  elsif v_type='full' then v_minimum:=t.balance;
  else raise exception 'Only the outstanding balance can be paid after a verified payment' using errcode='40001'; end if;
  if v_amount<v_minimum then raise exception 'Amount is below the current minimum. Reload the bill' using errcode='40001'; end if;

  -- Never credit funds, create a receipt, trust a client OCR result or mark automatic approval.
  insert into public.payments(reservation_id,amount,payment_method_id,receiving_account_id,payment_type,status,reference_number,
    receipt_paid_at,account_name,account_number,proof_path,ocr_status,ocr_notes,ocr_checked_at,auto_approved)
  values(r.reservation_id,v_amount,m.payment_method_id,a.account_id,v_type,'pending',v_reference,
    null,btrim(p_payment->>'account_name'),btrim(p_payment->>'account_number'),p_payment->>'proof_path','not_applicable',
    'Manual verification required. Match the proof against actual received funds.',null,false) returning payment_id into v_id;
  update public.reservations set status='payment_submitted' where reservation_id=r.reservation_id and status='pending';
  select * into r from public.reservations where reservation_id=r.reservation_id;
  select * into t from public.transactions where reservation_id=r.reservation_id;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
  values(null,null,'Submitted payment for manual review','payment',v_id,
    jsonb_build_object('guest_id',r.guest_id,'reservation_id',r.reservation_id,'amount',v_amount,
      'payment_method_id',m.payment_method_id,'receiving_account_id',a.account_id,
      'receiving_account_name',a.account_name,'receiving_account_number',a.account_number,'automatic_approval',false));
  return jsonb_build_object('payment_id',v_id,'status','pending','ocr_status','not_applicable','auto_approved',false,
    'reservation_status',r.status,'total_amount',t.total_amount,'paid_amount',t.paid_amount,
    'remaining_balance',t.balance,'overpaid_amount',t.overpaid_amount);
end $$;
revoke all on function public.submit_manual_guest_payment(jsonb) from public,anon,authenticated;
grant execute on function public.submit_manual_guest_payment(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
