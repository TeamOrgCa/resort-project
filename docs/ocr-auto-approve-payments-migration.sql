-- Apply after gcash-payment-validation, payment-review-and-notifications,
-- staff-cash-payments, overpayment-refunds and cancellation-refund-workflow migrations.
-- New server-screened consistent GCash receipts are approved atomically.
-- Existing pending receipts retain their manual review workflow.
begin;
alter table public.payments add column if not exists auto_approved boolean not null default false;

create or replace function public.guard_ocr_auto_approval_marker()
returns trigger language plpgsql set search_path='' as $$
begin
  if (tg_op='INSERT' and new.auto_approved) or
     (tg_op='UPDATE' and new.auto_approved is distinct from old.auto_approved) then
    if auth.role() is distinct from 'service_role' or auth.uid() is not null
      or current_setting('app.ocr_auto_payment',true) is distinct from new.payment_id::text
      or not new.auto_approved or new.status<>'verified' or new.ocr_status<>'consistent' then
      raise exception 'OCR approval is restricted to the server verification workflow' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_ocr_auto_approval_marker() from public,anon,authenticated;
drop trigger if exists guard_ocr_auto_approval_marker on public.payments;
create trigger guard_ocr_auto_approval_marker before insert or update of auto_approved on public.payments
for each row execute function public.guard_ocr_auto_approval_marker();

create or replace function public.guard_payment_review()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_r public.reservations%rowtype; v_auto boolean:=coalesce(auth.role()='service_role' and auth.uid() is null and current_setting('app.ocr_auto_payment',true)=new.payment_id::text and old.ocr_status='consistent' and new.auto_approved and new.status='verified',false);
begin
  if old.status<>'pending' or new.status not in ('verified','rejected') or new.status is not distinct from old.status then
    raise exception 'Payment has already been reviewed or transition is invalid' using errcode='23514'; end if;
  if not v_auto and (not public.can_review_payment(new.payment_method_id) or (new.status='rejected' and not exists
    (select 1 from public.staff_users s where s.id=auth.uid() and s.is_active and (s.role='admin' or exists
      (select 1 from public.role_permissions rp where rp.role=s.role and 'payment_approval'=any(rp.permissions)))))) then
    raise exception 'Payment approval permission required' using errcode='42501'; end if;
  select * into v_r from public.reservations where reservation_id=new.reservation_id for update;
  if v_r.status not in ('payment_submitted','confirmed') then
    raise exception 'Reservation cannot accept this payment review' using errcode='40001'; end if;
  if new.status='verified' then
    new.verified_by:=auth.uid(); new.verified_at:=clock_timestamp(); new.rejection_reason:=null;
  else
    new.rejection_reason:=btrim(new.rejection_reason);
    if coalesce(length(new.rejection_reason),0) not between 5 and 2000 then
      raise exception 'A rejection reason of 5 to 2,000 characters is required' using errcode='22023'; end if;
    new.rejected_by:=auth.uid(); new.rejected_at:=clock_timestamp();
  end if;
  return new;
end $$;

create or replace function public.finish_payment_review()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status='pending' and new.status in ('verified','rejected') then
    update public.reservations set status=case when new.status='verified' then 'confirmed' else 'rejected' end
      where reservation_id=new.reservation_id and status='payment_submitted';
    perform public.refresh_reservation_payment_totals(new.reservation_id);
    insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
      values(auth.uid(),auth.uid(),case when new.status='verified' then 'Approved payment verification' else 'Rejected payment verification' end,
        'payment',new.payment_id,jsonb_build_object('reservation_id',new.reservation_id,'amount',new.amount,
          'reference_number',new.reference_number,'status',new.status,'rejection_reason',new.rejection_reason,
          'automatic_approval',new.auto_approved,'approval_source',case when new.auto_approved then 'consistent_gcash_ocr' else 'staff' end));
  end if;
  return new;
end $$;

create or replace function public.submit_consistent_gcash_payment(p_payment jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_r public.reservations%rowtype; v_id uuid; v_t public.transactions%rowtype;
  v_previous text:=current_setting('app.ocr_auto_payment',true);
begin
  if auth.role() is distinct from 'service_role' or auth.uid() is not null then
    raise exception 'Server payment verification required' using errcode='42501'; end if;
  if p_payment is null or jsonb_typeof(p_payment)<>'object' or p_payment->>'ocr_status' is distinct from 'consistent'
    or nullif(p_payment->>'receipt_paid_at','') is null or nullif(p_payment->>'ocr_checked_at','') is null then
    raise exception 'A complete consistent OCR result is required' using errcode='22023'; end if;
  select * into v_r from public.reservations where reservation_id=(p_payment->>'reservation_id')::uuid for update;
  if not found or v_r.guest_id is null or not exists(select 1 from public.guests where id=v_r.guest_id and is_active)
    or split_part(coalesce(p_payment->>'proof_path',''),'/',1)<>v_r.guest_id::text
    or length(coalesce(p_payment->>'proof_path',''))<=37 then
    raise exception 'An active reservation owner and their receipt are required' using errcode='42501'; end if;
  perform 1 from public.transactions where reservation_id=v_r.reservation_id for update;
  if not found then raise exception 'Reservation bill not found' using errcode='22023'; end if;
  if not exists(select 1 from public.payment_methods where payment_method_id=(p_payment->>'payment_method_id')::uuid
    and is_active and (name||' '||type) ~* '\mg[[:space:]]*cash\M') then
    raise exception 'An active GCash method is required' using errcode='22023'; end if;
  -- The existing GCash insert trigger validates the reference, Manila date,
  -- current bill/minimum, payment deadline and conflicting submissions.
  insert into public.payments(reservation_id,amount,payment_method_id,payment_type,status,reference_number,
    receipt_paid_at,account_name,account_number,proof_path,ocr_status,ocr_notes,ocr_checked_at)
  values(v_r.reservation_id,(p_payment->>'amount')::numeric,(p_payment->>'payment_method_id')::uuid,
    p_payment->>'payment_type','pending',p_payment->>'reference_number',(p_payment->>'receipt_paid_at')::timestamptz,
    p_payment->>'account_name',p_payment->>'account_number',p_payment->>'proof_path','consistent',
    p_payment->>'ocr_notes',(p_payment->>'ocr_checked_at')::timestamptz) returning payment_id into v_id;
  update public.reservations set status='payment_submitted' where reservation_id=v_r.reservation_id and status='pending';
  perform set_config('app.ocr_auto_payment',v_id::text,true);
  update public.payments set status='verified',auto_approved=true where payment_id=v_id;
  if not exists(select 1 from public.reservations where reservation_id=v_r.reservation_id and status='confirmed')
    or not exists(select 1 from public.receipts where payment_id=v_id) then
    raise exception 'Payment confirmation or receipt triggers are missing. Apply the billing prerequisites' using errcode='40001'; end if;
  perform set_config('app.ocr_auto_payment',coalesce(v_previous,''),true);
  select * into v_t from public.transactions where reservation_id=v_r.reservation_id;
  return jsonb_build_object('payment_id',v_id,'status','verified','ocr_status','consistent','auto_approved',true,
    'reservation_status','confirmed','total_amount',v_t.total_amount,'paid_amount',v_t.paid_amount,
    'remaining_balance',v_t.balance,'overpaid_amount',v_t.overpaid_amount);
end $$;
revoke all on function public.submit_consistent_gcash_payment(jsonb) from public,anon,authenticated;
grant execute on function public.submit_consistent_gcash_payment(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
