-- Apply after ocr-auto-approve-payments (and its prerequisites).
-- Normal payments retain their unique-reference and current-date checks.
begin;
alter table public.payments add column if not exists is_beta_test boolean not null default false;
alter table public.payments add column if not exists beta_receipt_reference text;

create or replace function public.mark_beta_receipt_payment()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.is_beta_test is distinct from old.is_beta_test or new.beta_receipt_reference is distinct from old.beta_receipt_reference then
      raise exception 'Beta payment markers cannot be changed' using errcode='42501'; end if;
    return new;
  end if;
  if auth.role()='service_role' and auth.uid() is null
    and current_setting('app.beta_payment_reference',true)=new.reference_number
    and nullif(current_setting('app.beta_receipt_reference',true),'') is not null then
    new.is_beta_test:=true;
    new.beta_receipt_reference:=current_setting('app.beta_receipt_reference',true);
  elsif new.is_beta_test or new.beta_receipt_reference is not null then
    raise exception 'Use the server beta payment workflow' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.mark_beta_receipt_payment() from public,anon,authenticated;
drop trigger if exists a_mark_beta_receipt_payment on public.payments;
create trigger a_mark_beta_receipt_payment before insert or update of is_beta_test,beta_receipt_reference on public.payments
for each row execute function public.mark_beta_receipt_payment();

create or replace function public.validate_screened_gcash_payment()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_r public.reservations%rowtype; v_t public.transactions%rowtype;
  v_minimum numeric; v_now timestamptz:=clock_timestamp(); v_beta boolean;
begin
  if new.receipt_paid_at is null then return new; end if;
  v_beta:=coalesce(new.is_beta_test and auth.role()='service_role' and auth.uid() is null
    and current_setting('app.beta_payment_reference',true)=new.reference_number,false);
  select * into v_r from public.reservations where reservation_id=new.reservation_id for update;
  select * into v_t from public.transactions where reservation_id=new.reservation_id for update;
  if not found then raise exception 'Reservation bill not found' using errcode='22023'; end if;
  if v_r.status not in ('pending','confirmed') or exists(select 1 from public.payments where reservation_id=new.reservation_id and status='pending') then
    raise exception 'Reservation changed or a payment is already pending. Reload your booking' using errcode='40001'; end if;
  if v_r.status='pending' and (v_r.payment_deadline_at is null or v_r.payment_deadline_at<=v_now) then
    raise exception 'Payment deadline has expired' using errcode='P0001'; end if;
  if not exists(select 1 from public.payment_methods where payment_method_id=new.payment_method_id
      and is_active and (name||' '||type) ~* '\mg[[:space:]]*cash\M')
    or new.ocr_status is distinct from 'consistent' or new.ocr_checked_at is null
    or new.reference_number is null or new.reference_number !~ '^[0-9]{8,20}$' then
    raise exception 'A fully validated GCash receipt is required' using errcode='22023'; end if;
  if not isfinite(new.receipt_paid_at) or (not v_beta and (
    (new.receipt_paid_at at time zone 'Asia/Manila')::date<>(v_now at time zone 'Asia/Manila')::date
    or new.receipt_paid_at>v_now+interval '1 minute')) then
    raise exception 'Receipt must show today in Philippine time and cannot be in the future' using errcode='22023'; end if;
  if coalesce(v_t.balance,0)<=0 then raise exception 'This reservation has no remaining balance' using errcode='40001'; end if;
  if new.payment_type='downpayment' and coalesce(v_t.paid_amount,0)=0 then
    v_minimum:=ceil(v_t.total_amount*100*0.20)/100;
  elsif new.payment_type='full' then v_minimum:=v_t.balance;
  else raise exception 'Only the outstanding balance can be paid after a verified payment' using errcode='40001'; end if;
  if new.amount is null or new.amount='NaN'::numeric or new.amount<v_minimum
    or new.amount>99999999.99 or new.amount<>round(new.amount,2) then
    raise exception 'Amount sent is below the current minimum or invalid. Reload and review the bill' using errcode='40001'; end if;
  return new;
end $$;

create or replace function public.submit_beta_gcash_payment(p_payment jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_reference text; v_original text; v_result jsonb;
  v_previous text:=current_setting('app.beta_payment_reference',true);
  v_previous_receipt text:=current_setting('app.beta_receipt_reference',true);
begin
  if auth.role() is distinct from 'service_role' or auth.uid() is not null then
    raise exception 'Server beta payment workflow required' using errcode='42501'; end if;
  v_original:=p_payment->>'reference_number';
  if v_original is null or v_original !~ '^[0-9]{8,20}$' or not exists(
    select 1 from public.reservations where reservation_id=(p_payment->>'reservation_id')::uuid
      and guest_id=(p_payment->>'guest_id')::uuid) then
    raise exception 'An extracted reference and reservation owner are required' using errcode='22023'; end if;
  -- A separate internal reference keeps normal unique constraints intact. The
  -- actual receipt reference remains in beta_receipt_reference and the audit.
  v_reference:='99'||lpad((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,14))::bit(56)::bigint)::text,18,'0');
  perform set_config('app.beta_payment_reference',v_reference,true);
  perform set_config('app.beta_receipt_reference',v_original,true);
  v_result:=public.submit_consistent_gcash_payment(p_payment||jsonb_build_object('reference_number',v_reference,
    'ocr_notes','BETA TEST: reused receipt; reference comparison and date freshness checks skipped. '||coalesce(p_payment->>'ocr_notes','')));
  perform set_config('app.beta_payment_reference',coalesce(v_previous,''),true);
  perform set_config('app.beta_receipt_reference',coalesce(v_previous_receipt,''),true);
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(null,null,'Approved beta test payment','payment',(v_result->>'payment_id')::uuid,
      jsonb_build_object('beta_test',true,'receipt_reference',v_original,'internal_reference',v_reference,
        'receipt_paid_at',p_payment->>'receipt_paid_at','reservation_id',p_payment->>'reservation_id'));
  return v_result||jsonb_build_object('is_beta_test',true,'beta_receipt_reference',v_original);
end $$;
revoke all on function public.submit_beta_gcash_payment(jsonb) from public,anon,authenticated;
grant execute on function public.submit_beta_gcash_payment(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
