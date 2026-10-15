-- Apply after reservation-lifecycle, additional-services-billing, role-permissions,
-- overpayment-refunds and cancellation-refund-workflow migrations, before deploying.
begin;
insert into public.payment_methods(name,type,is_active)
select 'Cash','cash',true where not exists (select 1 from public.payment_methods where lower(btrim(type))='cash');

create or replace function public.guard_staff_cash_access()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.payment_methods where payment_method_id=new.payment_method_id and lower(btrim(type))='cash')
    and not exists(select 1 from public.staff_users s where s.id=auth.uid() and s.is_active
      and s.active_session_id is not null and s.active_session_id::text=auth.jwt()->>'session_id'
      and (s.role='admin' or exists(select 1 from public.role_permissions rp where rp.role=s.role and 'payment_entry'=any(rp.permissions)))) then
    raise exception 'Cash payments can only be recorded by authorized resort staff' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_staff_cash_access on public.payments;
create trigger guard_staff_cash_access before insert or update on public.payments for each row execute function public.guard_staff_cash_access();

-- Cash received by an authorized payment-entry staff member is verified in the same transaction.
-- Other payment methods keep the existing admin/cashier review rule.
create or replace function public.guard_payment_review()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_r public.reservations%rowtype;
begin
  if old.status <> 'pending' or new.status not in ('verified','rejected') or new.status is not distinct from old.status then
    raise exception 'Payment has already been reviewed or transition is invalid' using errcode='23514'; end if;
  if not exists (select 1 from public.staff_users s where s.id=auth.uid() and s.is_active and
    (s.role in ('admin','cashier') or (new.status='verified' and exists
      (select 1 from public.payment_methods m where m.payment_method_id=new.payment_method_id and lower(btrim(m.type))='cash')
      and exists (select 1 from public.role_permissions rp where rp.role=s.role and 'payment_entry'=any(rp.permissions))))) then
    raise exception 'Payment review permission required' using errcode='42501'; end if;
  select * into v_r from public.reservations where reservation_id=new.reservation_id for update;
  if v_r.status not in ('payment_submitted','confirmed') then
    raise exception 'Reservation cannot accept this payment' using errcode='40001'; end if;
  if new.status='verified' then new.verified_by:=auth.uid(); new.verified_at:=clock_timestamp();
  else new.rejected_by:=auth.uid(); new.rejected_at:=clock_timestamp(); end if;
  return new;
end $$;

-- Future receipts include previous completed refunds in the balance snapshot.
create or replace function public.create_receipt_on_payment()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_total numeric; v_paid numeric; v_name text;
begin
  if new.status='verified' and old.status is distinct from 'verified' then
    select total_amount into v_total from public.transactions where reservation_id=new.reservation_id;
    select greatest(coalesce((select sum(amount) from public.payments where reservation_id=new.reservation_id and status='verified'),0)
      -coalesce((select sum(amount) from public.refund_requests where reservation_id=new.reservation_id and status='refunded'),0),0) into v_paid;
    select nullif(btrim(coalesce(g.first_name,w.first_name,'')||' '||coalesce(g.last_name,w.last_name,'')),'') into v_name
      from public.reservations r left join public.guests g on g.id=r.guest_id
      left join public.walk_in_guests w on w.walk_in_guest_id=r.walk_in_guest_id where r.reservation_id=new.reservation_id;
    insert into public.receipts(payment_id,receipt_number,amount_paid,transaction_total_at_time,balance_after_payment,billed_to_name)
      values(new.payment_id,'RCPT-'||to_char(clock_timestamp() at time zone 'Asia/Manila','YYYYMMDD')||'-'||substr(new.payment_id::text,1,13),
        new.amount,v_total,greatest(coalesce(v_total,0)-v_paid,0),v_name) on conflict(payment_id) do nothing;
  end if;
  return new;
end $$;

-- Replacing the function does not install its trigger. Older installations may
-- have no receipt trigger, or a disabled/incorrect trigger with this name.
-- Recreate the canonical trigger without changing any existing receipt rows.
drop trigger if exists trigger_create_receipt on public.payments;
create trigger trigger_create_receipt after update of status on public.payments
for each row when (new.status='verified' and old.status is distinct from 'verified')
execute function public.create_receipt_on_payment();

