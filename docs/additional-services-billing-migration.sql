-- Apply after maintenance-refunds-migration.sql. This keeps package pricing
-- intact when a guest adds services after making one or more payments.
begin;

alter table public.audit_logs add column if not exists details jsonb;
alter table public.receipts add column if not exists billed_to_name text;
alter table public.receipts enable row level security;
create policy "Guests read own receipts" on public.receipts for select to authenticated
  using (exists (select 1 from public.payments p join public.reservations r
    on r.reservation_id = p.reservation_id
    where p.payment_id = receipts.payment_id and r.guest_id = auth.uid()));
create policy "Staff read receipts" on public.receipts for select to authenticated
  using (exists (select 1 from public.staff_users where id = auth.uid() and is_active));
create policy "Admin and cashier create receipts" on public.receipts for insert to authenticated
  with check (exists (select 1 from public.staff_users where id = auth.uid()
    and is_active and role in ('admin', 'cashier')));
insert into public.payment_methods(name, type, is_active)
select 'Cash', 'cash', true where not exists
  (select 1 from public.payment_methods where type = 'cash');

-- Existing invoice triggers previously rewrote every invoice version for a
-- reservation. Only the current invoice should follow later service changes.
create or replace function public.update_invoice_total()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_reservation uuid; v_total numeric(10,2);
begin
  v_reservation := case when tg_op = 'DELETE' then old.reservation_id else new.reservation_id end;
  select total_amount into v_total from public.transactions where reservation_id = v_reservation;
  update public.invoices set total_amount = coalesce(v_total, 0)
    where invoice_id = (select invoice_id from public.invoices
      where reservation_id = v_reservation and status <> 'void'
      order by created_at desc, invoice_id desc limit 1);
  return null;
end $$;

create or replace function public.update_transaction_paid_amount()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_reservation uuid; v_paid numeric(10,2); v_total numeric(10,2);
begin
  v_reservation := case when tg_op = 'DELETE' then old.reservation_id else new.reservation_id end;
  select coalesce(sum(amount), 0) into v_paid from public.payments
    where reservation_id = v_reservation and status = 'verified';
  update public.transactions set paid_amount = v_paid,
    status = case when total_amount > 0 and v_paid >= total_amount then 'paid'
      when v_paid > 0 then 'partial' else 'unpaid' end
    where reservation_id = v_reservation returning total_amount into v_total;
  update public.invoices set status = case when v_total > 0 and v_paid >= v_total then 'paid'
    when v_paid > 0 then 'partially_paid' else 'issued' end
    where invoice_id = (select invoice_id from public.invoices
      where reservation_id = v_reservation and status <> 'void'
      order by created_at desc, invoice_id desc limit 1);
  return null;
end $$;

