-- Apply after account-access-migration.sql and the existing booking/billing migrations.
-- No historical payments are rewritten. Existing pending receipts still need staff review.
begin;
alter table public.payments add column if not exists receipt_paid_at timestamptz;

-- If this index reports duplicates, inspect the matching historical references first.
-- Do not delete payment history to resolve duplicates.
create unique index if not exists payments_normalized_reference_unique
on public.payments ((regexp_replace(upper(reference_number), '[^A-Z0-9]', '', 'g')))
where reference_number is not null and regexp_replace(upper(reference_number), '[^A-Z0-9]', '', 'g') <> '';

create or replace function public.validate_screened_gcash_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_r public.reservations%rowtype; v_t public.transactions%rowtype;
  v_minimum numeric; v_now timestamptz := clock_timestamp();
begin
  -- Manual staff payment entries and pre-migration receipts retain their existing workflow.
  if new.receipt_paid_at is null then return new; end if;
  select * into v_r from public.reservations where reservation_id = new.reservation_id for update;
  select * into v_t from public.transactions where reservation_id = new.reservation_id for update;
  if not found then raise exception 'Reservation bill not found' using errcode = '22023'; end if;
  if v_r.status not in ('pending', 'confirmed') or exists (
    select 1 from public.payments where reservation_id = new.reservation_id and status = 'pending'
  ) then raise exception 'Reservation changed or a payment is already pending. Reload your booking' using errcode = '40001'; end if;
  if v_r.status = 'pending' and (v_r.payment_deadline_at is null or v_r.payment_deadline_at <= v_now) then
    raise exception 'Payment deadline has expired' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.payment_methods where payment_method_id = new.payment_method_id
      and is_active and (name || ' ' || type) ~* '\mg[[:space:]]*cash\M')
    or new.ocr_status is distinct from 'consistent' or new.ocr_checked_at is null
    or new.reference_number is null or new.reference_number !~ '^[0-9]{8,20}$' then
    raise exception 'A fully validated GCash receipt is required' using errcode = '22023';
  end if;
  if (new.receipt_paid_at at time zone 'Asia/Manila')::date <> (v_now at time zone 'Asia/Manila')::date
    or new.receipt_paid_at > v_now + interval '1 minute' then
    raise exception 'Receipt must show today in Philippine time and cannot be in the future' using errcode = '22023';
  end if;
  if coalesce(v_t.balance, 0) <= 0 then
    raise exception 'This reservation has no remaining balance' using errcode = '40001';
  end if;
  if new.payment_type = 'downpayment' and coalesce(v_t.paid_amount, 0) = 0 then
    v_minimum := ceil(v_t.total_amount * 100 * 0.20) / 100;
  elsif new.payment_type = 'full' then v_minimum := v_t.balance;
  else raise exception 'Only the outstanding balance can be paid after a verified payment' using errcode = '40001'; end if;
  if new.amount is null or new.amount < v_minimum then
    raise exception 'Amount sent is below the current minimum. Reload and review the bill' using errcode = '40001';
  end if;
  return new;
end $$;
drop trigger if exists validate_screened_gcash_payment on public.payments;
create trigger validate_screened_gcash_payment before insert on public.payments
for each row execute function public.validate_screened_gcash_payment();
notify pgrst, 'reload schema';
commit;