create or replace function public.record_staff_cash_payment(p_reservation uuid,p_amount numeric,p_reference text,p_expected_balance numeric,p_received boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_r public.reservations%rowtype; v_t public.transactions%rowtype;
  v_p public.payments%rowtype; v_receipt public.receipts%rowtype; v_method uuid; v_reference text:=upper(btrim(p_reference));
  v_replayed boolean:=false;
begin
  if not exists (select 1 from public.staff_users s where s.id=v_actor and s.is_active
    and s.active_session_id is not null and s.active_session_id::text=auth.jwt()->>'session_id'
    and (s.role='admin' or exists(select 1 from public.role_permissions rp where rp.role=s.role and 'payment_entry'=any(rp.permissions)))) then
    raise exception 'Cash payment entry permission required' using errcode='42501'; end if;
  if p_received is distinct from true or p_amount is null or p_amount<=0 or p_amount>99999999.99 or p_amount<>round(p_amount,2)
    or p_expected_balance is null or p_expected_balance<=0 or p_expected_balance>99999999.99
    or v_reference is null or v_reference !~ '^CASH-[A-Z0-9-]{8,64}$' then
    raise exception 'Confirm the cash was received and enter a valid amount and cash reference' using errcode='22023'; end if;
  select * into v_r from public.reservations where reservation_id=p_reservation for update;
  if not found then raise exception 'Reservation not found' using errcode='P0002'; end if;
  select * into v_p from public.payments where reference_number=v_reference;
  if found then
    if v_p.reservation_id<>p_reservation or v_p.amount<>p_amount or v_p.status<>'verified' or not exists
      (select 1 from public.payment_methods where payment_method_id=v_p.payment_method_id and lower(btrim(type))='cash') then
      raise exception 'This payment reference is already in use' using errcode='23505'; end if;
    v_replayed:=true;
  else
    select * into v_t from public.transactions where reservation_id=p_reservation for update;
    if not found then raise exception 'Reservation bill not found' using errcode='P0002'; end if;
    perform public.refresh_reservation_payment_totals(p_reservation);
    select * into v_t from public.transactions where reservation_id=p_reservation;
    if v_r.status not in ('pending','confirmed') then raise exception 'This reservation cannot accept a new cash payment' using errcode='40001'; end if;
    if v_r.status='pending' and (v_r.payment_deadline_at is null or v_r.payment_deadline_at<=clock_timestamp()) then
      raise exception 'The reservation payment deadline has expired' using errcode='40001'; end if;
    if exists(select 1 from public.payments where reservation_id=p_reservation and status='pending')
      or exists(select 1 from public.reservation_reschedules where reservation_id=p_reservation and status='pending') then
      raise exception 'Resolve the pending payment or reschedule review before recording cash' using errcode='40001'; end if;
    if exists(select 1 from public.refund_requests where reservation_id=p_reservation and status in ('pending','reviewed','approved','payout_submitted')) then
      raise exception 'Resolve the open refund before recording cash' using errcode='40001'; end if;
    if v_t.balance<=0 or v_t.balance is distinct from p_expected_balance then
      raise exception 'The reservation balance changed. Refresh the ledger and review the amount' using errcode='40001'; end if;
    if p_amount>v_t.balance then raise exception 'Cash applied exceeds the remaining balance. Give any change separately' using errcode='22023'; end if;
    if v_r.status='pending' and coalesce(v_t.paid_amount,0)+p_amount<ceil(v_t.total_amount*100*0.20)/100 then
      raise exception 'The initial cash payment must cover the required 20%% downpayment' using errcode='22023'; end if;
    select payment_method_id into v_method from public.payment_methods where lower(btrim(type))='cash' and is_active order by created_at,payment_method_id limit 1;
    if v_method is null then raise exception 'Enable Cash under Business Catalog > Payment methods before recording cash' using errcode='22023'; end if;
    insert into public.payments(reservation_id,amount,payment_method_id,payment_type,status,reference_number,account_name,account_number,proof_path,ocr_status)
      values(p_reservation,p_amount,v_method,case when p_amount=v_t.balance then 'full' when coalesce(v_t.paid_amount,0)=0 then 'downpayment' else 'additional' end,
        'pending',v_reference,'Cash received at resort',null,'','not_applicable') returning * into v_p;
    update public.payments set status='verified',paid_at=clock_timestamp() where payment_id=v_p.payment_id returning * into v_p;
    perform public.refresh_reservation_payment_totals(p_reservation);
    select * into v_t from public.transactions where reservation_id=p_reservation;
    update public.invoices set status=case when v_t.balance=0 then 'paid' when coalesce(v_t.paid_amount,0)>0 then 'partially_paid' else 'issued' end
      where invoice_id=(select invoice_id from public.invoices where reservation_id=p_reservation and status<>'void' order by created_at desc,invoice_id desc limit 1);
    select * into v_receipt from public.receipts where payment_id=v_p.payment_id;
    if not found then raise exception 'Receipt creation is not configured. Cash was not recorded' using errcode='55000'; end if;
    insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
      values(v_actor,v_actor,'Recorded cash payment','payment',v_p.payment_id,jsonb_build_object('reservation_id',p_reservation,
        'amount',p_amount,'payment_method','Cash','payment_reference',v_reference,'cash_received',true,'balance_before',p_expected_balance,'balance_after',v_t.balance,'receipt_number',v_receipt.receipt_number));
  end if;
  select * into v_t from public.transactions where reservation_id=p_reservation;
  select * into v_receipt from public.receipts where payment_id=v_p.payment_id;
  if v_receipt.receipt_id is null then raise exception 'Receipt is unavailable. Contact the administrator' using errcode='55000'; end if;
  return jsonb_build_object('payment',to_jsonb(v_p),'reservation',to_jsonb(v_r),'receipt',to_jsonb(v_receipt),
    'remainingBalance',v_t.balance,'overpaidAmount',v_t.overpaid_amount,'alreadyRecorded',v_replayed);
end $$;
revoke all on function public.record_staff_cash_payment(uuid,numeric,text,numeric,boolean) from public,anon;
grant execute on function public.record_staff_cash_payment(uuid,numeric,text,numeric,boolean) to authenticated;
-- Refresh PostgREST's function cache even when this migration is reapplied manually.
notify pgrst, 'reload schema';
commit;
