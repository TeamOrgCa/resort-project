-- Apply after staff-payment-methods and role/session permission migrations.
-- Public admissions are collections, not private reservations or calendar holds.
begin;
create table if not exists public.public_access_sales (
  sale_id uuid primary key,
  reference_number text not null unique,
  receipt_number text not null unique,
  guest_name text not null check(length(btrim(guest_name)) between 1 and 100),
  contact_number text not null check(contact_number ~ '^\+639[0-9]{9}$'),
  access_type text not null check(access_type in ('swimming','cottage','room','mixed')),
  payment_for text not null check(length(btrim(payment_for)) between 3 and 2000),
  amount numeric(12,2) not null check(amount>0 and amount<=99999999.99),
  payment_method_id uuid not null references public.payment_methods(payment_method_id),
  payment_method_name text not null,
  payment_reference text not null,
  proof_path text,
  cashier_id uuid not null references public.staff_users(id),
  paid_at timestamptz not null default clock_timestamp()
);
create index if not exists public_access_sales_paid_at on public.public_access_sales(paid_at,sale_id);
create unique index if not exists public_access_sales_reference_unique on public.public_access_sales(payment_method_id,(regexp_replace(upper(payment_reference),'[^A-Z0-9]','','g')));
alter table public.public_access_sales enable row level security;
revoke all on public.public_access_sales from anon,authenticated;
grant select on public.public_access_sales to authenticated;
grant all on public.public_access_sales to service_role;
drop policy if exists "Staff read public collections" on public.public_access_sales;
create policy "Staff read public collections" on public.public_access_sales for select to authenticated using(exists(
  select 1 from public.staff_users s where s.id=auth.uid() and s.is_active and (s.role='admin' or exists(
    select 1 from public.role_permissions rp where rp.role=s.role and ('transactions'=any(rp.permissions) or 'reports'=any(rp.permissions))))));

create or replace function public.record_public_access_sale(p_request uuid,p_guest text,p_contact text,p_type text,p_payment_for text,
  p_amount numeric,p_method uuid,p_reference text,p_proof text,p_received boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.staff_users%rowtype; m public.payment_methods%rowtype; existing public.public_access_sales%rowtype;
  sale public.public_access_sales%rowtype; v_reference text; v_cash boolean;
begin
  select * into s from public.staff_users where id=auth.uid() and is_active and role='cashier' for share;
  if not found or s.active_session_id is null or s.active_session_id::text is distinct from auth.jwt()->>'session_id'
    or not exists(select 1 from public.role_permissions where role='cashier' and 'transactions'=any(permissions) and 'payment_entry'=any(permissions)) then
    raise exception 'An active cashier with Transactions and Record payments permission is required' using errcode='42501'; end if;
  if p_request is null or p_received is distinct from true or p_amount is null or p_amount<=0 or p_amount>99999999.99 or round(p_amount,2)<>p_amount
    or length(btrim(coalesce(p_guest,''))) not between 1 and 100 or p_contact is null or p_contact !~ '^\+639[0-9]{9}$'
    or p_type is null or p_type not in ('swimming','cottage','room','mixed') or length(btrim(coalesce(p_payment_for,''))) not between 3 and 2000 then
    raise exception 'Enter valid guest, contact, usage and received-payment details' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('public-sale:'||p_request::text,0));
  select * into existing from public.public_access_sales where sale_id=p_request;
  if found then
    if existing.cashier_id<>s.id or existing.guest_name<>btrim(p_guest) or existing.contact_number<>p_contact
      or existing.access_type<>p_type or existing.payment_for<>btrim(p_payment_for) or existing.amount<>p_amount or existing.payment_method_id is distinct from p_method
      or (existing.proof_path is not null and (existing.payment_reference is distinct from btrim(p_reference) or existing.proof_path is distinct from p_proof)) then
      raise exception 'This admission was already saved with different details. Check the ledger before making another collection' using errcode='40001'; end if;
    return jsonb_build_object('sale',to_jsonb(existing),'alreadyRecorded',true);
  end if;
  select * into m from public.payment_methods where payment_method_id=p_method and is_active for share;
  if not found then raise exception 'The selected payment method is no longer active' using errcode='22023'; end if;
  v_cash:=coalesce(lower(btrim(m.type))='cash',false) or lower(btrim(m.name))='cash';
  v_reference:=case when v_cash then 'PA-CASH-'||upper(replace(p_request::text,'-','')) else btrim(p_reference) end;
  if not v_cash and (v_reference is null or length(v_reference) not between 6 and 100 or v_reference !~ '^[A-Za-z0-9-]+$'
    or p_proof is null or p_proof not like s.id::text||'/staff/%' or strpos(p_proof,'..')>0
    or not exists(select 1 from storage.objects where bucket_id='payment-proofs' and name=p_proof)) then
    raise exception 'Enter the real transfer reference and upload owned payment proof' using errcode='22023'; end if;
  insert into public.public_access_sales(sale_id,reference_number,receipt_number,guest_name,contact_number,access_type,payment_for,amount,
    payment_method_id,payment_method_name,payment_reference,proof_path,cashier_id)
  values(p_request,'PA-'||upper(replace(p_request::text,'-','')),'PA-RCPT-'||upper(replace(p_request::text,'-','')),
    btrim(p_guest),p_contact,p_type,btrim(p_payment_for),p_amount,m.payment_method_id,m.name,v_reference,case when v_cash then null else p_proof end,s.id)
  returning * into sale;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
  values(s.id,s.id,'Recorded public access admission','public_access_sale',sale.sale_id,jsonb_build_object('reference_number',sale.reference_number,
    'guest_name',sale.guest_name,'access_type',sale.access_type,'payment_for',sale.payment_for,'amount',sale.amount,
    'payment_method',sale.payment_method_name,'transaction_reference',sale.payment_reference,'receipt_number',sale.receipt_number,'funds_received',true));
  return jsonb_build_object('sale',to_jsonb(sale),'alreadyRecorded',false);
end $$;
revoke all on function public.record_public_access_sale(uuid,text,text,text,text,numeric,uuid,text,text,boolean) from public,anon;
grant execute on function public.record_public_access_sale(uuid,text,text,text,text,numeric,uuid,text,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
