-- Apply LAST, after admin-full-access, service-billing-types, package rates,
-- guest-auto-reschedule, reservation editing and refund workflow migrations.
-- Historical counts and payment/receipt records are retained.
begin;

alter table public.services drop constraint if exists services_billing_type_check;
alter table public.services add constraint services_billing_type_check check(billing_type in ('quantity','duration','person','fixed'));
alter table public.reservation_services drop constraint if exists reservation_services_billing_type_check;
alter table public.reservation_services add constraint reservation_services_billing_type_check check(billing_type in ('quantity','duration','person','fixed'));

create table if not exists public.promo_codes(
  promo_id uuid primary key default gen_random_uuid(),
  code text not null unique check(code ~ '^[A-Z0-9_-]{3,40}$'),
  discount_type text not null check(discount_type in ('percent','fixed')),
  discount_value numeric(12,2) not null check(discount_value>0 and (discount_type<>'percent' or discount_value<=100)),
  starts_at date, ends_at date, is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check(ends_at is null or starts_at is null or ends_at>=starts_at)
);
alter table public.promo_codes enable row level security;
revoke all on public.promo_codes from anon,authenticated;
grant all on public.promo_codes to service_role;

alter table public.transactions add column if not exists discount_amount numeric(12,2) not null default 0;
alter table public.transactions add column if not exists discount_kind text not null default 'none';
alter table public.transactions add column if not exists discount_eligible_guests integer not null default 0;
alter table public.transactions add column if not exists discount_package_price numeric(12,2) not null default 0;
alter table public.transactions add column if not exists discount_promo_code text;
alter table public.transactions add column if not exists discount_promo_type text;
alter table public.transactions add column if not exists discount_promo_value numeric(12,2) not null default 0;
alter table public.transactions drop constraint if exists transaction_discount_check;
alter table public.transactions add constraint transaction_discount_check check(discount_amount>=0 and discount_eligible_guests between 0 and 30
  and discount_kind in ('none','pwd_senior','promo'));

-- Existing adult/child columns remain as historical storage; the application
-- presents their sum as head count and stores new counts without an age split.
create or replace function public.booking_discount_package_price(p_reservation uuid)
returns numeric language plpgsql stable security definer set search_path='' as $$
declare r public.reservations%rowtype; rates jsonb; tier text; mode text; hours numeric; start_hour numeric;
begin
  select * into r from public.reservations where reservation_id=p_reservation;
  select p.rates into rates from public.package_rate_versions p where p.version=r.package_rate_version;
  if rates is null then raise exception 'Booked package rates are unavailable' using errcode='22023'; end if;
  tier:=case when extract(isodow from r.start_datetime at time zone 'Asia/Manila') in (5,6,7) then 'weekend' else 'weekday' end;
  mode:=coalesce(r.booking_mode,'day');
  if mode='custom' then
    hours:=extract(epoch from r.end_datetime-r.start_datetime)/3600;
    start_hour:=extract(hour from r.start_datetime at time zone 'Asia/Manila')+extract(minute from r.start_datetime at time zone 'Asia/Manila')/60;
    select m into mode from (values('day',abs(hours-8)+abs(start_hour-8)),
      ('night',abs(hours-12)+abs(start_hour-18)),('whole_day',abs(hours-22)+least(abs(start_hour-8),abs(start_hour-18)))) options(m,score)
      order by score,(rates->tier->m->>'baseRate')::numeric limit 1;
  end if;
  return (rates->tier->mode->>'baseRate')::numeric;
end $$;
revoke all on function public.booking_discount_package_price(uuid) from public,anon,authenticated;