create or replace function public.update_reservation_services_bill(p_reservation uuid, p_services jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reservation public.reservations%rowtype;
  v_transaction public.transactions%rowtype;
  v_item jsonb;
  v_service uuid;
  v_quantity integer;
  v_existing public.reservation_services%rowtype;
  v_catalog public.services%rowtype;
  v_seen uuid[] := array[]::uuid[];
  v_old_services numeric(10,2);
  v_new_services numeric(10,2);
  v_new_total numeric(10,2);
  v_balance numeric(10,2);
  v_status text;
begin
  select * into v_reservation from public.reservations
    where reservation_id = p_reservation for update;
  if not found or v_reservation.guest_id is distinct from auth.uid() then
    raise exception 'Reservation not found for this guest' using errcode = '42501';
  end if;
  if v_reservation.status not in ('pending', 'confirmed') then
    raise exception 'Services can only be changed for pending or confirmed reservations' using errcode = '22023';
  end if;
  if jsonb_typeof(p_services) is distinct from 'array' then
    raise exception 'Choose a service list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_services) < 1 or jsonb_array_length(p_services) > 100 then
    raise exception 'Choose between one and 100 services' using errcode = '22023';
  end if;
  if exists (select 1 from public.payments where reservation_id = p_reservation and status = 'pending') then
    raise exception 'Wait for the pending payment review before changing services' using errcode = '22023';
  end if;
  select * into v_transaction from public.transactions where reservation_id = p_reservation for update;
  if not found then raise exception 'Reservation bill not found' using errcode = '22023'; end if;
  select coalesce(sum(quantity * price_at_time), 0) into v_old_services
    from public.reservation_services where reservation_id = p_reservation;

  -- Check the complete submitted list before changing any row. Existing
  -- quantities and prices cannot be reduced; new items use catalog prices.
  for v_item in select value from jsonb_array_elements(p_services) loop
    if jsonb_typeof(v_item) <> 'object' or
      coalesce(v_item->>'serviceId', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or
      coalesce(v_item->>'quantity', '') !~ '^[1-9][0-9]*$' then
      raise exception 'Invalid service or quantity' using errcode = '22023';
    end if;
    v_service := (v_item->>'serviceId')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity > 10000 or v_service = any(v_seen) then
      raise exception 'Duplicate service or invalid quantity' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_service);
    select * into v_existing from public.reservation_services
      where reservation_id = p_reservation and service_id = v_service;
    if found then
      if v_quantity < v_existing.quantity then
        raise exception 'Existing service quantities cannot be reduced' using errcode = '22023';
      end if;
    else
      select * into v_catalog from public.services where service_id = v_service and is_active = true;
      if not found then raise exception 'Selected service is unavailable' using errcode = '22023'; end if;
    end if;
  end loop;
  if exists (select 1 from public.reservation_services
      where reservation_id = p_reservation and not (service_id = any(v_seen))) then
    raise exception 'Existing services cannot be removed' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_services) loop
    v_service := (v_item->>'serviceId')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    select * into v_existing from public.reservation_services
      where reservation_id = p_reservation and service_id = v_service;
    if found then
      if v_quantity <> v_existing.quantity then
        update public.reservation_services set quantity = v_quantity
          where reservation_id = p_reservation and service_id = v_service;
      end if;
    else
      select * into v_catalog from public.services where service_id = v_service;
      insert into public.reservation_services(reservation_id, service_id, quantity, price_at_time)
        values(p_reservation, v_service, v_quantity, v_catalog.price);
    end if;
  end loop;

  select coalesce(sum(quantity * price_at_time), 0) into v_new_services
    from public.reservation_services where reservation_id = p_reservation;
  v_new_total := round(v_transaction.total_amount + v_new_services - v_old_services, 2);
  v_balance := greatest(v_new_total - coalesce(v_transaction.paid_amount, 0), 0);
  v_status := case when v_new_total > 0 and v_balance = 0 then 'paid'
    when coalesce(v_transaction.paid_amount, 0) > 0 then 'partial' else 'unpaid' end;

  -- The older per-service triggers may calculate package charges using unit
  -- rates. Override their intermediate result with the captured bill + delta.
  update public.transactions set total_amount = v_new_total, status = v_status
    where reservation_id = p_reservation;
  update public.invoices set total_amount = v_new_total,
    status = case when v_balance = 0 then 'paid'
      when coalesce(v_transaction.paid_amount, 0) > 0 then 'partially_paid'
      else 'issued' end
    where invoice_id = (select invoice_id from public.invoices
      where reservation_id = p_reservation and status <> 'void'
      order by created_at desc, invoice_id desc limit 1);

  if v_new_services <> v_old_services then
    insert into public.audit_logs(auth_user_id, action, entity_type, entity_id, details)
      values(auth.uid(), 'Added reservation services to bill', 'reservation', p_reservation,
        jsonb_build_object('reference_number', v_reservation.reference_number,
          'old_services_total', v_old_services, 'new_services_total', v_new_services,
          'previous_bill_total', v_transaction.total_amount, 'new_bill_total', v_new_total,
          'paid_amount', v_transaction.paid_amount, 'new_balance', v_balance,
          'services', p_services));
  end if;
  return jsonb_build_object('totalAmount', v_new_total, 'paidAmount', coalesce(v_transaction.paid_amount, 0),
    'remainingBalance', v_balance, 'status', v_status, 'addedCharge', v_new_services - v_old_services);
end $$;

-- A receipt belongs to a payment and retains the billed guest's name at
-- issuance. A newly verified payment creates a second receipt; old receipts
-- remain attached to the same reservation.
create or replace function public.create_receipt_on_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_total numeric(10,2); v_paid numeric(10,2); v_name text;
begin
  if new.status = 'verified' and old.status is distinct from 'verified' then
    select total_amount into v_total from public.transactions where reservation_id = new.reservation_id;
    select coalesce(sum(amount), 0) into v_paid from public.payments
      where reservation_id = new.reservation_id and status = 'verified';
    select nullif(trim(coalesce(g.first_name, w.first_name, '') || ' ' ||
      coalesce(g.last_name, w.last_name, '')), '') into v_name
      from public.reservations r
      left join public.guests g on g.id = r.guest_id
      left join public.walk_in_guests w on w.walk_in_guest_id = r.walk_in_guest_id
      where r.reservation_id = new.reservation_id;
    insert into public.receipts(payment_id, receipt_number, amount_paid,
      transaction_total_at_time, balance_after_payment, billed_to_name)
      values(new.payment_id, 'RCPT-' || to_char(now(), 'YYYYMMDD') || '-' || substr(new.payment_id::text, 1, 6),
        new.amount, v_total, greatest(coalesce(v_total, 0) - v_paid, 0), v_name)
      on conflict (payment_id) do nothing;
  end if;
  return new;
end $$;

update public.receipts rec set billed_to_name = nullif(trim(coalesce(g.first_name, w.first_name, '') || ' ' ||
  coalesce(g.last_name, w.last_name, '')), '')
  from public.payments p join public.reservations r on r.reservation_id = p.reservation_id
  left join public.guests g on g.id = r.guest_id
  left join public.walk_in_guests w on w.walk_in_guest_id = r.walk_in_guest_id
  where rec.payment_id = p.payment_id and rec.billed_to_name is null;

revoke all on function public.update_reservation_services_bill(uuid,jsonb) from public, anon;
grant execute on function public.update_reservation_services_bill(uuid,jsonb) to authenticated;
commit;