create or replace function public.reprice_booking_discount(p_reservation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; t public.transactions%rowtype; base numeric; gross numeric; pwd numeric; promo numeric;
  amount numeric; net numeric; kind text; head integer;
begin
  select * into r from public.reservations where reservation_id=p_reservation for update;
  select * into t from public.transactions where reservation_id=p_reservation for update;
  if not found then raise exception 'Reservation bill not found' using errcode='22023'; end if;
  head:=r.adult_count+r.child_count;
  if head<1 or t.discount_eligible_guests>head then raise exception 'Eligible PWD/senior guests cannot exceed the number of guests' using errcode='22023'; end if;
  base:=public.booking_discount_package_price(p_reservation);
  gross:=t.total_amount+t.discount_amount;
  pwd:=round(base/head*0.20*t.discount_eligible_guests,2);
  promo:=case t.discount_promo_type when 'percent' then round(base*t.discount_promo_value/100,2)
    when 'fixed' then t.discount_promo_value else 0 end;
  promo:=least(base,greatest(promo,0));
  amount:=least(gross,greatest(pwd,promo));
  kind:=case when amount=0 then 'none' when promo>pwd then 'promo' else 'pwd_senior' end;
  net:=round(greatest(gross-amount,0),2);
  perform set_config('app.booking_discount',p_reservation::text,true);
  update public.transactions set total_amount=net,discount_amount=amount,discount_kind=kind,discount_package_price=base,
    status=case when paid_amount>=net then 'paid' when paid_amount>0 then 'partial' else 'unpaid' end where reservation_id=p_reservation;
  update public.invoices set total_amount=net,status=case when t.paid_amount>=net then 'paid' when t.paid_amount>0 then 'partially_paid' else 'issued' end
    where invoice_id=(select invoice_id from public.invoices where reservation_id=p_reservation and status<>'void' order by created_at desc,invoice_id desc limit 1);
  return jsonb_build_object('totalAmount',net,'paidAmount',t.paid_amount,'remainingBalance',greatest(net-t.paid_amount,0),
    'overpaidAmount',greatest(t.paid_amount-net,0),'discountAmount',amount,'discountKind',kind,'eligibleDiscount',pwd,'promoDiscount',promo,
    'eligibleGuests',t.discount_eligible_guests,'headCount',head,'packagePrice',base);
end $$;
revoke all on function public.reprice_booking_discount(uuid) from public,anon,authenticated;

create or replace function public.guard_booking_discount_write()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated') then
    if tg_op='INSERT' then
      if new.discount_amount<>0 or new.discount_eligible_guests<>0 or new.discount_promo_code is not null or new.discount_kind<>'none'
        or new.discount_promo_type is not null or new.discount_promo_value<>0 or new.discount_package_price<>0 then
        raise exception 'Use the authorized discount action' using errcode='42501'; end if;
    elsif (to_jsonb(new)->'discount_amount',to_jsonb(new)->'discount_eligible_guests',to_jsonb(new)->'discount_promo_code',to_jsonb(new)->'discount_kind',
      to_jsonb(new)->'discount_promo_type',to_jsonb(new)->'discount_promo_value',to_jsonb(new)->'discount_package_price') is distinct from
      (to_jsonb(old)->'discount_amount',to_jsonb(old)->'discount_eligible_guests',to_jsonb(old)->'discount_promo_code',to_jsonb(old)->'discount_kind',
      to_jsonb(old)->'discount_promo_type',to_jsonb(old)->'discount_promo_value',to_jsonb(old)->'discount_package_price') then
      raise exception 'Use the authorized discount action' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_booking_discount_write on public.transactions;
create trigger guard_booking_discount_write before insert or update on public.transactions for each row execute function public.guard_booking_discount_write();

create or replace function public.set_booking_discount(p_reservation uuid,p_actor uuid,p_eligible integer,p_code text,
  p_expected_total numeric,p_reason text,p_guest boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; t public.transactions%rowtype; s public.staff_users%rowtype; p public.promo_codes%rowtype; result jsonb;
begin
  select * into r from public.reservations where reservation_id=p_reservation for update;
  select * into t from public.transactions where reservation_id=p_reservation for update;
  if not found then raise exception 'Reservation bill not found' using errcode='22023'; end if;
  if p_actor is null then raise exception 'An authenticated actor is required' using errcode='42501'; end if;
  if p_guest then
    if r.guest_id is distinct from p_actor or r.status<>'pending' or t.paid_amount>0 or p_eligible<>0 or t.discount_eligible_guests<>0 then
      raise exception 'Only an unpaid booking owner can apply a new-booking promo' using errcode='42501'; end if;
  else
    select * into s from public.staff_users where id=p_actor and is_active;
    if not found or not (s.role='admin' or (s.role='staff' and exists(select 1 from public.role_permissions where role=s.role and 'edit_reservation'=any(permissions)))
      or (s.role='cashier' and exists(select 1 from public.role_permissions where role=s.role and 'transactions'=any(permissions) and 'payment_entry'=any(permissions)))) then
      raise exception 'Manager or cashier billing permission required' using errcode='42501'; end if;
  end if;
  if r.status not in ('pending','confirmed') or r.checked_out_at is not null
    or exists(select 1 from public.payments where reservation_id=p_reservation and status='pending')
    or exists(select 1 from public.refund_requests where reservation_id=p_reservation and status in ('pending','reviewed','approved','payout_submitted')) then
    raise exception 'Resolve open reviews/refunds before changing this bill' using errcode='40001'; end if;
  if p_expected_total is distinct from t.total_amount then raise exception 'Bill changed. Reload before applying a discount' using errcode='40001'; end if;
  if p_eligible is null or p_eligible<0 or p_eligible>r.adult_count+r.child_count or length(btrim(coalesce(p_reason,''))) not between 5 and 1000 then
    raise exception 'Enter a valid eligible guest count and a reason of 5-1000 characters' using errcode='22023'; end if;
  if nullif(btrim(p_code),'') is not null then
    if upper(btrim(p_code))=t.discount_promo_code then
      p.code:=t.discount_promo_code; p.discount_type:=t.discount_promo_type; p.discount_value:=t.discount_promo_value;
    else
    select * into p from public.promo_codes where code=upper(btrim(p_code)) and is_active
      and (starts_at is null or starts_at<=(now() at time zone 'Asia/Manila')::date)
      and (ends_at is null or ends_at>=(now() at time zone 'Asia/Manila')::date) for share;
    if not found then raise exception 'Promo code is unavailable or expired' using errcode='22023'; end if;
    end if;
  end if;
  update public.transactions set discount_eligible_guests=p_eligible,discount_promo_code=p.code,
    discount_promo_type=p.discount_type,discount_promo_value=coalesce(p.discount_value,0) where reservation_id=p_reservation;
  result:=public.reprice_booking_discount(p_reservation);
  if (result->>'totalAmount')::numeric=0 and r.status='pending' then
    update public.reservations set status='confirmed' where reservation_id=p_reservation;
    result:=public.reprice_booking_discount(p_reservation); -- Update a newly issued zero-total invoice too.
  end if;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(case when p_guest then null else p_actor end,p_actor,'Updated booking discount','reservation',p_reservation,
      result||jsonb_build_object('before_total',t.total_amount,'previous_discount',t.discount_amount,'promo_code',p.code,'reason',btrim(p_reason)));
  return result;
end $$;
revoke all on function public.set_booking_discount(uuid,uuid,integer,text,numeric,text,boolean) from public,anon,authenticated;
grant execute on function public.set_booking_discount(uuid,uuid,integer,text,numeric,text,boolean) to service_role;

-- Lock the same rows as billing edits and reject changed eligibility even when a
-- larger promo kept the net amount unchanged while an editor was open.
create or replace function public.assert_booking_discount_snapshot(p_reservation uuid,p_expected jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare t public.transactions%rowtype; current_snapshot jsonb; begin
  perform 1 from public.reservations where reservation_id=p_reservation for update;
  select * into t from public.transactions where reservation_id=p_reservation for update;
  current_snapshot:=jsonb_build_object('amount',t.discount_amount,'eligible',t.discount_eligible_guests,'code',t.discount_promo_code,'type',t.discount_promo_type,'value',t.discount_promo_value);
  if p_expected ? 'discount' and p_expected->'discount' is distinct from current_snapshot then
    raise exception 'Discount eligibility changed. Reload the bill before saving' using errcode='40001'; end if;
end $$;
revoke all on function public.assert_booking_discount_snapshot(uuid,jsonb) from public,anon,authenticated;

-- Wrap the existing atomic edits rather than changing their financial/history rules.
create or replace function public.edit_staff_reservation_with_discount(p_reservation uuid,p_staff uuid,p_expected jsonb,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
  perform public.assert_booking_discount_snapshot(p_reservation,p_expected);
  result:=public.edit_staff_reservation(p_reservation,p_staff,p_expected,p_patch);
  return result||public.reprice_booking_discount(p_reservation);
end $$;
create or replace function public.edit_staff_reservation_reschedule_with_discount(p_reservation uuid,p_staff uuid,p_expected jsonb,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
  perform public.assert_booking_discount_snapshot(p_reservation,p_expected);
  result:=public.edit_staff_reservation_reschedule(p_reservation,p_staff,p_expected,p_patch);
  return result||public.reprice_booking_discount(p_reservation);
end $$;
create or replace function public.edit_guest_reservation_bill_with_discount(p_reservation uuid,p_guest uuid,p_expected jsonb,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
  perform public.assert_booking_discount_snapshot(p_reservation,p_expected);
  result:=public.edit_guest_reservation_bill(p_reservation,p_guest,p_expected,p_patch);
  return result||public.reprice_booking_discount(p_reservation);
end $$;
create or replace function public.reschedule_guest_reservation_with_discount(p_reservation uuid,p_guest uuid,p_expected jsonb,
  p_new_start timestamptz,p_new_end timestamptz,p_notice_fee numeric,p_rate_adjustment numeric,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; old_total numeric; final jsonb; begin
  perform public.assert_booking_discount_snapshot(p_reservation,p_expected);
  select total_amount into old_total from public.transactions where reservation_id=p_reservation;
  result:=public.reschedule_guest_reservation(p_reservation,p_guest,p_expected,p_new_start,p_new_end,p_notice_fee,p_rate_adjustment,p_reason);
  final:=public.reprice_booking_discount(p_reservation);
  return result||final||jsonb_build_object('totalAdditional',(final->>'totalAmount')::numeric-old_total);
end $$;
do $$ declare f regprocedure; begin
  foreach f in array array['public.edit_staff_reservation_with_discount(uuid,uuid,jsonb,jsonb)'::regprocedure,
    'public.edit_staff_reservation_reschedule_with_discount(uuid,uuid,jsonb,jsonb)'::regprocedure,
    'public.edit_guest_reservation_bill_with_discount(uuid,uuid,jsonb,jsonb)'::regprocedure,
    'public.reschedule_guest_reservation_with_discount(uuid,uuid,jsonb,timestamptz,timestamptz,numeric,numeric,text)'::regprocedure] loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;

-- Refund destination requests/replies use a separate audited workflow.
alter table public.refund_requests add column if not exists destination_requested_at timestamptz;
alter table public.refund_requests add column if not exists destination_method text;
alter table public.refund_requests add column if not exists destination_account_name text;
alter table public.refund_requests add column if not exists destination_account_number text;
alter table public.refund_requests add column if not exists destination_submitted_at timestamptz;

create or replace function public.request_refund_destination(p_refund uuid,p_staff uuid)
returns void language plpgsql security definer set search_path='' as $$
declare f public.refund_requests%rowtype; begin
  if not exists(select 1 from public.staff_users s where id=p_staff and is_active and (role='admin' or exists(
    select 1 from public.role_permissions rp where rp.role=s.role and rp.permissions && array['refund_approval','refund_payout']))) then
    raise exception 'Refund processing permission required' using errcode='42501'; end if;
  select * into f from public.refund_requests where refund_id=p_refund for update;
  if not found or f.status not in ('pending','reviewed','approved') then raise exception 'This refund cannot request destination details' using errcode='40001'; end if;
  if f.guest_id is null then raise exception 'This is a walk-in booking. Contact the guest directly to confirm payout details' using errcode='22023'; end if;
  if f.destination_submitted_at is not null or exists(select 1 from public.payments p where p.reservation_id=f.reservation_id
    and p.status='verified' and nullif(btrim(p.account_name),'') is not null and nullif(btrim(p.account_number),'') is not null and p.payment_method_id is not null) then
    raise exception 'Payment destination details are already available. Review them before requesting more' using errcode='40001'; end if;
  if f.destination_requested_at>now()-interval '5 minutes' then raise exception 'A request was recently sent. Give the guest time to reply' using errcode='40001'; end if;
  update public.refund_requests set destination_requested_at=now() where refund_id=p_refund;
  insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
    values('guest',f.guest_id,p_staff,'Refund payment details needed','Open Manage Booking > Refunds and provide your preferred payment method, account name and number.','/manage?tab=refunds','refund_request',p_refund);
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff,p_staff,'Requested refund destination','refund_request',p_refund,'{}');
end $$;
revoke all on function public.request_refund_destination(uuid,uuid) from public,anon,authenticated;
grant execute on function public.request_refund_destination(uuid,uuid) to service_role;

create or replace function public.submit_refund_destination(p_refund uuid,p_method text,p_name text,p_number text)
returns void language plpgsql security definer set search_path='' as $$
declare f public.refund_requests%rowtype; begin
  select * into f from public.refund_requests where refund_id=p_refund for update;
  if not found or f.guest_id is distinct from auth.uid() or auth.uid() is null then raise exception 'Refund ownership required' using errcode='42501'; end if;
  if f.destination_requested_at is null or f.status not in ('pending','reviewed','approved') then raise exception 'This refund is not accepting payment details' using errcode='40001'; end if;
  if length(btrim(coalesce(p_name,''))) not between 2 and 120 or length(btrim(coalesce(p_number,''))) not between 3 and 120
    or not exists(select 1 from public.payment_methods where is_active and name=p_method and lower(name)<>'cash' and lower(type)<>'cash') then
    raise exception 'Choose an active payout method and provide an account name and number' using errcode='22023'; end if;
  if lower(p_method) like '%gcash%' and btrim(p_number) !~ '^(09[0-9]{9}|[+]639[0-9]{9})$' then
    raise exception 'Enter a valid GCash mobile number (09 or +639)' using errcode='22023'; end if;
  update public.refund_requests set destination_method=p_method,destination_account_name=btrim(p_name),destination_account_number=btrim(p_number),destination_submitted_at=now() where refund_id=p_refund;
  perform public.notify_refund_workflow(f.guest_id,'Refund payment details provided','The guest supplied a refund destination. Authorized staff must review it before transfer.','refund_request',p_refund);
  insert into public.audit_logs(auth_user_id,action,entity_type,entity_id,details)
    values(auth.uid(),'Provided refund destination','refund_request',p_refund,jsonb_build_object('method',p_method));
end $$;
revoke all on function public.submit_refund_destination(uuid,text,text,text) from public,anon;
grant execute on function public.submit_refund_destination(uuid,text,text,text) to authenticated;

create or replace function public.guard_refund_destination()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and new.status='payout_submitted' and old.status<>'payout_submitted' then
    if old.destination_requested_at is not null and old.destination_submitted_at is null then
      raise exception 'Wait for the guest to provide requested refund account details' using errcode='40001'; end if;
    if old.destination_submitted_at is not null and new.payout_method is distinct from old.destination_method then
      raise exception 'Use the payout method supplied by the guest' using errcode='22023'; end if;
  end if;
  if tg_op='INSERT' and current_user in ('anon','authenticated') and (new.destination_requested_at is not null or new.destination_method is not null
    or new.destination_account_name is not null or new.destination_account_number is not null or new.destination_submitted_at is not null) then
    raise exception 'Use the refund destination action' using errcode='42501'; end if;
  if tg_op='UPDATE' and current_user in ('anon','authenticated') and (to_jsonb(new)->'destination_requested_at',to_jsonb(new)->'destination_method',
    to_jsonb(new)->'destination_account_name',to_jsonb(new)->'destination_account_number',to_jsonb(new)->'destination_submitted_at') is distinct from
    (to_jsonb(old)->'destination_requested_at',to_jsonb(old)->'destination_method',to_jsonb(old)->'destination_account_name',
    to_jsonb(old)->'destination_account_number',to_jsonb(old)->'destination_submitted_at') then
    raise exception 'Use the refund destination action' using errcode='42501'; end if;
  return new;
end $$;
drop trigger if exists guard_refund_destination on public.refund_requests;
create trigger guard_refund_destination before insert or update on public.refund_requests for each row execute function public.guard_refund_destination();

notify pgrst,'reload schema';
commit;
