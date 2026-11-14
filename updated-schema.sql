-- After this base schema, apply docs/reservation-lifecycle-migration.sql,
-- docs/first-come-booking-migration.sql, then
-- docs/maintenance-refunds-migration.sql, then
-- docs/additional-services-billing-migration.sql for maintenance dates,
-- refunds, added service charges, and named payment receipts.
-- =========================
-- STAFF USERS
-- =========================
create table public.staff_users (
  id uuid primary key references auth.users(id) on delete cascade,

  full_name text not null,
  email text not null,

  role text check (role in ('admin', 'staff', 'cashier')) not null default 'staff',
  is_active boolean default true,
  must_change_password boolean not null default false,
  active_session_id uuid,
  last_login_at timestamptz,
  last_logout_at timestamptz,

  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.staff_users enable row level security;

create policy "Staff can view own profile"
on public.staff_users for select
using (auth.uid() = id);

create policy "Staff can update own profile"
on public.staff_users for update
using (auth.uid() = id);

create unique index staff_users_email_unique_idx on public.staff_users(lower(email));
create index staff_users_email_idx on public.staff_users(email);
create index staff_users_active_session_idx on public.staff_users(active_session_id);
create index staff_users_last_login_idx on public.staff_users(last_login_at desc);


-- =========================
-- AUDIT LOGS
-- =========================
create table public.audit_logs (
  log_id uuid primary key default gen_random_uuid(),
  user_id uuid references public.staff_users(id) on delete set null,

  action text not null,
  entity_type text,
  entity_id uuid,

  attempted_email text,
  auth_user_id uuid,
  device_id uuid,

  created_at timestamptz default now() not null
);

alter table public.audit_logs enable row level security;
create policy "Staff can read audit logs" on public.audit_logs for select to authenticated
using (exists (select 1 from public.staff_users where id = auth.uid() and is_active));
create policy "Staff can record own audit logs" on public.audit_logs for insert to authenticated
with check (user_id = auth.uid());

-- Failed sign-ins are counted per email across the guest and staff portals.
create table public.login_lock_state (
  email text primary key,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.login_lock_state enable row level security;

create or replace function public.check_login_lock(p_email text)
returns timestamptz
language sql security definer set search_path = public
as $$
  select locked_until from public.login_lock_state where email = lower(trim(p_email));
$$;

create or replace function public.record_login_attempt(
  p_email text, p_device_id uuid, p_kind text, p_result text, p_user_id uuid default null
)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_locked_until timestamptz;
begin
  if p_kind not in ('guest', 'staff') or p_result not in ('success', 'failed', 'blocked', 'device_conflict', 'denied', 'logout') then
    raise exception 'Invalid login audit event';
  end if;

  if p_result = 'failed' then
    insert into public.login_lock_state(email, failed_attempts, updated_at)
    values (v_email, 0, now()) on conflict (email) do nothing;

    update public.login_lock_state
    set failed_attempts = case when locked_until is not null and locked_until <= now() then 1 else failed_attempts + 1 end,
        locked_until = case
          when (case when locked_until is not null and locked_until <= now() then 1 else failed_attempts + 1 end) >= 5
          then now() + interval '1 minute' else null end,
        updated_at = now()
    where email = v_email
    returning locked_until into v_locked_until;
  elsif p_result = 'success' then
    delete from public.login_lock_state where email = v_email;
  end if;

  insert into public.audit_logs(action, entity_type, attempted_email, auth_user_id, device_id)
  values (
    case when p_result = 'logout' then 'Logout'
         when p_result = 'failed' and v_locked_until is not null then 'Login locked'
         else 'Login ' || replace(p_result, '_', ' ') end,
    p_kind || '_session', v_email, p_user_id, p_device_id
  );
  return v_locked_until;
end;
$$;

revoke all on function public.check_login_lock(text) from public, anon, authenticated;
revoke all on function public.record_login_attempt(text, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.check_login_lock(text) to service_role;
grant execute on function public.record_login_attempt(text, uuid, text, text, uuid) to service_role;

create or replace function public.log_service_change()
returns trigger as $$
declare
  actor_id uuid;
  res_id uuid;
begin
  actor_id := auth.uid();
  res_id := coalesce(new.reservation_id, old.reservation_id);

  insert into public.audit_logs (
    user_id,
    action,
    entity_type,
    entity_id
  )
  values (
    case
      when actor_id is not null and exists (
        select 1
        from public.staff_users
        where id = actor_id
      ) then actor_id
      else null
    end,
    TG_OP || '_SERVICE',
    'reservation',
    res_id
  );

  return null;
end;
$$ language plpgsql security definer set search_path = public;

do $$
begin
  if to_regclass('public.reservation_services') is not null then
    create trigger trigger_log_service_changes
    after insert or update or delete
    on public.reservation_services
    for each row
    execute procedure public.log_service_change();
  end if;
end
$$;


-- =========================
-- GUESTS
-- =========================
create table public.guests (
  id uuid primary key references auth.users(id) on delete cascade,
  active_session_id uuid,

  first_name text not null,
  last_name text not null,
  middle_name text,

  email text not null,
  phone_number text not null,
  address text not null,

  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index guests_active_session_idx on public.guests(active_session_id);

alter table public.guests enable row level security;

create policy "Users can view own profile"
on public.guests for select
using (auth.uid() = id);

create policy "Staff can view guest profiles"
on public.guests for select
to authenticated
using (
  exists (
    select 1
    from public.staff_users
    where staff_users.id = auth.uid()
      and staff_users.is_active = true
  )
);

create policy "Users can insert own profile"
on public.guests for insert
with check (auth.uid() = id);

create policy "Users can update own profile"
on public.guests for update
using (auth.uid() = id);

create index guests_email_idx on public.guests(email);


-- =========================
-- COMMON UPDATED_AT TRIGGER
-- =========================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;


-- =========================
-- WALK-IN GUESTS
-- =========================
create table public.walk_in_guests (
  walk_in_guest_id uuid primary key default gen_random_uuid(),

  first_name text not null,
  last_name text not null,
  middle_name text,

  email text not null,
  phone_number text not null,
  address text not null,

  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.walk_in_guests enable row level security;

create policy "Staff can view walk-in profiles"
on public.walk_in_guests for select
to authenticated
using (
  exists (
    select 1
    from public.staff_users
    where staff_users.id = auth.uid()
      and staff_users.is_active = true
  )
);

create policy "Staff can insert walk-in profiles"
on public.walk_in_guests for insert
to authenticated
with check (
  exists (
    select 1
    from public.staff_users
    where staff_users.id = auth.uid()
      and staff_users.is_active = true
  )
);

create policy "Staff can update walk-in profiles"
on public.walk_in_guests for update
to authenticated
using (
  exists (
    select 1
    from public.staff_users
    where staff_users.id = auth.uid()
      and staff_users.is_active = true
  )
);

create index walk_in_guests_email_idx on public.walk_in_guests(email);

create trigger on_walk_in_guests_updated
before update on public.walk_in_guests
for each row execute procedure public.handle_updated_at();


-- =========================
-- AUTO CREATE GUEST
-- =========================
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.guests (id, email, first_name, last_name, middle_name, phone_number, address)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', 'Unknown'),
    coalesce(new.raw_user_meta_data->>'last_name', 'Unknown'),
    new.raw_user_meta_data->>'middle_name',
    coalesce(new.raw_user_meta_data->>'phone_number', 'Unknown'),
    coalesce(new.raw_user_meta_data->>'address', 'Unknown')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();


-- =========================
-- RESERVATIONS
-- =========================
create table public.reservations (
  reservation_id uuid primary key default gen_random_uuid(),
 
  guest_id uuid references public.guests(id) on delete cascade,
  walk_in_guest_id uuid references public.walk_in_guests(walk_in_guest_id) on delete set null,

  reference_number text unique not null,

  -- 🔥 NEW TIME-BASED SYSTEM
  start_datetime timestamptz not null,
  end_datetime timestamptz not null,

  -- Optional UI label
  booking_mode text check (
    booking_mode in ('day', 'night', 'whole_day', 'custom')
  ) default 'day',

  -- Guest counts
  adult_count int not null default 1,
  child_count int not null default 0,

  -- Cancellation
  cancelled_at timestamptz,
  cancellation_reason text,

  status text check (
    status in ('pending', 'payment_submitted', 'confirmed', 'expired', 'rejected', 'cancelled', 'completed', 'reschedule_requested')
  ) default 'pending',
  payment_deadline_at timestamptz,

  booking_type text check (
    booking_type in ('online', 'walk_in')
  ) default 'online',

  special_requests text,

  adult_rate_at_booking numeric(10,2),
  child_rate_at_booking numeric(10,2),
  
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,

  -- Constraints
  check (end_datetime > start_datetime),
  check (guest_id is not null or walk_in_guest_id is not null),
  check (adult_count >= 1),
  check (child_count >= 0),
  check (adult_count + child_count > 0)
);

-- One active reservation can hold a Manila calendar date across the resort.
create extension if not exists btree_gist;

alter table public.reservations
add constraint one_active_reservation_per_date
exclude using gist (
  (daterange(
    (start_datetime at time zone 'Asia/Manila')::date,
    (end_datetime at time zone 'Asia/Manila')::date +
      case when (end_datetime at time zone 'Asia/Manila')::time = time '00:00:00' then 0 else 1 end,
    '[)'
  )) with &&
)
where (status in ('pending', 'payment_submitted', 'confirmed', 'reschedule_requested'));

-- Reservation rescheduling table for audit/history of reschedule requests.

create table public.reservation_reschedules (
  reschedule_id uuid primary key default gen_random_uuid(),

  reservation_id uuid not null
    references public.reservations(reservation_id) on delete cascade,

  requested_by uuid
    references public.guests(id) on delete set null,

  -- OLD values (for audit/history)
  old_start timestamptz not null,
  old_end timestamptz not null,

  new_start timestamptz not null,
  new_end timestamptz not null,

  -- Approval workflow
  status text check (
    status in ('pending', 'approved', 'rejected')
  ) default 'pending',

  reschedule_fee numeric(10,2) not null default 0,
  rate_adjustment numeric(10,2) not null default 0,

  approved_by uuid
    references public.staff_users(id) on delete set null,

  approved_at timestamptz,

  rejection_reason text,

  created_at timestamptz default now() not null
);

-- BUSINESS SETTINGS -- 

create table public.business_settings (
    setting_key text primary key,
    setting_value jsonb not null,
    description text,
    updated_at timestamptz default now()
);

alter table public.business_settings enable row level security;

create policy "Admins can read business settings"
on public.business_settings for select
to authenticated
using (
  exists (
    select 1 from public.staff_users
    where staff_users.id = auth.uid()
      and staff_users.role = 'admin'
      and staff_users.is_active = true
  )
);

create policy "Admins can manage business settings"
on public.business_settings for all
to authenticated
using (
  exists (
    select 1 from public.staff_users
    where staff_users.id = auth.uid()
      and staff_users.role = 'admin'
      and staff_users.is_active = true
  )
)
with check (
  exists (
    select 1 from public.staff_users
    where staff_users.id = auth.uid()
      and staff_users.role = 'admin'
      and staff_users.is_active = true
  )
);

create index business_settings_updated_at_idx on public.business_settings(updated_at desc);


-- guest_rates table to store rates for adults and children, with effective dates and active status.

create table public.guest_rates (
    rate_id uuid primary key default gen_random_uuid(),
    adult_rate numeric(10,2) not null,
    child_rate numeric(10,2) not null,
    effective_from date not null,
    effective_to date,
    is_active boolean default true,
    created_at timestamptz default now()
);


create or replace function public.set_guest_rates_at_booking()
returns trigger as $$
begin

    if new.adult_rate_at_booking is null
       or new.child_rate_at_booking is null then

        select
            adult_rate,
            child_rate
        into
            new.adult_rate_at_booking,
            new.child_rate_at_booking
        from public.guest_rates
        where is_active = true
        order by effective_from desc
        limit 1;

    end if;

    return new;
end;
$$ language plpgsql;

create trigger trigger_set_guest_rates_at_booking
before insert on public.reservations
for each row
execute procedure public.set_guest_rates_at_booking();


create index reservations_dates_idx
on public.reservations (start_datetime, end_datetime);

create trigger on_reservations_updated
before update on public.reservations
for each row execute procedure public.handle_updated_at();


-- =========================
-- UNITS
-- =========================
create table public.units (
  unit_id uuid primary key default gen_random_uuid(),

  unit_img text,
  name text not null,
  description text,
  capacity int not null,
  base_price numeric(10,2) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  is_active boolean default true,
  archived_at timestamptz
);

create trigger on_units_updated
before update on public.units
for each row execute procedure public.handle_updated_at();

-- UNIT RATES table to store rates for each unit, with effective dates and active status.--

create table unit_rates (
    unit_rate_id uuid primary key default gen_random_uuid(),

    unit_id uuid not null
        references units(unit_id)
        on delete cascade,

    price numeric(10,2) not null,

    effective_from date not null,
    effective_to date,

    is_active boolean default true,

    created_at timestamptz default now()
);


-- =========================
-- RESERVATION UNITS
-- =========================
create table public.reservation_units (
  reservation_unit_id uuid primary key default gen_random_uuid(),

  reservation_id uuid not null
    references public.reservations(reservation_id) on delete cascade,

  unit_id uuid not null
    references public.units(unit_id) on delete cascade,

  quantity int default 1,
  price_per_night numeric(10,2) not null,

  created_at timestamptz default now() not null,

  unique (reservation_id, unit_id)
);

create index reservation_units_reservation_idx
on public.reservation_units(reservation_id);


-- =========================
-- SERVICES
-- =========================
create table public.services (
  service_id uuid primary key default gen_random_uuid(),

  name text not null,
  description text,
  price numeric(10,2) not null,

  is_active boolean default true,

  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create trigger on_services_updated
before update on public.services
for each row execute procedure public.handle_updated_at();


-- =========================
-- RESERVATION SERVICES
-- =========================
create table public.reservation_services (
  reservation_service_id uuid primary key default gen_random_uuid(),

  reservation_id uuid not null
    references public.reservations(reservation_id) on delete cascade,

  service_id uuid not null
    references public.services(service_id) on delete cascade,

  quantity int default 1,
  price_at_time numeric(10,2) not null,

  created_at timestamptz default now() not null,

  unique (reservation_id, service_id)
);

create index reservation_services_reservation_idx
on public.reservation_services(reservation_id);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trigger_log_service_changes'
      and tgrelid = 'public.reservation_services'::regclass
  ) then
    create trigger trigger_log_service_changes
    after insert or update or delete
    on public.reservation_services
    for each row
    execute procedure public.log_service_change();
  end if;
end
$$;


-- =========================
-- TRANSACTIONS
-- =========================
create table public.transactions (
  transaction_id uuid primary key default gen_random_uuid(),

  reservation_id uuid unique not null
    references public.reservations(reservation_id) on delete cascade,

  total_amount numeric(10,2) not null default 0,
  paid_amount numeric(10,2) default 0,

  -- Remaining amount to be paid (never negative)
  balance numeric(10,2)
    generated always as (
      greatest(total_amount - paid_amount, 0)
    ) stored,

  -- Extra amount paid beyond total
  overpaid_amount numeric(10,2)
    generated always as (
      greatest(paid_amount - total_amount, 0)
    ) stored,

  status text check (status in ('unpaid', 'partial', 'paid'))
    default 'unpaid',

  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create trigger on_transactions_updated
before update on public.transactions
for each row execute procedure public.handle_updated_at();


-- =========================
-- AUTO CREATE TRANSACTION
-- =========================
create or replace function public.create_transaction_on_reservation()
returns trigger as $$
begin
  insert into public.transactions (reservation_id)
  values (new.reservation_id);
  return new;
end;
$$ language plpgsql;

create trigger trigger_create_transaction
after insert on public.reservations
for each row execute procedure public.create_transaction_on_reservation();


-- =========================
-- PAYMENTS
-- =========================
create table public.payments (
  payment_id uuid primary key default gen_random_uuid(),

  reservation_id uuid not null
    references public.reservations(reservation_id) on delete cascade,
 
  amount numeric(10,2) not null,

  payment_method_id uuid,
  payment_type text check (payment_type in ('downpayment', 'full', 'additional')) not null,

  status text check (status in ('pending', 'verified', 'rejected')) default 'pending',

  paid_at timestamptz default now(),
  receipt_paid_at timestamptz,

  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  reference_number text unique not null,
  account_name text not null,
  account_number text,
  verified_by uuid references public.staff_users(id) on delete set null,
  verified_at timestamptz,
  rejected_by uuid references public.staff_users(id) on delete set null,
  rejected_at timestamptz,
  proof_path text not null,
  ocr_status text not null default 'not_applicable'
    check (ocr_status in ('not_applicable', 'consistent', 'mismatch', 'unreadable')),
  ocr_notes text,
  ocr_checked_at timestamptz,
  check (amount > 0)
);

alter table public.payments enable row level security;
create policy "Guests can read own payments" on public.payments for select to authenticated
using (exists (select 1 from public.reservations where reservation_id = payments.reservation_id and guest_id = auth.uid()));
create policy "Staff can read payments" on public.payments for select to authenticated
using (exists (select 1 from public.staff_users where id = auth.uid() and is_active = true));
create policy "Staff can add pending payments" on public.payments for insert to authenticated
with check (status = 'pending' and exists (select 1 from public.staff_users where id = auth.uid() and is_active = true));
create policy "Staff can verify payments" on public.payments for update to authenticated
using (exists (select 1 from public.staff_users where id = auth.uid() and is_active = true))
with check (exists (select 1 from public.staff_users where id = auth.uid() and is_active = true));
revoke update on public.payments from authenticated;
grant update (status) on public.payments to authenticated;

-- trigger to update transaction totals when reservation units or services are added, updated, or deleted --

create or replace function public.handle_payment_verification()
returns trigger as $$
begin

    if new.status = 'verified'
       and old.status <> 'verified' then

        new.verified_at := now();

        if auth.uid() is not null then
            new.verified_by := auth.uid();
        end if;

    end if;

    return new;

end;
$$ language plpgsql;

create trigger trigger_handle_payment_verification
before update on public.payments
for each row
execute procedure public.handle_payment_verification();


-- payment_methods table to store available payment methods, with active status. --

create table public.payment_methods (
    payment_method_id uuid primary key default gen_random_uuid(),

    name text not null,
    type text not null,

    is_active boolean default true,

    created_at timestamptz default now()
);

-- payment_accounts table to store payment accounts linked to payment methods, with active status. --

create table public.payment_accounts (
    account_id uuid primary key default gen_random_uuid(),

    payment_method_id uuid
        references public.payment_methods(payment_method_id),

    account_name text not null,

    account_number text,

    qr_image text,

    instructions text,

    is_active boolean default true,

    created_at timestamptz default now()
);

alter table public.payments
add constraint payments_payment_method_id_fkey
foreign key (payment_method_id)
references public.payment_methods(payment_method_id)
on delete set null;

-- reservation_policies table to store reservation policies, with active status. --

create table public.reservation_policies (
    policy_id uuid primary key default gen_random_uuid(),

    title text not null,

    content text not null,

    display_order int default 0,

    is_active boolean default true,

    updated_at timestamptz default now()
);

-- ocular_time_slots table to store available time slots for ocular visits, with active status. --

create table public.ocular_time_slots (
    slot_id uuid primary key default gen_random_uuid(),

    start_time time not null,
    end_time time not null,

    max_capacity int default 1,

    is_active boolean default true
);


-- =====================p====
-- RECEIPTS
-- =========================

create table public.receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  
  payment_id uuid unique not null
    references public.payments(payment_id) on delete cascade,
  receipt_number text unique not null,
  issued_at timestamptz default now() not null,
  email_sent boolean default false,
  email_sent_at timestamptz,
  email_error text,
  amount_paid numeric,
  transaction_total_at_time numeric,
  balance_after_payment numeric,
  is_active boolean default true,
  archived_at timestamptz 

);

-- Trigger to auto-create receipt when payment is verified

create or replace function public.create_receipt_on_payment()
returns trigger as $$
declare
    txn_total numeric;
    txn_paid numeric;
begin

    if new.status = 'verified' then

        select
            total_amount,
            paid_amount
        into
            txn_total,
            txn_paid
        from public.transactions
        where reservation_id = new.reservation_id;

        insert into public.receipts (
            payment_id,
            receipt_number,
            amount_paid,
            transaction_total_at_time,
            balance_after_payment
        )
        values (
            new.payment_id,
            'RCPT-' ||
            to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') ||
            '-' ||
            substr(new.payment_id::text, 1, 6),
            new.amount,
            txn_total,
            greatest(
                txn_total - coalesce(txn_paid, 0),
                0
            )
        )
        on conflict (payment_id) do nothing;

    end if;

    return new;
end;
$$ language plpgsql;


-- prevent multiple active guest rates at the same time (only one can be active) -- 

create unique index guest_rates_one_active_idx
on public.guest_rates (is_active)
where is_active = true;

-- trigger to deactivate other guest rates when a new rate is activated --

create or replace function public.handle_guest_rate_activation()
returns trigger as $$
begin

    if new.is_active = true then

        update public.guest_rates
        set is_active = false
        where rate_id <> new.rate_id;

    end if;

    return new;

end;
$$ language plpgsql;

create trigger trigger_guest_rate_activation
before insert or update
on public.guest_rates
for each row
execute procedure public.handle_guest_rate_activation();

create trigger trigger_create_receipt
after update on public.payments
for each row
when (new.status = 'verified' and old.status <> 'verified')
execute procedure public.create_receipt_on_payment();

create index payments_reservation_idx
on public.payments(reservation_id);

create trigger on_payments_updated
before update on public.payments
for each row execute procedure public.handle_updated_at();

create table public.reservation_status_logs (

    status_log_id uuid
    primary key default gen_random_uuid(),

    reservation_id uuid not null
    references public.reservations(reservation_id)
    on delete cascade,

    old_status text,

    new_status text not null,

    changed_by uuid
    references public.staff_users(id)
    on delete set null,

    created_at timestamptz
    default now()
);

create or replace function public.log_reservation_status_change()
returns trigger as $$
begin

    if old.status is distinct from new.status then

        insert into public.reservation_status_logs (
            reservation_id,
            old_status,
            new_status,
            changed_by
        )
        values (
            new.reservation_id,
            old.status,
            new.status,
            auth.uid()
        );

    end if;

    return new;
end;
$$ language plpgsql;

create trigger trigger_log_reservation_status
after update on public.reservations
for each row
execute procedure public.log_reservation_status_change();

-- =========================
-- UPDATE TRANSACTION ON PAYMENT
-- =========================
create or replace function public.update_transaction_paid_amount()
returns trigger as $$
declare
  res_id uuid;
  total_paid numeric;
begin
  -- safely get reservation id (handles INSERT, UPDATE, DELETE)
  res_id := coalesce(new.reservation_id, old.reservation_id);

  -- calculate total paid
  select coalesce(sum(amount), 0)
  into total_paid
  from public.payments
  where reservation_id = res_id
    and status = 'verified';

  -- update transaction
  update public.transactions
  set 
    paid_amount = total_paid,
    status = case
      when (total_amount - total_paid) <= 0 then 'paid'
      when total_paid > 0 then 'partial'
      else 'unpaid'
    end
  where reservation_id = res_id;

  return null;
end;
$$ language plpgsql;

create or replace trigger trigger_update_transaction
after insert or update or delete on public.payments
for each row
execute procedure public.update_transaction_paid_amount();


-- =========================
-- INVOICES
-- =========================

create table public.invoices (
  invoice_id uuid primary key default gen_random_uuid(),

  reservation_id uuid unique not null
    references public.reservations(reservation_id) on delete cascade,

  total_amount numeric(10,2) not null default 0,

  status text check (
    status in ('draft', 'issued', 'partially_paid', 'paid', 'void')
  ) default 'draft',
  email_sent boolean default false,
  email_sent_at timestamptz,
  email_error text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Trigger to update invoice total when reservation units or services change

create trigger on_invoices_updated
before update on public.invoices
for each row execute procedure public.handle_updated_at();

-- Trigger to update invoice total when reservation units or services change

create or replace function public.create_invoice_on_confirmation()
returns trigger as $$
begin
  if new.status = 'confirmed' then
    insert into public.invoices (
      reservation_id,
      total_amount,
      status
    )
    values (
      new.reservation_id,
      (
        select coalesce(total_amount, 0)
        from public.transactions 
        where reservation_id = new.reservation_id
      ),
      'issued'
    )
    on conflict (reservation_id) do nothing;
  end if;

  return new;
end;
$$ language plpgsql;

-- Trigger to update invoice total when reservation units or services change

create or replace function public.update_invoice_total()
returns trigger as $$
declare
  res_id uuid;
  new_total numeric;
begin
  res_id := coalesce(new.reservation_id, old.reservation_id);

  -- get updated total from transaction
  select total_amount into new_total
  from public.transactions
  where reservation_id = res_id;

  -- update invoice
  update public.invoices
  set 
    total_amount = coalesce(new_total, 0)
  where reservation_id = res_id;

  return null;
end;
$$ language plpgsql;

create trigger trigger_create_invoice
after update on public.reservations
for each row
when (new.status = 'confirmed' and old.status <> 'confirmed')
execute procedure public.create_invoice_on_confirmation();

create or replace function public.update_invoice_total()
returns trigger as $$
declare
  res_id uuid;
  new_total numeric;
begin
  res_id := coalesce(new.reservation_id, old.reservation_id);

  -- get updated total from transaction
  select total_amount into new_total
  from public.transactions
  where reservation_id = res_id;

  -- update invoice
  update public.invoices
  set 
    total_amount = coalesce(new_total, 0)
  where reservation_id = res_id;

  return null;
end;
$$ language plpgsql;

create trigger trigger_create_invoice
after update on public.reservations
for each row
when (new.status = 'confirmed' and old.status <> 'confirmed')
execute procedure public.create_invoice_on_confirmation();

create or replace function public.update_transaction_total()
returns trigger as $$
declare
    res_id uuid;

    v_total_units numeric := 0;
    v_total_services numeric := 0;
    v_total_guests numeric := 0;
    v_reschedule_charges numeric := 0;

    v_subtotal numeric := 0;
    v_total_due numeric := 0;

    v_nights int := 1;

    v_adult_rate numeric := 0;
    v_child_rate numeric := 0;

    v_adult_count int := 0;
    v_child_count int := 0;
begin

    res_id := coalesce(
        new.reservation_id,
        old.reservation_id
    );

    -- Get stay duration
    select
        greatest(
            1,
            ceil(
                extract(
                    epoch from (
                        r.end_datetime - r.start_datetime
                    )
                ) / 86400.0
            )
        )::int
    into v_nights
    from public.reservations r
    where r.reservation_id = res_id;

    -- Get guest counts and snapshot rates
    select
        coalesce(r.adult_rate_at_booking, 0),
        coalesce(r.child_rate_at_booking, 0),
        coalesce(r.adult_count, 0),
        coalesce(r.child_count, 0)
    into
        v_adult_rate,
        v_child_rate,
        v_adult_count,
        v_child_count
    from public.reservations r
    where r.reservation_id = res_id;

    -- Unit charges
    select
        coalesce(
            sum(
                ru.quantity *
                ru.price_per_night *
                v_nights
            ),
            0
        )
    into v_total_units
    from public.reservation_units ru
    where ru.reservation_id = res_id;

    -- Service charges
    select
        coalesce(
            sum(
                rs.quantity *
                rs.price_at_time
            ),
            0
        )
    into v_total_services
    from public.reservation_services rs
    where rs.reservation_id = res_id;

    -- Guest entrance fees
    v_total_guests :=
        (v_adult_count * v_adult_rate * v_nights)
        +
        (v_child_count * v_child_rate * v_nights);

    v_subtotal :=
        v_total_units
        + v_total_services
        + v_total_guests;

    select coalesce(sum(reschedule_fee + rate_adjustment), 0)
    into v_reschedule_charges
    from public.reservation_reschedules
    where reservation_id = res_id and status = 'approved';

    v_total_due :=
        round(v_subtotal::numeric, 2) + v_reschedule_charges;

    update public.transactions t
    set
        total_amount = v_total_due,
        status =
            case
                when t.paid_amount >= v_total_due
                     and v_total_due > 0
                then 'paid'

                when t.paid_amount > 0
                then 'partial'

                else 'unpaid'
            end
    where t.reservation_id = res_id;

    return null;
end;
$$ language plpgsql;

create trigger trigger_update_transaction_on_reservation
after update of
  adult_count,
  child_count,
  start_datetime,
  end_datetime,
  adult_rate_at_booking,
  child_rate_at_booking
on public.reservations
for each row
execute procedure public.update_transaction_total();

-- Also update invoice total when reservation units change, since that affects total amount.

create trigger trigger_update_invoice_on_service
after insert or update or delete
on public.reservation_services
for each row
execute procedure public.update_invoice_total();

--  Also update invoice total when reservation units change, since that affects total amount.

create trigger trigger_update_invoice_on_unit
after insert or update or delete
on public.reservation_units
for each row
execute procedure public.update_invoice_total();

-- Keep transaction totals synced when reservation charges change.

create trigger trigger_update_transaction_on_service
after insert or update or delete
on public.reservation_services
for each row
execute procedure public.update_transaction_total();

-- Also update transaction total when reservation units change, since that affects total amount.

create trigger trigger_update_transaction_on_unit
after insert or update or delete
on public.reservation_units
for each row
execute procedure public.update_transaction_total();


-- =========================
-- OCULAR VISITS
-- =========================
create table public.ocular_visits (
  visit_id uuid primary key default gen_random_uuid(),

  guest_id uuid not null
    references public.guests(id) on delete cascade,

  scheduled_date date not null,
  reference_number text unique not null,

  time_slot_id uuid
    references public.ocular_time_slots(slot_id) on delete set null,

  status text check (status in ('pending', 'confirmed', 'cancelled'))
    default 'pending',
  
  created_at timestamptz default now() not null
);

-- =========================
-- INDEXES
-- =========================
create index reservations_guest_id_idx on public.reservations(guest_id);
create index reservations_walk_in_guest_id_idx on public.reservations(walk_in_guest_id);
create index payments_status_idx on public.payments(status);
create index transactions_status_idx on public.transactions(status);
create index ocular_visits_guest_idx on public.ocular_visits(guest_id);


-- =========================
-- STORAGE POLICIES (PAYMENT PROOFS)
-- =========================
-- Private guest proof bucket. Files are stored under {auth.uid()}/{filename}.
-- Files are stored under: {auth.uid()}/{filename}

-- Create this private bucket before using the admin QR upload module.
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-qr-codes', 'payment-qr-codes', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "Users can upload own payment proofs"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can view own payment proofs"
on storage.objects for select
to authenticated
using (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Active staff can view payment proofs"
on storage.objects for select
to authenticated
using (
  bucket_id = 'payment-proofs'
  and exists (select 1 from public.staff_users where id = auth.uid() and is_active = true)
);


-- ============= NOTIFICATIONS =======================

create table public.notifications (
  notification_id uuid primary key default gen_random_uuid(),

  recipient_role text check (recipient_role in ('guest', 'staff', 'cashier', 'admin')) not null,
  recipient_id uuid not null,
  actor_id uuid,

  title text not null,
  message text,
  action_url text,
  entity_type text,
  entity_id uuid,

  is_read boolean default false,
  created_at timestamptz default now() not null
);

alter table public.notifications enable row level security;

create index notifications_recipient_idx on public.notifications(recipient_role, recipient_id);
create index notifications_read_idx on public.notifications(is_read);
create index notifications_created_idx on public.notifications(created_at);

create policy "Recipients can view own notifications"
on public.notifications for select to authenticated
using (
  recipient_id = auth.uid()
  and (
    recipient_role = 'guest'
    or exists (
      select 1 from public.staff_users
      where id = auth.uid() and is_active = true and role = recipient_role
    )
  )
);

create policy "Recipients can mark own notifications read"
on public.notifications for update to authenticated
using (
  recipient_id = auth.uid()
  and (
    recipient_role = 'guest'
    or exists (
      select 1 from public.staff_users
      where id = auth.uid() and is_active = true and role = recipient_role
    )
  )
)
with check (
  recipient_id = auth.uid()
  and (
    recipient_role = 'guest'
    or exists (
      select 1 from public.staff_users
      where id = auth.uid() and is_active = true and role = recipient_role
    )
  )
);

revoke update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;


-- ============= REVIEWS =======================

create table public.reviews (
  review_id uuid primary key default gen_random_uuid(),

  -- REQUIRED: must be a real guest
  guest_id uuid not null
    references public.guests(id)
    on delete cascade,

  -- OPTIONAL: link to a reservation (if you want later)
  reservation_id uuid
    references public.reservations(reservation_id)
    on delete set null,

  -- Ratings
  overall_rating int check (overall_rating between 1 and 5) not null,
  cleanliness_rating int check (cleanliness_rating between 1 and 5),
  service_rating int check (service_rating between 1 and 5),
  amenities_rating int check (amenities_rating between 1 and 5),
  value_rating int check (value_rating between 1 and 5),

  -- Content
  title text not null,
  review_text text not null,

  -- Public-safe display name shown in public review feeds
  public_display_name text not null,

  would_recommend boolean default true,

  -- Moderation (set to true for now, can be used later if you want to implement review approval)
  is_approved boolean default true,

  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ENFORCE ONE REVIEW PER GUEST (can be relaxed if you want to allow multiple reviews for multiple stays)

create unique index one_review_per_guest
on public.reviews(guest_id);

-- ALLOW MULTIPLE REVIEWS PER GUEST IF THEY HAVE MULTIPLE RESERVATIONS, BUT ONLY ONE REVIEW PER RESERVATION

create unique index one_review_per_reservation
on public.reviews(reservation_id)
where reservation_id is not null;

alter table public.reviews enable row level security;

-- Public can read approved reviews
create policy "Public read approved reviews"
on public.reviews for select
using (is_approved = true);

-- Only logged-in users can insert THEIR review
create policy "Authenticated users can create reviews"
on public.reviews for insert
to authenticated
with check (auth.uid() = guest_id);

-- Users can update/delete their own reviews
create policy "Users manage own reviews"
on public.reviews
for update using (auth.uid() = guest_id);

create policy "Users delete own reviews"
on public.reviews
for delete using (auth.uid() = guest_id);

-- Staff moderation
create policy "Staff manage reviews"
on public.reviews
for all
to authenticated
using (
  exists (
    select 1
    from public.staff_users
    where id = auth.uid()
  )
);

create or replace function public.get_sales_report(
  report_period text
)
returns table (
  label text,
  revenue numeric,
  bookings bigint
)
language sql
as $$
  select
    case
      when report_period = 'daily'
        then to_char(created_at at time zone 'Asia/Manila', 'Dy')
      when report_period = 'weekly'
        then 'Week ' || extract(week from created_at at time zone 'Asia/Manila')
      else to_char(created_at at time zone 'Asia/Manila', 'Mon')
    end as label,

    sum(total_amount) as revenue,
    count(*) as bookings

  from public.transactions
  group by label
  order by min(created_at);
$$;

-- latest

-- create table public.ocular_visits (
--   visit_id uuid not null default gen_random_uuid (),
--   guest_id uuid not null,
--   scheduled_date date not null,
--   reference_number text not null,
--   time_slot text not null,
--   status text null default 'pending'::text,
--   created_at timestamp with time zone not null default timezone ('utc'::text, now()),
--   cancelled_at timestamp with time zone null,
--   cancellation_reason text null,
--   constraint ocular_visits_pkey primary key (visit_id),
--   constraint ocular_visits_reference_number_key unique (reference_number),
--   constraint ocular_visits_guest_id_fkey foreign KEY (guest_id) references guests (id) on delete CASCADE,
--   constraint ocular_visits_status_check check (
--     (
--       status = any (
--         array[
--           'pending'::text,
--           'confirmed'::text,
--           'cancelled'::text
--         ]
--       )
--     )
--   ),
--   constraint ocular_visits_time_slot_check check (
--     (
--       time_slot = any (
--         array[
--           '08:00-09:00'::text,
--           '09:00-10:00'::text,
--           '10:00-11:00'::text,
--           '13:00-14:00'::text,
--           '14:00-15:00'::text
--         ]
--       )
--     )
--   )
-- ) TABLESPACE pg_default;

alter table public.ocular_visits
add column cancelled_at timestamptz,
add column cancellation_reason text;

create index ocular_visits_date_idx
on public.ocular_visits(scheduled_date);

create index ocular_visits_slot_idx
on public.ocular_visits(time_slot_id);

create index ocular_visits_status_idx
on public.ocular_visits(status);

alter table public.ocular_time_slots
add constraint ocular_time_slots_time_check
check (end_time > start_time);

-- Atomic reschedule approval and additional charge calculation
begin;

-- Apply before deploying the reschedule approval API.
alter table public.reservation_reschedules
  add column if not exists rate_adjustment numeric(10,2) not null default 0;

create or replace function public.approve_reschedule_request(
  p_reschedule_id uuid,
  p_staff_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.reservation_reschedules%rowtype;
  v_reservation public.reservations%rowtype;
  v_total numeric(10,2);
  v_paid numeric(10,2);
  v_new_total numeric(10,2);
  v_charge numeric(10,2);
  v_status text;
begin
  if not exists (select 1 from public.staff_users where id = p_staff_id and is_active = true) then
    raise exception 'Active staff account required';
  end if;

  select * into v_request from public.reservation_reschedules
  where reschedule_id = p_reschedule_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Reschedule request is no longer pending';
  end if;
  if v_request.new_start < now() + interval '30 minutes' then
    raise exception 'Requested start time is too soon';
  end if;

  select * into v_reservation from public.reservations
  where reservation_id = v_request.reservation_id for update;
  if not found or v_reservation.status <> 'reschedule_requested'
     or v_reservation.start_datetime <> v_request.old_start
     or v_reservation.end_datetime <> v_request.old_end then
    raise exception 'Reservation is no longer awaiting this reschedule';
  end if;

  v_charge := v_request.reschedule_fee + v_request.rate_adjustment;

  -- The reservation trigger recalculates the base transaction total.
  -- The exclusion constraint rejects a date taken since the guest requested it.
  update public.reservations set
    start_datetime = v_request.new_start,
    end_datetime = v_request.new_end,
    status = 'confirmed'
  where reservation_id = v_request.reservation_id;

  select total_amount, paid_amount into v_total, v_paid
  from public.transactions where reservation_id = v_request.reservation_id for update;
  if not found then raise exception 'Reservation transaction is missing'; end if;
  v_new_total := v_total + v_charge;
  v_status := case when coalesce(v_paid, 0) >= v_new_total then 'paid'
                   when coalesce(v_paid, 0) > 0 then 'partial' else 'unpaid' end;
  update public.transactions set total_amount = v_new_total, status = v_status
  where reservation_id = v_request.reservation_id;
  update public.invoices set total_amount = v_new_total
  where reservation_id = v_request.reservation_id;

  update public.reservation_reschedules set
    status = 'approved', approved_by = p_staff_id,
    approved_at = now(), rejection_reason = null
  where reschedule_id = p_reschedule_id;

  return jsonb_build_object(
    'reservationId', v_request.reservation_id,
    'totalAmount', v_new_total,
    'paidAmount', coalesce(v_paid, 0),
    'additionalCharge', v_charge
  );
end;
$$;

revoke all on function public.approve_reschedule_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_reschedule_request(uuid, uuid) to service_role;
commit;

-- Guest website media; writes are restricted to the admin upload API's service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-content', 'site-content', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Staff reservation editing. Apply role-permissions and billing migrations before use.
begin;
alter table public.audit_logs add column if not exists details jsonb;
create or replace function public.edit_staff_reservation(
  p_reservation uuid, p_staff uuid, p_expected jsonb, p_patch jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_r public.reservations%rowtype;
  v_t public.transactions%rowtype;
  v_old_services jsonb;
  v_old_units jsonb;
  v_item jsonb;
  v_existing public.reservation_services%rowtype;
  v_catalog public.services%rowtype;
  v_unit public.units%rowtype;
  v_unit_id uuid;
  v_old_unit_id uuid;
  v_seen uuid[] := array[]::uuid[];
  v_service uuid;
  v_quantity integer;
  v_details_changed boolean;
  v_unit_changed boolean;
  v_start timestamptz;
  v_end timestamptz;
  v_old_services_total numeric;
  v_new_services_total numeric;
  v_total numeric(10,2);
  v_paid numeric(10,2);
  v_status text;
begin
  -- Only the server can execute this function or supply a package price delta.
  -- Recheck the actor's grant inside the same database transaction.
  if not exists (select 1 from public.staff_users s where s.id = p_staff and s.is_active
    and (s.role = 'admin' or exists (select 1 from public.role_permissions rp
      where rp.role = s.role and 'edit_reservation' = any(rp.permissions)))) then
    raise exception 'You do not have permission to edit reservations' using errcode = '42501';
  end if;
  select * into v_r from public.reservations where reservation_id = p_reservation for update;
  if not found then raise exception 'Reservation not found' using errcode = '22023'; end if;
  select * into v_t from public.transactions where reservation_id = p_reservation for update;
  if not found then raise exception 'Reservation bill not found' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('serviceId', service_id, 'quantity', quantity, 'price', price_at_time)
    order by service_id), '[]'::jsonb), coalesce(sum(quantity * price_at_time), 0)
    into v_old_services, v_old_services_total from public.reservation_services where reservation_id = p_reservation;
  select coalesce(jsonb_agg(jsonb_build_object('unitId', unit_id, 'quantity', quantity, 'price', price_per_night)
    order by unit_id), '[]'::jsonb) into v_old_units from public.reservation_units where reservation_id = p_reservation;
  if v_r.updated_at is distinct from (p_expected->>'updatedAt')::timestamptz
    or v_t.total_amount is distinct from (p_expected->>'totalAmount')::numeric
    or coalesce(v_t.paid_amount, 0) is distinct from (p_expected->>'paidAmount')::numeric
    or v_old_services is distinct from p_expected->'services'
    or v_old_units is distinct from p_expected->'units' then
    raise exception 'This reservation or bill changed. Reload it before saving' using errcode = '40001';
  end if;
  if v_r.status not in ('pending', 'confirmed') or v_r.end_datetime <= now()
    or (v_r.status = 'pending' and v_r.payment_deadline_at <= now()) then
    raise exception 'This reservation is no longer editable' using errcode = '40001';
  end if;
  if exists (select 1 from public.payments where reservation_id = p_reservation and status = 'pending')
    or exists (select 1 from public.reservation_reschedules where reservation_id = p_reservation and status = 'pending') then
    raise exception 'Resolve pending payments or reschedule requests before editing' using errcode = '40001';
  end if;
  if length(trim(coalesce(p_patch->>'reason', ''))) = 0 or length(p_patch->>'reason') > 1000
    or jsonb_typeof(p_patch->'services') is distinct from 'array' or jsonb_array_length(p_patch->'services') > 100 then
    raise exception 'Provide a reason and valid service list' using errcode = '22023';
  end if;
  v_start := (p_patch->>'startDatetime')::timestamptz;
  v_end := (p_patch->>'endDatetime')::timestamptz;
  if v_start is null or v_end is null or v_end <= v_start or
    (p_patch->>'adultCount')::integer < 1 or (p_patch->>'childCount')::integer < 0 or
    (p_patch->>'adultCount')::integer + (p_patch->>'childCount')::integer > 30 then
    raise exception 'Invalid schedule or guest counts' using errcode = '22023';
  end if;
  v_details_changed := v_r.start_datetime <> v_start or v_r.end_datetime <> v_end
    or v_r.booking_mode is distinct from p_patch->>'bookingMode'
    or v_r.adult_count <> (p_patch->>'adultCount')::integer or v_r.child_count <> (p_patch->>'childCount')::integer;
  v_unit_id := (p_patch->>'unitId')::uuid;
  if jsonb_array_length(v_old_units) = 1 and (v_old_units->0->>'quantity')::integer = 1 then
    v_old_unit_id := (v_old_units->0->>'unitId')::uuid;
  end if;
  v_unit_changed := v_old_unit_id is distinct from v_unit_id;
  if (v_details_changed or v_unit_changed) and (v_r.start_datetime <= now() or v_start <= now()) then
    raise exception 'The stay has started. You can add services and update notes' using errcode = '40001';
  end if;
  if not v_details_changed and coalesce((p_patch->>'packageDelta')::numeric, 0) <> 0 then
    raise exception 'Invalid package adjustment' using errcode = '22023';
  end if;
  if v_unit_changed then
    if jsonb_array_length(v_old_units) > 1 or exists (select 1 from public.reservation_units
      where reservation_id = p_reservation and quantity <> 1) then
      raise exception 'Multiple accommodations require individual billing review' using errcode = '22023';
    end if;
    select * into v_unit from public.units where unit_id = v_unit_id and is_active and archived_at is null for share;
    if not found then raise exception 'Selected accommodation is unavailable' using errcode = '22023'; end if;
  end if;
  -- Validate and lock catalog prices before modifying any booking rows.
  for v_item in select value from jsonb_array_elements(p_patch->'services') loop
    v_service := (v_item->>'serviceId')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_service is null or v_quantity is null or v_quantity < 1 or v_quantity > 10000 or v_service = any(v_seen) then
      raise exception 'Invalid service or quantity' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_service);
    select * into v_existing from public.reservation_services where reservation_id = p_reservation and service_id = v_service;
    if found then
      if v_r.start_datetime <= now() and v_quantity < v_existing.quantity then
        raise exception 'Services cannot be reduced during a stay' using errcode = '22023';
      end if;
      if v_existing.price_at_time is distinct from (v_item->>'price')::numeric then
        raise exception 'Service price changed. Reload the reservation' using errcode = '40001';
      end if;
    else
      select * into v_catalog from public.services where service_id = v_service and is_active for share;
      if not found then raise exception 'Selected service is unavailable' using errcode = '22023'; end if;
      if v_catalog.price is distinct from (v_item->>'price')::numeric then
        raise exception 'Service price changed. Reload the reservation' using errcode = '40001';
      end if;
    end if;
  end loop;
  if v_r.start_datetime <= now() and exists (select 1 from public.reservation_services
    where reservation_id = p_reservation and not (service_id = any(v_seen))) then
    raise exception 'Services cannot be removed during a stay' using errcode = '22023';
  end if;
  -- Date constraints and the existing maintenance trigger remain authoritative.
  -- Updating a note alone does not run schedule or package recalculation triggers.
  if v_details_changed then
    update public.reservations set start_datetime = v_start, end_datetime = v_end,
      booking_mode = p_patch->>'bookingMode', adult_count = (p_patch->>'adultCount')::integer,
      child_count = (p_patch->>'childCount')::integer, special_requests = nullif(p_patch->>'specialRequests', ''), updated_at = now()
      where reservation_id = p_reservation;
  else
    update public.reservations set special_requests = nullif(p_patch->>'specialRequests', ''), updated_at = now()
      where reservation_id = p_reservation;
  end if;
  if v_unit_changed then
    delete from public.reservation_units where reservation_id = p_reservation;
    insert into public.reservation_units(reservation_id, unit_id, quantity, price_per_night)
      values(p_reservation, v_unit_id, 1, v_unit.base_price);
  end if;
  delete from public.reservation_services where reservation_id = p_reservation and not (service_id = any(v_seen));
  for v_item in select value from jsonb_array_elements(p_patch->'services') loop
    insert into public.reservation_services(reservation_id, service_id, quantity, price_at_time)
      values(p_reservation, (v_item->>'serviceId')::uuid, (v_item->>'quantity')::integer, (v_item->>'price')::numeric)
      on conflict(reservation_id, service_id) do update set quantity = excluded.quantity
      where public.reservation_services.quantity <> excluded.quantity;
  end loop;
  select coalesce(sum(quantity * price_at_time), 0) into v_new_services_total
    from public.reservation_services where reservation_id = p_reservation;
  -- Override intermediate legacy trigger totals with the captured bill + deltas.
  v_total := round(v_t.total_amount + (p_patch->>'packageDelta')::numeric + v_new_services_total - v_old_services_total, 2);
  if v_total < 0 or v_total is distinct from (p_patch->>'expectedTotal')::numeric then
    raise exception 'Bill changed. Reload to review the updated amount' using errcode = '40001';
  end if;
  v_paid := coalesce(v_t.paid_amount, 0);
  v_status := case when v_paid >= v_total then 'paid' when v_paid > 0 then 'partial' else 'unpaid' end;
  update public.transactions set total_amount = v_total, status = v_status where reservation_id = p_reservation;
  update public.invoices set total_amount = v_total,
    status = case when v_paid >= v_total then 'paid' when v_paid > 0 then 'partially_paid' else 'issued' end
    where invoice_id = (select invoice_id from public.invoices where reservation_id = p_reservation and status <> 'void'
      order by created_at desc, invoice_id desc limit 1);
  insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id, details)
    values(p_staff, p_staff, 'Edited reservation and bill', 'reservation', p_reservation,
      jsonb_build_object('reference_number', v_r.reference_number, 'reason', p_patch->>'reason',
        'before', to_jsonb(v_r), 'before_bill', to_jsonb(v_t), 'before_services', v_old_services, 'before_units', v_old_units,
        'after', p_patch - 'version', 'new_total', v_total, 'paid_amount', v_paid,
        'balance', greatest(v_total - v_paid, 0), 'overpaid_amount', greatest(v_paid - v_total, 0)));
  return jsonb_build_object('totalAmount', v_total, 'paidAmount', v_paid, 'remainingBalance', greatest(v_total - v_paid, 0),
    'overpaidAmount', greatest(v_paid - v_total, 0), 'status', v_status);
end $$;
revoke all on function public.edit_staff_reservation(uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.edit_staff_reservation(uuid,uuid,jsonb,jsonb) to service_role;
commit;

-- Editable swimming package rates
-- Run after the existing reservation and audit tables are installed.
-- Prices are versioned; booking times remain fixed in the booking policy.
begin;
alter table public.audit_logs add column if not exists details jsonb;

create or replace function public.valid_package_rates(p_rates jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_tier text; v_mode text; v_rate jsonb; v_base numeric; v_extra numeric;
begin
  if jsonb_typeof(p_rates) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p_rates)) <> 2 then return false; end if;
  foreach v_tier in array array['weekday', 'weekend'] loop
    if jsonb_typeof(p_rates->v_tier) is distinct from 'object' then return false; end if;
    if (select count(*) from jsonb_object_keys(p_rates->v_tier)) <> 3 then return false; end if;
    foreach v_mode in array array['day', 'night', 'whole_day'] loop
      v_rate := p_rates->v_tier->v_mode;
      if jsonb_typeof(v_rate) is distinct from 'object' then return false; end if;
      if (select count(*) from jsonb_object_keys(v_rate)) <> 2
        or jsonb_typeof(v_rate->'baseRate') is distinct from 'number'
        or jsonb_typeof(v_rate->'addOnPerHead') is distinct from 'number' then return false; end if;
      v_base := (v_rate->>'baseRate')::numeric;
      v_extra := (v_rate->>'addOnPerHead')::numeric;
      if v_base <= 0 or v_extra < 0 or v_base > 999999 or v_extra > 999999
        or v_base <> round(v_base, 2) or v_extra <> round(v_extra, 2) then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

create table if not exists public.package_rate_versions (
  version bigint generated always as identity primary key,
  rates jsonb not null check (public.valid_package_rates(rates)),
  created_by uuid references public.staff_users(id),
  created_at timestamptz not null default now()
);
alter table public.package_rate_versions enable row level security;
revoke all on public.package_rate_versions from anon, authenticated;
grant select on public.package_rate_versions to authenticated;
grant all on public.package_rate_versions to service_role;
drop policy if exists "Admins read package rate history" on public.package_rate_versions;
create policy "Admins read package rate history" on public.package_rate_versions for select to authenticated
  using (exists (select 1 from public.staff_users where id = auth.uid() and is_active and role = 'admin'));

-- Initial values from RESORT_CONTEXT.md. All later prices come from the admin editor.
insert into public.package_rate_versions(rates)
select '{"weekday":{"day":{"baseRate":7500,"addOnPerHead":125},"night":{"baseRate":9500,"addOnPerHead":175},"whole_day":{"baseRate":14500,"addOnPerHead":225}},"weekend":{"day":{"baseRate":8000,"addOnPerHead":150},"night":{"baseRate":10000,"addOnPerHead":200},"whole_day":{"baseRate":15000,"addOnPerHead":250}}}'::jsonb
where not exists (select 1 from public.package_rate_versions);

create or replace function public.get_package_rates(p_version bigint default null)
returns table(version bigint, rates jsonb) language sql stable security definer set search_path = '' as $$
  select p.version, p.rates from public.package_rate_versions p
  where p_version is null or p.version = p_version order by p.version desc limit 1;
$$;
revoke all on function public.get_package_rates(bigint) from public;
grant execute on function public.get_package_rates(bigint) to anon, authenticated, service_role;

create or replace function public.publish_package_rates(p_rates jsonb, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_previous public.package_rate_versions%rowtype; v_version bigint;
begin
  if not exists (select 1 from public.staff_users where id = v_actor and is_active and role = 'admin') then
    raise exception 'Only an active administrator may change package rates' using errcode = '42501';
  end if;
  if not public.valid_package_rates(p_rates) then
    raise exception 'Enter all six valid package prices and extra-person charges' using errcode = '22023';
  end if;
  lock table public.package_rate_versions in share row exclusive mode;
  select * into v_previous from public.package_rate_versions order by version desc limit 1;
  if p_expected_version is distinct from v_previous.version then
    raise exception 'Package rates changed. Reload before saving' using errcode = '40001';
  end if;
  if p_rates = v_previous.rates then return v_previous.version; end if;
  insert into public.package_rate_versions(rates, created_by) values(p_rates, v_actor) returning version into v_version;
  insert into public.audit_logs(user_id, auth_user_id, action, entity_type, details)
    values(v_actor, v_actor, 'Updated swimming package rates', 'package_rates',
      jsonb_build_object('previous_version', v_previous.version, 'version', v_version, 'before', v_previous.rates, 'after', p_rates));
  return v_version;
end $$;
revoke all on function public.publish_package_rates(jsonb,bigint) from public, anon;
grant execute on function public.publish_package_rates(jsonb,bigint) to authenticated;

alter table public.reservations add column if not exists package_rate_version bigint references public.package_rate_versions(version);
-- Existing reservations used the old seeded prices. Attach that immutable version
-- without changing any transaction, payment, receipt or invoice amounts.
update public.reservations set package_rate_version = (select min(version) from public.package_rate_versions)
where package_rate_version is null;

create or replace function public.set_reservation_package_rate_version()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_version bigint;
begin
  if tg_op = 'UPDATE' then
    if new.package_rate_version is distinct from old.package_rate_version then
      raise exception 'Booked package rates cannot be replaced' using errcode = '22023';
    end if;
    return new;
  end if;
  -- Serialize inserts with publishing so a quote never silently uses a new rate.
  lock table public.package_rate_versions in share mode;
  select version into v_version from public.package_rate_versions order by version desc limit 1;
  if v_version is null then raise exception 'Package rates are not configured' using errcode = '22023'; end if;
  if new.package_rate_version is not null and new.package_rate_version <> v_version then
    raise exception 'Package rates changed. Refresh and review the total again' using errcode = '40001';
  end if;
  new.package_rate_version := v_version;
  return new;
end $$;
drop trigger if exists reservation_package_rate_version on public.reservations;
create trigger reservation_package_rate_version before insert or update of package_rate_version on public.reservations
for each row execute function public.set_reservation_package_rate_version();
commit;

-- Guest review photo attachments
-- Run after the reviews and staff_users tables exist.
begin;
alter table public.reviews add column if not exists image_path text;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.reviews'::regclass and conname = 'reviews_owned_image_path') then
    alter table public.reviews add constraint reviews_owned_image_path check (
      image_path is null or image_path ~ ('^' || guest_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')
    );
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-images', 'review-images', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Uploads/deletes go through the authenticated guest API, using the server-only
-- service role after validating the guest, file signature and review details.
-- Public reads are allowed only for photos linked to an approved review.
drop policy if exists "Read visible review photos" on storage.objects;
create policy "Read visible review photos" on storage.objects for select to anon, authenticated using (
  bucket_id = 'review-images'
  and exists (select 1 from public.reviews r where r.image_path = storage.objects.name and r.is_approved = true)
);
drop policy if exists "Guests and staff read review photos" on storage.objects;
create policy "Guests and staff read review photos" on storage.objects for select to authenticated using (
  bucket_id = 'review-images' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.staff_users s where s.id = auth.uid() and s.is_active = true)
  )
);
notify pgrst, 'reload schema';
commit;

-- GCash receipt validation and excess-refund workflow:
-- After installing the account-access, maintenance-refunds, booking-policy-versions,
-- role-permissions and reservation-edit prerequisites, apply
-- docs/gcash-payment-validation-migration.sql then docs/overpayment-refunds-migration.sql.
-- These install the normalized reference indexes, receipt insert guard, guest refund
-- RPCs and net-payment ledger triggers. See docs/PAYMENT_FLOW.md for deployment order.
-- Then apply docs/cancellation-refund-workflow-migration.sql for cancellation
-- deductions, automatic requests, independent payout verification and alerts.


-- Guest account access controls (also available as a standalone migration).
-- Run after the account-access, reservation and refund migrations, before deploying the app.
begin;
alter table public.guests add column if not exists is_active boolean not null default true;
alter table public.audit_logs add column if not exists details jsonb;

create or replace function public.require_guest_account_admin()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if not exists (select 1 from public.staff_users s where s.id = v_actor and s.is_active
    and s.role = 'admin' and s.active_session_id is not null
    and s.active_session_id::text = auth.jwt()->>'session_id') then
    raise exception 'Only an active administrator may manage guest accounts' using errcode = '42501';
  end if;
  return v_actor;
end $$;
revoke all on function public.require_guest_account_admin() from public, anon;
grant execute on function public.require_guest_account_admin() to authenticated;

-- The legacy own-staff-profile update policy must not allow self-promotion or session forgery.
-- Staff administration already uses trusted server writes; ordinary profile fields stay editable.
create or replace function public.guard_staff_access_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and (new.role is distinct from old.role or new.is_active is distinct from old.is_active
    or new.active_session_id is distinct from old.active_session_id) then
    perform public.require_guest_account_admin();
  end if;
  return new;
end $$;
drop trigger if exists guard_staff_access_fields on public.staff_users;
create trigger guard_staff_access_fields before update on public.staff_users
  for each row execute function public.guard_staff_access_fields();

create or replace function public.admin_guest_accounts(p_search text default '', p_status text default 'all', p_page integer default 0, p_page_size integer default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_guest_account_admin();
  if p_status is null or p_status not in ('all','active','inactive') or p_page is null or p_page < 0
    or p_page > 1000000 or p_page_size is null or p_page_size < 1 or p_page_size > 50
    or p_search is null or length(p_search) > 200 then
    raise exception 'Invalid guest account filters' using errcode = '22023';
  end if;
  return (with filtered as (
    select g.id, g.first_name, g.middle_name, g.last_name, g.email, g.phone_number, g.is_active, g.created_at,
      (u.email_confirmed_at is not null) as email_confirmed
    from public.guests g join auth.users u on u.id = g.id
    where not exists (select 1 from public.staff_users s where s.id = g.id)
      and (p_status = 'all' or g.is_active = (p_status = 'active'))
      and (btrim(p_search) = '' or position(lower(btrim(p_search)) in
        lower(concat_ws(' ',g.first_name,g.middle_name,g.last_name,g.email,g.phone_number))) > 0)
  ), page_rows as (select * from filtered order by created_at desc, id limit p_page_size offset p_page * p_page_size)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id) from page_rows p),'[]'::jsonb),
    'total',(select count(*) from filtered)));
end $$;
revoke all on function public.admin_guest_accounts(text,text,integer,integer) from public, anon;
grant execute on function public.admin_guest_accounts(text,text,integer,integer) to authenticated;

create or replace function public.set_guest_account_status(p_guest uuid, p_is_active boolean, p_expected_active boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.require_guest_account_admin(); v_guest public.guests%rowtype;
begin
  if p_is_active is null or p_expected_active is null or coalesce(length(p_reason),0) > 1000 then
    raise exception 'Invalid guest account status' using errcode = '22023';
  end if;
  if exists (select 1 from public.staff_users where id = p_guest) then
    raise exception 'Manage staff access through Staff Accounts' using errcode = '22023';
  end if;
  select * into v_guest from public.guests where id = p_guest for update;
  if not found then raise exception 'Guest account not found' using errcode = 'P0002'; end if;
  if v_guest.is_active = p_is_active then return jsonb_build_object('id',p_guest,'is_active',p_is_active); end if;
  if v_guest.is_active is distinct from p_expected_active then
    raise exception 'Guest account status changed. Refresh before trying again' using errcode = '40001';
  end if;
  update public.guests set is_active = p_is_active, active_session_id = null, updated_at = now() where id = p_guest;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(v_actor,v_actor,case when p_is_active then 'Guest reactivated' else 'Guest deactivated' end,'guest_account',p_guest,
      jsonb_build_object('before',jsonb_build_object('is_active',v_guest.is_active),'after',jsonb_build_object('is_active',p_is_active),
        'reason',nullif(btrim(p_reason),''),'sessions_cleared',true));
  return jsonb_build_object('id',p_guest,'is_active',p_is_active);
end $$;
revoke all on function public.set_guest_account_status(uuid,boolean,boolean,text) from public, anon;
grant execute on function public.set_guest_account_status(uuid,boolean,boolean,text) to authenticated;

-- Guests may edit their profile, but cannot change their own account status.
create or replace function public.guard_guest_account_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and ((tg_op = 'INSERT' and (not new.is_active or new.active_session_id is not null))
    or (tg_op = 'UPDATE' and (new.is_active is distinct from old.is_active or new.active_session_id is distinct from old.active_session_id))) then
    perform public.require_guest_account_admin();
  end if;
  return new;
end $$;
drop trigger if exists guard_guest_account_status on public.guests;
create trigger guard_guest_account_status before insert or update on public.guests
  for each row execute function public.guard_guest_account_status();

-- Block inactive guests writing directly through Supabase or a guest RPC, even with an old JWT.
-- Service jobs and staff operations keep their existing permissions and booking workflows.
create or replace function public.guard_inactive_guest_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.guests where id = auth.uid() and not is_active)
    and not exists (select 1 from public.staff_users where id = auth.uid() and is_active) then
    raise exception 'Your guest account has been deactivated. Please contact the resort' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
do $$ declare v_table text; begin
  foreach v_table in array array['guests','reservations','reservation_reschedules','reservation_services','reservation_units',
    'payments','refund_requests','ocular_visits','reviews'] loop
    if to_regclass('public.' || v_table) is not null then
      execute format('drop trigger if exists guard_inactive_guest_write on public.%I',v_table);
      execute format('create trigger guard_inactive_guest_write before insert or update or delete on public.%I for each row execute function public.guard_inactive_guest_write()',v_table);
    end if;
  end loop;
end $$;
commit;


-- Staff cash settlement (reapply the standalone migration after prerequisite billing migrations).
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

-- Seasonal rescheduling policy and documented staff exceptions.
-- Apply after reservation-edit, reschedule-approval-charges, role-permissions,
-- package-rates and cancellation-refund-workflow migrations.
-- No historical charges, payments, receipts or approved requests are rewritten.
begin;

create or replace function public.reschedule_policy_snapshot(p_original timestamptz,p_now timestamptz default clock_timestamp())
returns jsonb language sql stable security definer set search_path='' as $$
  with dates as (
    select (p_original at time zone 'Asia/Manila')::date original_date,
      (p_now at time zone 'Asia/Manila')::date today
  ), policy as (
    select *, case when extract(month from original_date) in (3,4,5,9,10,11,12) then 14 else 7 end minimum_days,
      original_date-today days_notice from dates
  )
  select jsonb_build_object('minimumNoticeDays',minimum_days,'daysNotice',days_notice,
    'deadline',original_date-minimum_days,'allowed',days_notice>=minimum_days,
    'noticeFee',case when days_notice>=6 then 50 when days_notice>=3 then 100 when days_notice>=1 then 300 else 500 end,
    'peak',minimum_days=14) from policy;
$$;
revoke all on function public.reschedule_policy_snapshot(timestamptz,timestamptz) from public,anon,authenticated;

create table if not exists public.reservation_reschedule_adjustments(
  adjustment_id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(reservation_id),
  old_start timestamptz not null,old_end timestamptz not null,new_start timestamptz not null,new_end timestamptz not null,
  notice_fee numeric(10,2) not null check(notice_fee>=0), rate_adjustment numeric(10,2) not null check(rate_adjustment>=0),
  policy_snapshot jsonb not null, late_exception boolean not null, reason text not null,
  staff_id uuid not null references public.staff_users(id),created_at timestamptz not null default now()
);
alter table public.reservation_reschedule_adjustments enable row level security;
revoke all on public.reservation_reschedule_adjustments from anon,authenticated;
grant select on public.reservation_reschedule_adjustments to authenticated;
grant all on public.reservation_reschedule_adjustments to service_role;
drop policy if exists "Staff read reschedule adjustments" on public.reservation_reschedule_adjustments;
create policy "Staff read reschedule adjustments" on public.reservation_reschedule_adjustments for select to authenticated
 using(exists(select 1 from public.staff_users where id=auth.uid() and is_active));

create or replace function public.guard_guest_reschedule_policy()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_r public.reservations%rowtype; v_policy jsonb;
begin
  if new.status is distinct from 'pending' then return new; end if;
  select * into v_r from public.reservations where reservation_id=new.reservation_id for update;
  if not found or v_r.status<>'confirmed' or new.requested_by is distinct from v_r.guest_id or v_r.guest_id is null then
    raise exception 'Only the confirmed reservation owner may request rescheduling' using errcode='42501'; end if;
  if auth.uid() is not null and auth.uid()<>v_r.guest_id then
    raise exception 'Not your reservation' using errcode='42501'; end if;
  v_policy:=public.reschedule_policy_snapshot(v_r.start_datetime);
  if not (v_policy->>'allowed')::boolean then
    raise exception 'Rescheduling requires % days notice. Contact the resort for a staff-reviewed exception',v_policy->>'minimumNoticeDays' using errcode='22023'; end if;
  if exists(select 1 from public.reservation_reschedules where reservation_id=new.reservation_id and status='pending') then
    raise exception 'A reschedule request is already pending' using errcode='40001'; end if;
  if exists(select 1 from public.payments where reservation_id=new.reservation_id and status='pending') then
    raise exception 'Resolve pending payment review before rescheduling' using errcode='40001'; end if;
  if exists(select 1 from public.refund_requests where reservation_id=new.reservation_id and status in ('pending','reviewed','approved','payout_submitted')) then
    raise exception 'Resolve the open refund before rescheduling' using errcode='40001'; end if;
  if new.old_start is distinct from v_r.start_datetime or new.old_end is distinct from v_r.end_datetime
    or new.new_start=new.old_start or new.new_start<clock_timestamp()+interval '30 minutes'
    or new.new_end-new.new_start<>v_r.end_datetime-v_r.start_datetime
    or mod(extract(epoch from new.new_start-v_r.start_datetime),86400)<>0 then
    raise exception 'Keep the booked package, start time and duration and choose another future date' using errcode='22023'; end if;
  if new.reschedule_fee is distinct from (v_policy->>'noticeFee')::numeric or new.rate_adjustment is null or new.rate_adjustment<0 then
    raise exception 'Reschedule quote changed. Refresh before submitting' using errcode='40001'; end if;
  new.created_at:=clock_timestamp();
  return new;
end $$;
drop trigger if exists guard_guest_reschedule_policy on public.reservation_reschedules;
create trigger guard_guest_reschedule_policy before insert on public.reservation_reschedules for each row execute function public.guard_guest_reschedule_policy();

create or replace function public.edit_staff_reservation_reschedule(
  p_reservation uuid, p_staff uuid, p_expected jsonb, p_patch jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_r public.reservations%rowtype;
  v_t public.transactions%rowtype;
  v_old_services jsonb;
  v_old_units jsonb;
  v_item jsonb;
  v_existing public.reservation_services%rowtype;
  v_catalog public.services%rowtype;
  v_unit public.units%rowtype;
  v_unit_id uuid;
  v_old_unit_id uuid;
  v_seen uuid[] := array[]::uuid[];
  v_service uuid;
  v_quantity integer;
  v_details_changed boolean;
  v_unit_changed boolean;
  v_start timestamptz;
  v_end timestamptz;
  v_old_services_total numeric;
  v_new_services_total numeric;
  v_total numeric(10,2);
  v_paid numeric(10,2);
  v_status text;
  v_policy jsonb; v_fee numeric; v_late boolean; v_schedule_changed boolean;
begin
  -- Only the server can execute this function or supply a package price delta.
  -- Recheck the actor's grant inside the same database transaction.
  if not exists (select 1 from public.staff_users s where s.id = p_staff and s.is_active
    and (s.role = 'admin' or exists (select 1 from public.role_permissions rp
      where rp.role = s.role and 'edit_reservation' = any(rp.permissions)))) then
    raise exception 'You do not have permission to edit reservations' using errcode = '42501';
  end if;
  select * into v_r from public.reservations where reservation_id = p_reservation for update;
  if not found then raise exception 'Reservation not found' using errcode = '22023'; end if;
  select * into v_t from public.transactions where reservation_id = p_reservation for update;
  if not found then raise exception 'Reservation bill not found' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('serviceId', service_id, 'quantity', quantity, 'price', price_at_time)
    order by service_id), '[]'::jsonb), coalesce(sum(quantity * price_at_time), 0)
    into v_old_services, v_old_services_total from public.reservation_services where reservation_id = p_reservation;
  select coalesce(jsonb_agg(jsonb_build_object('unitId', unit_id, 'quantity', quantity, 'price', price_per_night)
    order by unit_id), '[]'::jsonb) into v_old_units from public.reservation_units where reservation_id = p_reservation;
  if v_r.updated_at is distinct from (p_expected->>'updatedAt')::timestamptz
    or v_t.total_amount is distinct from (p_expected->>'totalAmount')::numeric
    or coalesce(v_t.paid_amount, 0) is distinct from (p_expected->>'paidAmount')::numeric
    or v_old_services is distinct from p_expected->'services'
    or v_old_units is distinct from p_expected->'units' then
    raise exception 'This reservation or bill changed. Reload it before saving' using errcode = '40001';
  end if;
  if v_r.status not in ('pending', 'confirmed')
    or (v_r.status = 'pending' and v_r.payment_deadline_at <= now()) then
    raise exception 'This reservation is no longer editable' using errcode = '40001';
  end if;
  if exists (select 1 from public.payments where reservation_id = p_reservation and status = 'pending')
    or exists (select 1 from public.reservation_reschedules where reservation_id = p_reservation and status = 'pending') then
    raise exception 'Resolve pending payments or reschedule requests before editing' using errcode = '40001';
  end if;
  if length(trim(coalesce(p_patch->>'reason', ''))) = 0 or length(p_patch->>'reason') > 1000
    or jsonb_typeof(p_patch->'services') is distinct from 'array' or jsonb_array_length(p_patch->'services') > 100 then
    raise exception 'Provide a reason and valid service list' using errcode = '22023';
  end if;
  v_start := (p_patch->>'startDatetime')::timestamptz;
  v_end := (p_patch->>'endDatetime')::timestamptz;
  if v_start is null or v_end is null or v_end <= v_start or
    (p_patch->>'adultCount')::integer < 1 or (p_patch->>'childCount')::integer < 0 or
    (p_patch->>'adultCount')::integer + (p_patch->>'childCount')::integer > 30 then
    raise exception 'Invalid schedule or guest counts' using errcode = '22023';
  end if;
  v_schedule_changed := v_start is distinct from v_r.start_datetime or v_end is distinct from v_r.end_datetime;
  if not v_schedule_changed or p_patch->>'bookingMode' is distinct from coalesce(v_r.booking_mode,'day')
    or mod(extract(epoch from v_start-v_r.start_datetime),86400)<>0
    or v_end-v_start<>v_r.end_datetime-v_r.start_datetime or v_start<clock_timestamp()+interval '30 minutes' then
    raise exception 'Keep the booked package and times and select another future date' using errcode='22023'; end if;
  if exists(select 1 from public.refund_requests where reservation_id=p_reservation and status in ('pending','reviewed','approved','payout_submitted')) then
    raise exception 'Resolve the open refund before rescheduling' using errcode='40001'; end if;
  v_policy:=public.reschedule_policy_snapshot(v_r.start_datetime);
  v_late:=not (v_policy->>'allowed')::boolean;
  v_fee:=(v_policy->>'noticeFee')::numeric;
  if v_late and (v_r.status<>'confirmed' or coalesce(p_patch->>'lateRescheduleAcknowledged','false')<>'true'
    or not exists(select 1 from public.staff_users s where s.id=p_staff and s.is_active and (s.role='admin' or exists
      (select 1 from public.role_permissions rp where rp.role=s.role and 'reschedule_approval'=any(rp.permissions))))) then
    raise exception 'An authorized staff member must acknowledge and document the late reschedule exception' using errcode='42501'; end if;
  if (p_patch->>'rescheduleFee')::numeric is distinct from v_fee then
    raise exception 'The notice fee changed. Reload and review the bill' using errcode='40001'; end if;
  v_details_changed := v_r.start_datetime <> v_start or v_r.end_datetime <> v_end
    or v_r.booking_mode is distinct from p_patch->>'bookingMode'
    or v_r.adult_count <> (p_patch->>'adultCount')::integer or v_r.child_count <> (p_patch->>'childCount')::integer;
  v_unit_id := (p_patch->>'unitId')::uuid;
  if jsonb_array_length(v_old_units) = 1 and (v_old_units->0->>'quantity')::integer = 1 then
    v_old_unit_id := (v_old_units->0->>'unitId')::uuid;
  end if;
  v_unit_changed := v_old_unit_id is distinct from v_unit_id;
  if v_r.start_datetime<=now() and (v_unit_changed or v_r.adult_count<>(p_patch->>'adultCount')::integer or v_r.child_count<>(p_patch->>'childCount')::integer) then
    raise exception 'The stay has started. You can add services and update notes' using errcode = '40001';
  end if;
  if not v_details_changed and coalesce((p_patch->>'packageDelta')::numeric, 0) <> 0 then
    raise exception 'Invalid package adjustment' using errcode = '22023';
  end if;
  if v_unit_changed then
    if jsonb_array_length(v_old_units) > 1 or exists (select 1 from public.reservation_units
      where reservation_id = p_reservation and quantity <> 1) then
      raise exception 'Multiple accommodations require individual billing review' using errcode = '22023';
    end if;
    select * into v_unit from public.units where unit_id = v_unit_id and is_active and archived_at is null for share;
    if not found then raise exception 'Selected accommodation is unavailable' using errcode = '22023'; end if;
  end if;
  -- Validate and lock catalog prices before modifying any booking rows.
  for v_item in select value from jsonb_array_elements(p_patch->'services') loop
    v_service := (v_item->>'serviceId')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_service is null or v_quantity is null or v_quantity < 1 or v_quantity > 10000 or v_service = any(v_seen) then
      raise exception 'Invalid service or quantity' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_service);
    select * into v_existing from public.reservation_services where reservation_id = p_reservation and service_id = v_service;
    if found then
      if v_r.start_datetime <= now() and v_quantity < v_existing.quantity then
        raise exception 'Services cannot be reduced during a stay' using errcode = '22023';
      end if;
      if v_existing.price_at_time is distinct from (v_item->>'price')::numeric then
        raise exception 'Service price changed. Reload the reservation' using errcode = '40001';
      end if;
    else
      select * into v_catalog from public.services where service_id = v_service and is_active for share;
      if not found then raise exception 'Selected service is unavailable' using errcode = '22023'; end if;
      if v_catalog.price is distinct from (v_item->>'price')::numeric then
        raise exception 'Service price changed. Reload the reservation' using errcode = '40001';
      end if;
    end if;
  end loop;
  if v_r.start_datetime <= now() and exists (select 1 from public.reservation_services
    where reservation_id = p_reservation and not (service_id = any(v_seen))) then
    raise exception 'Services cannot be removed during a stay' using errcode = '22023';
  end if;
  -- Date constraints and the existing maintenance trigger remain authoritative.
  -- Updating a note alone does not run schedule or package recalculation triggers.
  if v_details_changed then
    update public.reservations set start_datetime = v_start, end_datetime = v_end,
      booking_mode = p_patch->>'bookingMode', adult_count = (p_patch->>'adultCount')::integer,
      child_count = (p_patch->>'childCount')::integer, special_requests = nullif(p_patch->>'specialRequests', ''), updated_at = now()
      where reservation_id = p_reservation;
  else
    update public.reservations set special_requests = nullif(p_patch->>'specialRequests', ''), updated_at = now()
      where reservation_id = p_reservation;
  end if;
  if v_unit_changed then
    delete from public.reservation_units where reservation_id = p_reservation;
    insert into public.reservation_units(reservation_id, unit_id, quantity, price_per_night)
      values(p_reservation, v_unit_id, 1, v_unit.base_price);
  end if;
  delete from public.reservation_services where reservation_id = p_reservation and not (service_id = any(v_seen));
  for v_item in select value from jsonb_array_elements(p_patch->'services') loop
    insert into public.reservation_services(reservation_id, service_id, quantity, price_at_time)
      values(p_reservation, (v_item->>'serviceId')::uuid, (v_item->>'quantity')::integer, (v_item->>'price')::numeric)
      on conflict(reservation_id, service_id) do update set quantity = excluded.quantity
      where public.reservation_services.quantity <> excluded.quantity;
  end loop;
  select coalesce(sum(quantity * price_at_time), 0) into v_new_services_total
    from public.reservation_services where reservation_id = p_reservation;
  -- Override intermediate legacy trigger totals with the captured bill + deltas.
  v_total := round(v_t.total_amount + (p_patch->>'packageDelta')::numeric + v_fee + v_new_services_total - v_old_services_total, 2);
  if v_total < 0 or v_total is distinct from (p_patch->>'expectedTotal')::numeric then
    raise exception 'Bill changed. Reload to review the updated amount' using errcode = '40001';
  end if;
  v_paid := coalesce(v_t.paid_amount, 0);
  v_status := case when v_paid >= v_total then 'paid' when v_paid > 0 then 'partial' else 'unpaid' end;
  update public.transactions set total_amount = v_total, status = v_status where reservation_id = p_reservation;
  update public.invoices set total_amount = v_total,
    status = case when v_paid >= v_total then 'paid' when v_paid > 0 then 'partially_paid' else 'issued' end
    where invoice_id = (select invoice_id from public.invoices where reservation_id = p_reservation and status <> 'void'
      order by created_at desc, invoice_id desc limit 1);
  insert into public.reservation_reschedule_adjustments(reservation_id,old_start,old_end,new_start,new_end,
    notice_fee,rate_adjustment,policy_snapshot,late_exception,reason,staff_id)
    values(p_reservation,v_r.start_datetime,v_r.end_datetime,v_start,v_end,v_fee,
      greatest(coalesce((p_patch->>'dateRateAdjustment')::numeric,0),0),v_policy,v_late,p_patch->>'reason',p_staff);
  insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id, details)
    values(p_staff, p_staff, 'Rescheduled reservation and updated bill', 'reservation', p_reservation,
      jsonb_build_object('reference_number', v_r.reference_number, 'reason', p_patch->>'reason',
        'reschedule_policy',v_policy,'late_exception',v_late,'notice_fee',v_fee,'before', to_jsonb(v_r), 'before_bill', to_jsonb(v_t), 'before_services', v_old_services, 'before_units', v_old_units,
        'after', p_patch - 'version', 'new_total', v_total, 'paid_amount', v_paid,
        'balance', greatest(v_total - v_paid, 0), 'overpaid_amount', greatest(v_paid - v_total, 0)));
  return jsonb_build_object('totalAmount', v_total, 'paidAmount', v_paid, 'remainingBalance', greatest(v_total - v_paid, 0),
    'overpaidAmount', greatest(v_paid - v_total, 0), 'status', v_status,'rescheduleFee',v_fee,'lateException',v_late);
end $$;
revoke all on function public.edit_staff_reservation_reschedule(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.edit_staff_reservation_reschedule(uuid,uuid,jsonb,jsonb) to service_role;
create or replace function public.approve_reschedule_request(
  p_reschedule_id uuid,
  p_staff_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.reservation_reschedules%rowtype;
  v_reservation public.reservations%rowtype;
  v_total numeric(10,2);
  v_paid numeric(10,2);
  v_new_total numeric(10,2);
  v_charge numeric(10,2);
  v_status text;
begin
  if not exists (select 1 from public.staff_users where id = p_staff_id and is_active = true and (role='admin' or exists(select 1 from public.role_permissions rp where rp.role=staff_users.role and 'reschedule_approval'=any(rp.permissions)))) then
    raise exception 'Reschedule approval permission required' using errcode='42501';
  end if;

  select * into v_request from public.reservation_reschedules
  where reschedule_id = p_reschedule_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Reschedule request is no longer pending';
  end if;
  if v_request.new_start < now() + interval '30 minutes' then
    raise exception 'Requested start time is too soon';
  end if;

  select * into v_reservation from public.reservations
  where reservation_id = v_request.reservation_id for update;
  if not found or v_reservation.status <> 'reschedule_requested'
     or v_reservation.start_datetime <> v_request.old_start
     or v_reservation.end_datetime <> v_request.old_end then
    raise exception 'Reservation is no longer awaiting this reschedule';
  end if;

  if not (public.reschedule_policy_snapshot(v_request.old_start,v_request.created_at)->>'allowed')::boolean then
    raise exception 'This late request requires a documented staff exception. Reject it and use the reservation editor' using errcode='22023'; end if;
  if v_request.new_end-v_request.new_start<>v_reservation.end_datetime-v_reservation.start_datetime
    or mod(extract(epoch from v_request.new_start-v_reservation.start_datetime),86400)<>0 then
    raise exception 'Keep the booked package, start time and duration' using errcode='22023'; end if;
  if exists(select 1 from public.payments where reservation_id=v_request.reservation_id and status='pending')
    or exists(select 1 from public.refund_requests where reservation_id=v_request.reservation_id and status in ('pending','reviewed','approved','payout_submitted')) then
    raise exception 'Resolve the pending payment or refund review before rescheduling' using errcode='40001'; end if;
  select total_amount,paid_amount into v_total,v_paid from public.transactions where reservation_id=v_request.reservation_id for update;
  if not found then raise exception 'Reservation transaction is missing'; end if;
  v_charge := v_request.reschedule_fee + v_request.rate_adjustment;

  -- The reservation trigger recalculates the base transaction total.
  -- The exclusion constraint rejects a date taken since the guest requested it.
  update public.reservations set
    start_datetime = v_request.new_start,
    end_datetime = v_request.new_end,
    status = 'confirmed'
  where reservation_id = v_request.reservation_id;

  v_new_total := v_total + v_charge;
  v_status := case when coalesce(v_paid, 0) >= v_new_total then 'paid'
                   when coalesce(v_paid, 0) > 0 then 'partial' else 'unpaid' end;
  update public.transactions set total_amount = v_new_total, status = v_status
  where reservation_id = v_request.reservation_id;
  update public.invoices set total_amount = v_new_total, status=case when coalesce(v_paid,0)>=v_new_total then 'paid' when coalesce(v_paid,0)>0 then 'partially_paid' else 'issued' end
  where invoice_id=(select invoice_id from public.invoices where reservation_id=v_request.reservation_id and status<>'void' order by created_at desc,invoice_id desc limit 1);

  update public.reservation_reschedules set
    status = 'approved', approved_by = p_staff_id,
    approved_at = now(), rejection_reason = null
  where reschedule_id = p_reschedule_id;

  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff_id,p_staff_id,'Approved reschedule and charged notice fee','reservation_reschedule',p_reschedule_id,
      jsonb_build_object('notice_fee',v_request.reschedule_fee,'rate_adjustment',v_request.rate_adjustment,'before_total',v_total,'after_total',v_new_total));
  return jsonb_build_object(
    'reservationId', v_request.reservation_id,
    'totalAmount', v_new_total,
    'paidAmount', coalesce(v_paid, 0),
    'additionalCharge', v_charge
  );
end;
$$;

revoke all on function public.approve_reschedule_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_reschedule_request(uuid,uuid) to service_role;
-- Keep the existing edit RPC for services/details, but prevent a date edit from bypassing the policy RPC.
create or replace function public.edit_staff_reservation(
  p_reservation uuid, p_staff uuid, p_expected jsonb, p_patch jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_r public.reservations%rowtype;
  v_t public.transactions%rowtype;
  v_old_services jsonb;
  v_old_units jsonb;
  v_item jsonb;
  v_existing public.reservation_services%rowtype;
  v_catalog public.services%rowtype;
  v_unit public.units%rowtype;
  v_unit_id uuid;
  v_old_unit_id uuid;
  v_seen uuid[] := array[]::uuid[];
  v_service uuid;
  v_quantity integer;
  v_details_changed boolean;
  v_unit_changed boolean;
  v_start timestamptz;
  v_end timestamptz;
  v_old_services_total numeric;
  v_new_services_total numeric;
  v_total numeric(10,2);
  v_paid numeric(10,2);
  v_status text;
begin
  -- Only the server can execute this function or supply a package price delta.
  -- Recheck the actor's grant inside the same database transaction.
  if not exists (select 1 from public.staff_users s where s.id = p_staff and s.is_active
    and (s.role = 'admin' or exists (select 1 from public.role_permissions rp
      where rp.role = s.role and 'edit_reservation' = any(rp.permissions)))) then
    raise exception 'You do not have permission to edit reservations' using errcode = '42501';
  end if;
  select * into v_r from public.reservations where reservation_id = p_reservation for update;
  if not found then raise exception 'Reservation not found' using errcode = '22023'; end if;
  select * into v_t from public.transactions where reservation_id = p_reservation for update;
  if not found then raise exception 'Reservation bill not found' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('serviceId', service_id, 'quantity', quantity, 'price', price_at_time)
    order by service_id), '[]'::jsonb), coalesce(sum(quantity * price_at_time), 0)
    into v_old_services, v_old_services_total from public.reservation_services where reservation_id = p_reservation;
  select coalesce(jsonb_agg(jsonb_build_object('unitId', unit_id, 'quantity', quantity, 'price', price_per_night)
    order by unit_id), '[]'::jsonb) into v_old_units from public.reservation_units where reservation_id = p_reservation;
  if v_r.updated_at is distinct from (p_expected->>'updatedAt')::timestamptz
    or v_t.total_amount is distinct from (p_expected->>'totalAmount')::numeric
    or coalesce(v_t.paid_amount, 0) is distinct from (p_expected->>'paidAmount')::numeric
    or v_old_services is distinct from p_expected->'services'
    or v_old_units is distinct from p_expected->'units' then
    raise exception 'This reservation or bill changed. Reload it before saving' using errcode = '40001';
  end if;
  if v_r.status not in ('pending', 'confirmed') or v_r.end_datetime <= now()
    or (v_r.status = 'pending' and v_r.payment_deadline_at <= now()) then
    raise exception 'This reservation is no longer editable' using errcode = '40001';
  end if;
  if exists (select 1 from public.payments where reservation_id = p_reservation and status = 'pending')
    or exists (select 1 from public.reservation_reschedules where reservation_id = p_reservation and status = 'pending') then
    raise exception 'Resolve pending payments or reschedule requests before editing' using errcode = '40001';
  end if;
  if length(trim(coalesce(p_patch->>'reason', ''))) = 0 or length(p_patch->>'reason') > 1000
    or jsonb_typeof(p_patch->'services') is distinct from 'array' or jsonb_array_length(p_patch->'services') > 100 then
    raise exception 'Provide a reason and valid service list' using errcode = '22023';
  end if;
  v_start := (p_patch->>'startDatetime')::timestamptz;
  v_end := (p_patch->>'endDatetime')::timestamptz;
  if v_start is null or v_end is null or v_end <= v_start or
    (p_patch->>'adultCount')::integer < 1 or (p_patch->>'childCount')::integer < 0 or
    (p_patch->>'adultCount')::integer + (p_patch->>'childCount')::integer > 30 then
    raise exception 'Invalid schedule or guest counts' using errcode = '22023';
  end if;
  if v_start is distinct from v_r.start_datetime or v_end is distinct from v_r.end_datetime
    or p_patch->>'bookingMode' is distinct from coalesce(v_r.booking_mode,'day') then
    raise exception 'Schedule changes must use the reschedule policy workflow' using errcode='22023'; end if;
  v_details_changed := v_r.start_datetime <> v_start or v_r.end_datetime <> v_end
    or v_r.booking_mode is distinct from p_patch->>'bookingMode'
    or v_r.adult_count <> (p_patch->>'adultCount')::integer or v_r.child_count <> (p_patch->>'childCount')::integer;
  v_unit_id := (p_patch->>'unitId')::uuid;
  if jsonb_array_length(v_old_units) = 1 and (v_old_units->0->>'quantity')::integer = 1 then
    v_old_unit_id := (v_old_units->0->>'unitId')::uuid;
  end if;
  v_unit_changed := v_old_unit_id is distinct from v_unit_id;
  if (v_details_changed or v_unit_changed) and (v_r.start_datetime <= now() or v_start <= now()) then
    raise exception 'The stay has started. You can add services and update notes' using errcode = '40001';
  end if;
  if not v_details_changed and coalesce((p_patch->>'packageDelta')::numeric, 0) <> 0 then
    raise exception 'Invalid package adjustment' using errcode = '22023';
  end if;
  if v_unit_changed then
    if jsonb_array_length(v_old_units) > 1 or exists (select 1 from public.reservation_units
      where reservation_id = p_reservation and quantity <> 1) then
      raise exception 'Multiple accommodations require individual billing review' using errcode = '22023';
    end if;
    select * into v_unit from public.units where unit_id = v_unit_id and is_active and archived_at is null for share;
    if not found then raise exception 'Selected accommodation is unavailable' using errcode = '22023'; end if;
  end if;
  -- Validate and lock catalog prices before modifying any booking rows.
  for v_item in select value from jsonb_array_elements(p_patch->'services') loop
    v_service := (v_item->>'serviceId')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_service is null or v_quantity is null or v_quantity < 1 or v_quantity > 10000 or v_service = any(v_seen) then
      raise exception 'Invalid service or quantity' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_service);
    select * into v_existing from public.reservation_services where reservation_id = p_reservation and service_id = v_service;
    if found then
      if v_r.start_datetime <= now() and v_quantity < v_existing.quantity then
        raise exception 'Services cannot be reduced during a stay' using errcode = '22023';
      end if;
      if v_existing.price_at_time is distinct from (v_item->>'price')::numeric then
        raise exception 'Service price changed. Reload the reservation' using errcode = '40001';
      end if;
    else
      select * into v_catalog from public.services where service_id = v_service and is_active for share;
      if not found then raise exception 'Selected service is unavailable' using errcode = '22023'; end if;
      if v_catalog.price is distinct from (v_item->>'price')::numeric then
        raise exception 'Service price changed. Reload the reservation' using errcode = '40001';
      end if;
    end if;
  end loop;
  if v_r.start_datetime <= now() and exists (select 1 from public.reservation_services
    where reservation_id = p_reservation and not (service_id = any(v_seen))) then
    raise exception 'Services cannot be removed during a stay' using errcode = '22023';
  end if;
  -- Date constraints and the existing maintenance trigger remain authoritative.
  -- Updating a note alone does not run schedule or package recalculation triggers.
  if v_details_changed then
    update public.reservations set start_datetime = v_start, end_datetime = v_end,
      booking_mode = p_patch->>'bookingMode', adult_count = (p_patch->>'adultCount')::integer,
      child_count = (p_patch->>'childCount')::integer, special_requests = nullif(p_patch->>'specialRequests', ''), updated_at = now()
      where reservation_id = p_reservation;
  else
    update public.reservations set special_requests = nullif(p_patch->>'specialRequests', ''), updated_at = now()
      where reservation_id = p_reservation;
  end if;
  if v_unit_changed then
    delete from public.reservation_units where reservation_id = p_reservation;
    insert into public.reservation_units(reservation_id, unit_id, quantity, price_per_night)
      values(p_reservation, v_unit_id, 1, v_unit.base_price);
  end if;
  delete from public.reservation_services where reservation_id = p_reservation and not (service_id = any(v_seen));
  for v_item in select value from jsonb_array_elements(p_patch->'services') loop
    insert into public.reservation_services(reservation_id, service_id, quantity, price_at_time)
      values(p_reservation, (v_item->>'serviceId')::uuid, (v_item->>'quantity')::integer, (v_item->>'price')::numeric)
      on conflict(reservation_id, service_id) do update set quantity = excluded.quantity
      where public.reservation_services.quantity <> excluded.quantity;
  end loop;
  select coalesce(sum(quantity * price_at_time), 0) into v_new_services_total
    from public.reservation_services where reservation_id = p_reservation;
  -- Override intermediate legacy trigger totals with the captured bill + deltas.
  v_total := round(v_t.total_amount + (p_patch->>'packageDelta')::numeric + v_new_services_total - v_old_services_total, 2);
  if v_total < 0 or v_total is distinct from (p_patch->>'expectedTotal')::numeric then
    raise exception 'Bill changed. Reload to review the updated amount' using errcode = '40001';
  end if;
  v_paid := coalesce(v_t.paid_amount, 0);
  v_status := case when v_paid >= v_total then 'paid' when v_paid > 0 then 'partial' else 'unpaid' end;
  update public.transactions set total_amount = v_total, status = v_status where reservation_id = p_reservation;
  update public.invoices set total_amount = v_total,
    status = case when v_paid >= v_total then 'paid' when v_paid > 0 then 'partially_paid' else 'issued' end
    where invoice_id = (select invoice_id from public.invoices where reservation_id = p_reservation and status <> 'void'
      order by created_at desc, invoice_id desc limit 1);
  insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id, details)
    values(p_staff, p_staff, 'Edited reservation and bill', 'reservation', p_reservation,
      jsonb_build_object('reference_number', v_r.reference_number, 'reason', p_patch->>'reason',
        'before', to_jsonb(v_r), 'before_bill', to_jsonb(v_t), 'before_services', v_old_services, 'before_units', v_old_units,
        'after', p_patch - 'version', 'new_total', v_total, 'paid_amount', v_paid,
        'balance', greatest(v_total - v_paid, 0), 'overpaid_amount', greatest(v_paid - v_total, 0)));
  return jsonb_build_object('totalAmount', v_total, 'paidAmount', v_paid, 'remainingBalance', greatest(v_total - v_paid, 0),
    'overpaidAmount', greatest(v_paid - v_total, 0), 'status', v_status);
end $$;
revoke all on function public.edit_staff_reservation(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.edit_staff_reservation(uuid,uuid,jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;

-- Guest feedback archiving and repeat-review submission limits.
-- Apply after review-images, role-permissions and guest-account-status migrations.
begin;
alter table public.audit_logs add column if not exists details jsonb;
alter table public.reviews add column if not exists archived_at timestamptz;
alter table public.reviews add column if not exists archived_by uuid references public.staff_users(id);
alter table public.reviews add column if not exists archive_reason text;
drop index if exists public.one_review_per_guest;
-- Keep one review per linked reservation. Unlinked reviews may be repeated within the limits below.
create index if not exists reviews_guest_created on public.reviews(guest_id,created_at desc);
create index if not exists reviews_feedback_created on public.reviews(created_at desc,review_id);

-- This history survives deleting or archiving a review, so neither can reset the quota.
create table if not exists public.review_submission_log(
  review_id uuid primary key,guest_id uuid not null references public.guests(id) on delete cascade,
  fingerprint text not null,created_at timestamptz not null default clock_timestamp()
);
create index if not exists review_submission_guest_time on public.review_submission_log(guest_id,created_at desc);
alter table public.review_submission_log enable row level security;
revoke all on public.review_submission_log from anon,authenticated;
grant all on public.review_submission_log to service_role;
insert into public.review_submission_log(review_id,guest_id,fingerprint,created_at)
 select review_id,guest_id,md5(lower(regexp_replace(btrim(review_text),'\s+',' ','g'))),created_at
 from public.reviews on conflict(review_id) do nothing;

create or replace function public.review_submission_policy(p_guest uuid,p_title text,p_text text,p_now timestamptz default clock_timestamp())
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_latest timestamptz;v_oldest timestamptz;v_count integer;v_retry integer;
begin
  if exists(select 1 from public.review_submission_log where guest_id=p_guest and created_at>p_now-interval '24 hours'
    and fingerprint=md5(lower(regexp_replace(btrim(p_text),'\s+',' ','g')))) then
    return jsonb_build_object('allowed',false,'code','DUPLICATE_REVIEW','message','You already submitted this review within the last 24 hours. Please share a different experience.'); end if;
  select max(created_at),min(created_at),count(*) into v_latest,v_oldest,v_count from public.review_submission_log
    where guest_id=p_guest and created_at>p_now-interval '24 hours';
  v_retry:=greatest(0,coalesce(ceil(extract(epoch from v_latest+interval '10 minutes'-p_now))::integer,0),
    case when v_count>=3 then ceil(extract(epoch from v_oldest+interval '24 hours'-p_now))::integer else 0 end);
  if v_retry>0 then return jsonb_build_object('allowed',false,'code','REVIEW_RATE_LIMITED','retryAfter',v_retry,
    'message','Please wait before submitting another review. Allow 10 minutes between reviews, with a maximum of 3 in 24 hours.'); end if;
  return jsonb_build_object('allowed',true);
end $$;
revoke all on function public.review_submission_policy(uuid,text,text,timestamptz) from public,anon,authenticated;

create or replace function public.review_submission_status(p_title text,p_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.guests where id=auth.uid() and is_active) then
    raise exception 'An active guest account is required' using errcode='42501'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 or p_text is null or length(btrim(p_text)) not between 50 and 5000 then
    raise exception 'Enter a title of 1-200 characters and review text of 50-5000 characters' using errcode='22023'; end if;
  return public.review_submission_policy(auth.uid(),p_title,p_text);
end $$;
revoke all on function public.review_submission_status(text,text) from public,anon;
grant execute on function public.review_submission_status(text,text) to authenticated;

create or replace function public.guard_review_submission()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_policy jsonb;
begin
  if new.title is null or length(btrim(new.title)) not between 1 and 200 or new.review_text is null or length(btrim(new.review_text)) not between 50 and 5000 then
    raise exception 'Enter valid review content' using errcode='22023'; end if;
  -- Serialize concurrent submissions for the same account, across server instances.
  perform 1 from public.guests where id=new.guest_id and is_active for update;
  if not found or (auth.uid() is not null and auth.uid()<>new.guest_id) then
    raise exception 'An active guest account is required' using errcode='42501'; end if;
  if new.archived_at is not null or new.archived_by is not null or new.archive_reason is not null then
    raise exception 'New feedback cannot include archive metadata' using errcode='42501'; end if;
  if new.reservation_id is not null and not exists(select 1 from public.reservations where reservation_id=new.reservation_id and guest_id=new.guest_id) then
    raise exception 'The reservation must belong to this guest' using errcode='22023'; end if;
  v_policy:=public.review_submission_policy(new.guest_id,new.title,new.review_text);
  if not (v_policy->>'allowed')::boolean then
    if v_policy->>'code'='DUPLICATE_REVIEW' then raise exception '%',v_policy->>'message' using errcode='P0409'; end if;
    raise exception '%',v_policy->>'message' using errcode='P0429',detail=v_policy->>'retryAfter'; end if;
  new.created_at:=clock_timestamp();new.updated_at:=new.created_at;
  insert into public.review_submission_log(review_id,guest_id,fingerprint,created_at)
    values(new.review_id,new.guest_id,md5(lower(regexp_replace(btrim(new.review_text),'\s+',' ','g'))),new.created_at);
  return new;
end $$;
drop trigger if exists guard_review_submission on public.reviews;
create trigger guard_review_submission before insert on public.reviews for each row execute function public.guard_review_submission();

create or replace function public.can_archive_feedback()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_users s where s.id=auth.uid() and s.is_active
    and s.active_session_id is not null and s.active_session_id::text=auth.jwt()->>'session_id'
    and (s.role='admin' or exists(select 1 from public.role_permissions rp where rp.role=s.role
      and 'analytics'=any(rp.permissions) and 'feedback_archive'=any(rp.permissions))));
$$;
revoke all on function public.can_archive_feedback() from public,anon;
grant execute on function public.can_archive_feedback() to authenticated;

create or replace function public.guard_review_changes()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.review_id is distinct from old.review_id or new.guest_id is distinct from old.guest_id or new.created_at is distinct from old.created_at then
    raise exception 'Feedback identity and submission time cannot be changed' using errcode='42501'; end if;
  if auth.uid() is not null and auth.uid()<>old.guest_id
    and (to_jsonb(new)-array['archived_at','archived_by','archive_reason','updated_at']) is distinct from
      (to_jsonb(old)-array['archived_at','archived_by','archive_reason','updated_at']) then
    raise exception 'Archiving permission does not allow changing guest review content or ratings' using errcode='42501'; end if;
  if new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by
    or new.archive_reason is distinct from old.archive_reason or new.is_approved is distinct from old.is_approved then
    if not public.can_archive_feedback() then raise exception 'Feedback archive permission required' using errcode='42501'; end if;
    if (new.archived_at is null)=(old.archived_at is null) and (new.archived_at is distinct from old.archived_at
      or new.archived_by is distinct from old.archived_by or new.archive_reason is distinct from old.archive_reason) then
      raise exception 'Use an archive or restore action to change feedback status' using errcode='40001'; end if;
    if new.archived_at is distinct from old.archived_at then
      if length(btrim(coalesce(new.archive_reason,'')))<3 or length(new.archive_reason)>500 then
        raise exception 'Enter a reason between 3 and 500 characters' using errcode='22023'; end if;
      new.archived_at:=case when new.archived_at is null then null else clock_timestamp() end;
      new.archived_by:=case when new.archived_at is null then null else auth.uid() end;
      insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
        values(auth.uid(),auth.uid(),case when new.archived_at is null then 'Restored guest feedback' else 'Archived guest feedback' end,'review',new.review_id,
          jsonb_build_object('reason',new.archive_reason,'before_archived_at',old.archived_at,'archived_at',new.archived_at,'rating',old.overall_rating));
    end if;
  end if;
  new.updated_at:=clock_timestamp();return new;
end $$;
drop trigger if exists guard_review_changes on public.reviews;
create trigger guard_review_changes before update on public.reviews for each row execute function public.guard_review_changes();

drop policy if exists "Public read approved reviews" on public.reviews;
create policy "Public read approved reviews" on public.reviews for select using(is_approved and archived_at is null);
drop policy if exists "Staff manage reviews" on public.reviews;
drop policy if exists "Staff read feedback" on public.reviews;
create policy "Staff read feedback" on public.reviews for select to authenticated using(exists(select 1 from public.staff_users s
  where s.id=auth.uid() and s.is_active and (s.role='admin' or exists(select 1 from public.role_permissions rp where rp.role=s.role and 'analytics'=any(rp.permissions)))));
drop policy if exists "Staff archive feedback" on public.reviews;
create policy "Staff archive feedback" on public.reviews for update to authenticated using(public.can_archive_feedback()) with check(public.can_archive_feedback());
drop policy if exists "Users manage own reviews" on public.reviews;
create policy "Users manage own reviews" on public.reviews for update to authenticated using(auth.uid()=guest_id and archived_at is null)
  with check(auth.uid()=guest_id and archived_at is null);

create or replace function public.set_feedback_archived(p_review uuid,p_archive boolean,p_reason text,p_expected_archived_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_review public.reviews%rowtype;
begin
  if not public.can_archive_feedback() then raise exception 'Feedback archive permission required' using errcode='42501'; end if;
  select * into v_review from public.reviews where review_id=p_review for update;
  if not found then raise exception 'Feedback not found' using errcode='P0002'; end if;
  if p_archive is null or v_review.archived_at is distinct from p_expected_archived_at
    or (v_review.archived_at is not null)=p_archive then
    raise exception 'Feedback status changed. Refresh before trying again' using errcode='40001'; end if;
  update public.reviews set archived_at=case when p_archive then clock_timestamp() else null end,archive_reason=btrim(p_reason)
    where review_id=p_review returning * into v_review;
  return jsonb_build_object('review_id',v_review.review_id,'archived_at',v_review.archived_at);
end $$;
revoke all on function public.set_feedback_archived(uuid,boolean,text,timestamptz) from public,anon;
grant execute on function public.set_feedback_archived(uuid,boolean,text,timestamptz) to authenticated;

drop policy if exists "Read visible review photos" on storage.objects;
create policy "Read visible review photos" on storage.objects for select to anon,authenticated using(bucket_id='review-images'
  and exists(select 1 from public.reviews r where r.image_path=storage.objects.name and r.is_approved and r.archived_at is null));
notify pgrst,'reload schema';
commit;
-- Apply after reservation-edit, package-rates, guest-account-status,
-- additional-services-billing, overpayment-refunds and cancellation-refund-workflow.
-- Guest dates/packages and immutable payments/receipts are never changed here.
begin;
create or replace function public.edit_guest_reservation_bill(p_reservation uuid,p_guest uuid,p_expected jsonb,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_r public.reservations%rowtype; v_t public.transactions%rowtype;
  v_existing public.reservation_services%rowtype; v_catalog public.services%rowtype;
  v_old_services jsonb; v_old_units jsonb; v_before_services_total numeric; v_after_services_total numeric;
  v_item jsonb; v_service uuid; v_quantity integer; v_seen uuid[]:=array[]::uuid[];
  v_adults integer; v_children integer; v_total numeric; v_paid numeric; v_status text; v_reducing boolean:=false;
begin
  if not exists(select 1 from public.guests where id=p_guest and is_active) then
    raise exception 'This guest account is not active' using errcode='42501'; end if;
  select * into v_r from public.reservations where reservation_id=p_reservation for update;
  if not found or v_r.guest_id is distinct from p_guest then
    raise exception 'Booking not found for this account' using errcode='42501'; end if;
  if v_r.status not in ('pending','confirmed') or v_r.end_datetime<=clock_timestamp()
    or (v_r.status='pending' and (v_r.payment_deadline_at is null or v_r.payment_deadline_at<=clock_timestamp())) then
    raise exception 'This booking is no longer editable' using errcode='40001'; end if;
  select * into v_t from public.transactions where reservation_id=p_reservation for update;
  if not found then raise exception 'Booking bill not found' using errcode='22023'; end if;
  perform public.refresh_reservation_payment_totals(p_reservation);
  select * into v_t from public.transactions where reservation_id=p_reservation;
  v_paid:=coalesce(v_t.paid_amount,0);
  if exists(select 1 from public.payments where reservation_id=p_reservation and status='pending')
    or exists(select 1 from public.reservation_reschedules where reservation_id=p_reservation and status='pending')
    or exists(select 1 from public.refund_requests where reservation_id=p_reservation and status in ('pending','reviewed','approved','payout_submitted')) then
    raise exception 'Resolve the pending payment, reschedule or refund review before editing' using errcode='40001'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('serviceId',service_id,'quantity',quantity,'price',price_at_time) order by service_id),'[]'::jsonb),
    coalesce(sum(quantity*price_at_time),0) into v_old_services,v_before_services_total
    from public.reservation_services where reservation_id=p_reservation;
  select coalesce(jsonb_agg(jsonb_build_object('unitId',unit_id,'quantity',quantity,'price',price_per_night) order by unit_id),'[]'::jsonb)
    into v_old_units from public.reservation_units where reservation_id=p_reservation;
  if v_r.updated_at is distinct from (p_expected->>'updatedAt')::timestamptz
    or v_t.total_amount is distinct from (p_expected->>'totalAmount')::numeric
    or v_paid is distinct from (p_expected->>'paidAmount')::numeric
    or v_old_services is distinct from p_expected->'services' or v_old_units is distinct from p_expected->'units' then
    raise exception 'This booking or bill changed. Reload before saving' using errcode='40001'; end if;
  if jsonb_typeof(p_patch->'services') is distinct from 'array' or jsonb_array_length(p_patch->'services')>100
    or coalesce(p_patch->>'adultCount','') !~ '^[0-9]{1,2}$' or coalesce(p_patch->>'childCount','') !~ '^[0-9]{1,2}$'
    or jsonb_typeof(p_patch->'packageDelta') is distinct from 'number'
    or jsonb_typeof(p_patch->'expectedTotal') is distinct from 'number' then
    raise exception 'Enter valid guest counts and service quantities' using errcode='22023'; end if;
  v_adults:=(p_patch->>'adultCount')::integer; v_children:=(p_patch->>'childCount')::integer;
  if v_adults<1 or v_children<0 or v_adults+v_children>30 then
    raise exception 'Include at least one adult and no more than 30 guests' using errcode='22023'; end if;
  if (v_adults<>v_r.adult_count or v_children<>v_r.child_count) and v_r.start_datetime<=clock_timestamp() then
    raise exception 'Guest counts can only be changed before check-in. Contact resort staff' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_patch->'services') loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or coalesce(v_item->>'serviceId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or coalesce(v_item->>'quantity','') !~ '^[1-9][0-9]{0,4}$' then
      raise exception 'Choose valid services and quantities' using errcode='22023'; end if;
    v_service:=(v_item->>'serviceId')::uuid; v_quantity:=(v_item->>'quantity')::integer;
    if v_service=any(v_seen) or v_quantity>10000 then raise exception 'Duplicate service or invalid quantity' using errcode='22023'; end if;
    v_seen:=array_append(v_seen,v_service);
    select * into v_existing from public.reservation_services where reservation_id=p_reservation and service_id=v_service;
    if found then
      if v_quantity<v_existing.quantity then v_reducing:=true; end if;
    elsif not exists(select 1 from public.services where service_id=v_service and is_active) then
      raise exception 'A selected service is no longer available. Reload the booking' using errcode='22023'; end if;
  end loop;
  if exists(select 1 from public.reservation_services where reservation_id=p_reservation and not(service_id=any(v_seen))) then v_reducing:=true; end if;
  if v_reducing and (v_paid>=v_t.total_amount or v_r.start_datetime<=clock_timestamp()) then
    raise exception 'Services cannot be reduced after full payment or after check-in. Contact resort staff' using errcode='22023'; end if;
  delete from public.reservation_services where reservation_id=p_reservation and not(service_id=any(v_seen));
  for v_item in select value from jsonb_array_elements(p_patch->'services') loop
    v_service:=(v_item->>'serviceId')::uuid; v_quantity:=(v_item->>'quantity')::integer;
    select * into v_existing from public.reservation_services where reservation_id=p_reservation and service_id=v_service;
    if found then
      update public.reservation_services set quantity=v_quantity where reservation_id=p_reservation and service_id=v_service and quantity<>v_quantity;
    else
      select * into v_catalog from public.services where service_id=v_service and is_active for share;
      if not found then raise exception 'A selected service became unavailable. Reload the booking' using errcode='40001'; end if;
      insert into public.reservation_services(reservation_id,service_id,quantity,price_at_time) values(p_reservation,v_service,v_quantity,v_catalog.price);
    end if;
  end loop;
  select coalesce(sum(quantity*price_at_time),0) into v_after_services_total from public.reservation_services where reservation_id=p_reservation;
  v_total:=round(v_t.total_amount+(p_patch->>'packageDelta')::numeric+v_after_services_total-v_before_services_total,2);
  if v_total<0 or v_total>99999999.99 or v_total is distinct from (p_patch->>'expectedTotal')::numeric then
    raise exception 'The bill changed. Reload and review the total' using errcode='40001'; end if;
  update public.reservations set adult_count=v_adults,child_count=v_children,updated_at=clock_timestamp() where reservation_id=p_reservation;
  v_status:=case when v_paid>=v_total then 'paid' when v_paid>0 then 'partial' else 'unpaid' end;
  -- Override legacy recalculation triggers with the captured negotiated bill plus
  -- only the historical-package guest delta and the actual stored service delta.
  update public.transactions set total_amount=v_total,paid_amount=v_paid,status=v_status where reservation_id=p_reservation;
  update public.invoices set total_amount=v_total,status=case when v_paid>=v_total then 'paid' when v_paid>0 then 'partially_paid' else 'issued' end
    where invoice_id=(select invoice_id from public.invoices where reservation_id=p_reservation and status<>'void' order by created_at desc,invoice_id desc limit 1);
  insert into public.audit_logs(auth_user_id,action,entity_type,entity_id,details)
    values(p_guest,'Guest edited booking and bill','reservation',p_reservation,jsonb_build_object('before',to_jsonb(v_r),'before_services',v_old_services,
      'before_total',v_t.total_amount,'after',p_patch,'verified_net_paid',v_paid,'new_total',v_total,'balance',greatest(v_total-v_paid,0),'overpaid_amount',greatest(v_paid-v_total,0)));
  return jsonb_build_object('totalAmount',v_total,'paidAmount',v_paid,'remainingBalance',greatest(v_total-v_paid,0),'overpaidAmount',greatest(v_paid-v_total,0),
    'adultCount',v_adults,'childCount',v_children,'services',(select coalesce(jsonb_agg(jsonb_build_object('serviceId',rs.service_id,'name',coalesce(s.name,'Booked service'),
      'quantity',rs.quantity,'priceAtTime',rs.price_at_time) order by rs.service_id),'[]'::jsonb) from public.reservation_services rs left join public.services s on s.service_id=rs.service_id where rs.reservation_id=p_reservation));
end $$;
revoke all on function public.edit_guest_reservation_bill(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.edit_guest_reservation_bill(uuid,uuid,jsonb,jsonb) to service_role;

-- Preserve the guest API's initial service inserts for an unpaid pending hold.
-- Later guest changes must use an audited billing RPC, including calls made
-- directly with a Supabase JWT rather than through the website controls.
create or replace function public.guard_guest_service_edits()
returns trigger language plpgsql set search_path='' as $$
declare v_r public.reservations%rowtype;
begin
  if current_user in ('anon','authenticated') and not exists
    (select 1 from public.staff_users where id=auth.uid() and is_active) then
    select * into v_r from public.reservations where reservation_id=case when tg_op='DELETE' then old.reservation_id else new.reservation_id end for update;
    -- A reservation deleted through its own access rules cascades its children.
    if not found and tg_op='DELETE' then return old; end if;
    if tg_op<>'INSERT' or v_r.guest_id is distinct from auth.uid() or v_r.status<>'pending'
      or v_r.payment_deadline_at is null or v_r.payment_deadline_at<=clock_timestamp()
      or not exists(select 1 from public.guests where id=auth.uid() and is_active)
      or exists(select 1 from public.payments where reservation_id=v_r.reservation_id and status='verified') then
      raise exception 'Use Edit booking to change services and recalculate the bill' using errcode='42501'; end if;
    if new.quantity is null or new.quantity<1 or new.quantity>10000 or not exists
      (select 1 from public.services where service_id=new.service_id and is_active and price=new.price_at_time) then
      raise exception 'Choose an available service at its catalog price' using errcode='22023'; end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
drop trigger if exists guard_guest_service_edits on public.reservation_services;
create trigger guard_guest_service_edits before insert or update or delete on public.reservation_services
  for each row execute function public.guard_guest_service_edits();
notify pgrst,'reload schema';
commit;


-- Apply after role-permissions and reservation lifecycle migrations.
-- Existing reservations have unknown attendance until staff record actual arrival.
begin;
alter table public.reservations add column if not exists checked_in_at timestamptz;
alter table public.reservations add column if not exists checked_in_by uuid references public.staff_users(id);

create or replace function public.guard_reservation_attendance()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Invoker context: browser clients cannot forge arrival records.
  if current_user in ('anon','authenticated') then
    if tg_op = 'INSERT' then
      if new.checked_in_at is not null or new.checked_in_by is not null then
        raise exception 'Use the staff check-in action to record arrival' using errcode='42501';
      end if;
    elsif new.checked_in_at is distinct from old.checked_in_at or new.checked_in_by is distinct from old.checked_in_by then
      raise exception 'Use the staff check-in action to record arrival' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_reservation_attendance on public.reservations;
create trigger guard_reservation_attendance before insert or update on public.reservations
for each row execute function public.guard_reservation_attendance();

create or replace function public.check_in_reservation(p_reservation uuid, p_staff uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_r public.reservations%rowtype;
begin
  if not exists(select 1 from public.staff_users s where s.id=p_staff and s.is_active
    and (s.role='admin' or exists(select 1 from public.role_permissions rp where rp.role=s.role and 'edit_reservation'=any(rp.permissions)))) then
    raise exception 'Reservation check-in permission required' using errcode='42501';
  end if;
  select * into v_r from public.reservations where reservation_id=p_reservation for update;
  if not found then raise exception 'Reservation not found' using errcode='P0002'; end if;
  if v_r.checked_in_at is not null then return to_jsonb(v_r); end if;
  if v_r.status <> 'confirmed' or (v_r.start_datetime at time zone 'Asia/Manila')::date <> (clock_timestamp() at time zone 'Asia/Manila')::date
    or v_r.end_datetime <= clock_timestamp() then
    raise exception 'Only a confirmed reservation arriving today can be checked in' using errcode='40001';
  end if;
  update public.reservations set checked_in_at=clock_timestamp(),checked_in_by=p_staff
    where reservation_id=p_reservation returning * into v_r;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff,p_staff,'Recorded guest check-in','reservation',p_reservation,
      jsonb_build_object('checked_in_at',v_r.checked_in_at,'reference_number',v_r.reference_number));
  return to_jsonb(v_r);
end $$;
revoke all on function public.check_in_reservation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.check_in_reservation(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
commit;


-- Apply after reservation-lifecycle, role-permissions, staff-cash-payments,
-- cancellation-refund-workflow and admin-refund-verification migrations.
begin;
alter table public.payments add column if not exists rejection_reason text;
alter table public.audit_logs add column if not exists details jsonb;
grant update (rejection_reason) on public.payments to authenticated;

create or replace function public.can_review_payment(p_method uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_users s where s.id=auth.uid() and s.is_active
    and s.active_session_id is not null and s.active_session_id::text=auth.jwt()->>'session_id'
    and (s.role='admin' or exists(select 1 from public.role_permissions rp where rp.role=s.role
      and ('payment_approval'=any(rp.permissions) or ('payment_entry'=any(rp.permissions)
        and exists(select 1 from public.payment_methods m where m.payment_method_id=p_method and lower(btrim(m.type))='cash'))))));
$$;
revoke all on function public.can_review_payment(uuid) from public,anon;
grant execute on function public.can_review_payment(uuid) to authenticated;

drop policy if exists "Staff can verify payments" on public.payments;
drop policy if exists "Admin and cashier can review payments" on public.payments;
drop policy if exists "Authorized staff review payments" on public.payments;
create policy "Authorized staff review payments" on public.payments for update to authenticated
  using(public.can_review_payment(payment_method_id)) with check(public.can_review_payment(payment_method_id));

create or replace function public.guard_payment_review()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_r public.reservations%rowtype;
begin
  if old.status<>'pending' or new.status not in ('verified','rejected') or new.status is not distinct from old.status then
    raise exception 'Payment has already been reviewed or transition is invalid' using errcode='23514'; end if;
  if not public.can_review_payment(new.payment_method_id) or (new.status='rejected' and not exists
    (select 1 from public.staff_users s where s.id=auth.uid() and s.is_active and (s.role='admin' or exists
      (select 1 from public.role_permissions rp where rp.role=s.role and 'payment_approval'=any(rp.permissions))))) then
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
drop trigger if exists guard_payment_review_trigger on public.payments;
create trigger guard_payment_review_trigger before update of status on public.payments
for each row execute function public.guard_payment_review();

create or replace function public.guard_payment_rejection_reason()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.rejection_reason is not null then raise exception 'A rejection reason may only be recorded during review' using errcode='23514'; end if;
  elsif new.rejection_reason is distinct from old.rejection_reason then
    if old.status<>'pending' or new.status<>'rejected' then
      raise exception 'The recorded payment rejection reason cannot be changed' using errcode='23514'; end if;
  end if;
  if tg_op='UPDATE' and old.status='pending' and new.status='rejected'
    and coalesce(length(btrim(new.rejection_reason)),0) not between 5 and 2000 then
    raise exception 'A rejection reason of 5 to 2,000 characters is required' using errcode='22023';
  end if;
  return new;
end $$;
drop trigger if exists guard_payment_rejection_reason on public.payments;
create trigger guard_payment_rejection_reason before insert or update of status,rejection_reason on public.payments
for each row execute function public.guard_payment_rejection_reason();

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
          'reference_number',new.reference_number,'status',new.status,'rejection_reason',new.rejection_reason));
  end if;
  return new;
end $$;
drop trigger if exists finish_payment_review_trigger on public.payments;
create trigger finish_payment_review_trigger after update of status on public.payments
for each row execute function public.finish_payment_review();

-- Normalize titles at the shared notification boundary, preserving the existing
-- atomic refund approval, payout and verification workflow.
create or replace function public.notify_refund_workflow(p_guest uuid,p_title text,p_message text,p_entity text,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_title text:=case lower(btrim(p_title))
  when 'refund reviewed' then 'Refund awaiting approval'
  when 'refund approved' then 'Refund approved'
  when 'refund rejected' then 'Refund request rejected'
  when 'refund payout submitted' then 'Refund transfer awaiting verification'
  when 'refund refunded' then 'Refund completed' else p_title end;
begin
  if p_guest is not null then
    insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
      values('guest',p_guest,auth.uid(),v_title,p_message,'/manage',p_entity,p_id);
  end if;
  insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
    select s.role,s.id,auth.uid(),v_title,p_message,'/admin/transactions?tab=refunds',p_entity,p_id
    from public.staff_users s where s.is_active and (s.role in ('admin','cashier') or exists
      (select 1 from public.role_permissions rp where rp.role=s.role and rp.permissions && array['refund_review','refund_payout','refund_verify']));
end $$;
revoke all on function public.notify_refund_workflow(uuid,text,text,text,uuid) from public,anon,authenticated;
update public.notifications set title='Refund completed' where lower(btrim(title))='refund refunded';
notify pgrst,'reload schema';
commit;


-- stay-completion-migration.sql
-- Apply after reservation-calendar-attendance, cancellation-refund-workflow,
-- staff-cash-payments, reschedule-policy and review-feedback-management migrations.
-- Attendance records are entered by staff; elapsed booking time does not complete a stay.
begin;
alter table public.reservations add column if not exists checked_out_at timestamptz;
alter table public.reservations add column if not exists checked_out_by uuid references public.staff_users(id);

create or replace function public.guard_reservation_attendance()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated') then
    if tg_op='INSERT' then
      if new.checked_in_at is not null or new.checked_in_by is not null or new.checked_out_at is not null or new.checked_out_by is not null then
        raise exception 'Use the staff arrival and checkout actions' using errcode='42501'; end if;
    elsif new.checked_in_at is distinct from old.checked_in_at or new.checked_in_by is distinct from old.checked_in_by
      or new.checked_out_at is distinct from old.checked_out_at or new.checked_out_by is distinct from old.checked_out_by then
      raise exception 'Use the staff arrival and checkout actions' using errcode='42501';
    end if;
  end if;
  return new;
end $$;

create or replace function public.guard_stay_lifecycle()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_total numeric; v_paid numeric;
begin
  if old.checked_in_at is not null and (new.status in ('cancelled','reschedule_requested')
    or new.start_datetime is distinct from old.start_datetime or new.end_datetime is distinct from old.end_datetime
    or new.booking_mode is distinct from old.booking_mode) then
    raise exception 'Checked-in reservations cannot be cancelled or rescheduled' using errcode='40001'; end if;
  if old.status is distinct from new.status and new.status='completed' then
    if old.status<>'confirmed' or old.checked_in_at is null or new.checked_out_at is null or new.checked_out_by is null then
      raise exception 'Record guest check-in and use the staff checkout action to complete a stay' using errcode='40001'; end if;
    select total_amount into v_total from public.transactions where reservation_id=new.reservation_id;
    select coalesce(sum(amount),0) into v_paid from public.payments where reservation_id=new.reservation_id and status='verified';
    v_paid:=v_paid-coalesce((select sum(amount) from public.refund_requests where reservation_id=new.reservation_id and status='refunded'),0);
    if v_total is null or round(v_paid,2)<round(v_total,2) then
      raise exception 'Settle the full reservation bill with verified payments before checkout' using errcode='40001'; end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_stay_lifecycle on public.reservations;
create trigger guard_stay_lifecycle before update on public.reservations for each row execute function public.guard_stay_lifecycle();

create or replace function public.guard_checked_in_reschedule()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_checked_in timestamptz;
begin
  if tg_op='INSERT' or new.status='approved' then
    select checked_in_at into v_checked_in from public.reservations where reservation_id=new.reservation_id for update;
    if v_checked_in is not null then raise exception 'Checked-in reservations cannot be rescheduled' using errcode='40001'; end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_checked_in_reschedule on public.reservation_reschedules;
create trigger guard_checked_in_reschedule before insert or update on public.reservation_reschedules for each row execute function public.guard_checked_in_reschedule();

create or replace function public.check_in_reservation(p_reservation uuid,p_staff uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_r public.reservations%rowtype;
begin
  if not exists(select 1 from public.staff_users s where s.id=p_staff and s.is_active
    and (s.role='admin' or exists(select 1 from public.role_permissions rp where rp.role=s.role and 'edit_reservation'=any(rp.permissions)))) then
    raise exception 'Reservation check-in permission required' using errcode='42501'; end if;
  select * into v_r from public.reservations where reservation_id=p_reservation for update;
  if not found then raise exception 'Reservation not found' using errcode='P0002'; end if;
  if v_r.checked_in_at is not null then return to_jsonb(v_r)||jsonb_build_object('alreadyCheckedIn',true); end if;
  if v_r.status<>'confirmed' or (v_r.start_datetime at time zone 'Asia/Manila')::date<>(clock_timestamp() at time zone 'Asia/Manila')::date
    or v_r.end_datetime<=clock_timestamp() then
    raise exception 'Only a confirmed reservation arriving today can be checked in' using errcode='40001'; end if;
  if exists(select 1 from public.reservation_reschedules where reservation_id=p_reservation and status='pending') then
    raise exception 'Resolve the pending reschedule request before check-in' using errcode='40001'; end if;
  update public.reservations set checked_in_at=clock_timestamp(),checked_in_by=p_staff where reservation_id=p_reservation returning * into v_r;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff,p_staff,'Recorded guest check-in','reservation',p_reservation,jsonb_build_object('checked_in_at',v_r.checked_in_at,'reference_number',v_r.reference_number));
  return to_jsonb(v_r)||jsonb_build_object('alreadyCheckedIn',false);
end $$;
revoke all on function public.check_in_reservation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.check_in_reservation(uuid,uuid) to service_role;

create or replace function public.check_out_reservation(p_reservation uuid,p_staff uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_r public.reservations%rowtype; v_t public.transactions%rowtype;
begin
  if not exists(select 1 from public.staff_users s where s.id=p_staff and s.is_active
    and (s.role='admin' or exists(select 1 from public.role_permissions rp where rp.role=s.role and 'edit_reservation'=any(rp.permissions)))) then
    raise exception 'Reservation checkout permission required' using errcode='42501'; end if;
  select * into v_r from public.reservations where reservation_id=p_reservation for update;
  if not found then raise exception 'Reservation not found' using errcode='P0002'; end if;
  if v_r.status='completed' and v_r.checked_out_at is not null then
    return to_jsonb(v_r)||jsonb_build_object('alreadyCheckedOut',true); end if;
  if v_r.status<>'confirmed' or v_r.checked_in_at is null then
    raise exception 'Only a checked-in confirmed reservation can be checked out' using errcode='40001'; end if;
  if exists(select 1 from public.payments where reservation_id=p_reservation and status='pending') then
    raise exception 'Review pending payments before checkout' using errcode='40001'; end if;
  if exists(select 1 from public.reservation_reschedules where reservation_id=p_reservation and status='pending') then
    raise exception 'Resolve pending reschedule requests before checkout' using errcode='40001'; end if;
  perform 1 from public.transactions where reservation_id=p_reservation for update;
  perform public.refresh_reservation_payment_totals(p_reservation);
  select * into v_t from public.transactions where reservation_id=p_reservation;
  if not found or v_t.balance>0 or coalesce(v_t.paid_amount,0)<v_t.total_amount then
    raise exception 'Settle the full reservation bill with verified payments before checkout' using errcode='40001'; end if;
  update public.reservations set status='completed',checked_out_at=clock_timestamp(),checked_out_by=p_staff
    where reservation_id=p_reservation returning * into v_r;
  update public.invoices set status='paid' where reservation_id=p_reservation and status<>'void';
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff,p_staff,'Checked out guest and completed stay','reservation',p_reservation,
      jsonb_build_object('checked_in_at',v_r.checked_in_at,'checked_out_at',v_r.checked_out_at,'reference_number',v_r.reference_number,
        'total_amount',v_t.total_amount,'verified_net_paid',v_t.paid_amount,'balance',v_t.balance));
  return to_jsonb(v_r)||jsonb_build_object('alreadyCheckedOut',false);
end $$;
revoke all on function public.check_out_reservation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.check_out_reservation(uuid,uuid) to service_role;

-- Existing rate limits and repeat-review rules still apply after a completed stay.
create or replace function public.guard_review_completed_stay()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.reservations r where r.guest_id=new.guest_id and r.status='completed'
    and (new.reservation_id is null or r.reservation_id=new.reservation_id)) then
    raise exception 'Complete a resort stay before submitting a review. Linked reservations must be your own completed stays' using errcode='42501'; end if;
  return new;
end $$;
drop trigger if exists guard_review_completed_stay on public.reviews;
create trigger guard_review_completed_stay before insert or update of reservation_id,guest_id on public.reviews
for each row execute function public.guard_review_completed_stay();

create or replace function public.review_submission_status(p_title text,p_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.guests where id=auth.uid() and is_active) then
    raise exception 'An active guest account is required' using errcode='42501'; end if;
  if not exists(select 1 from public.reservations where guest_id=auth.uid() and status='completed') then
    raise exception 'Complete a resort stay before submitting a review' using errcode='42501'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 or p_text is null or length(btrim(p_text)) not between 50 and 5000 then
    raise exception 'Enter a title of 1-200 characters and review text of 50-5000 characters' using errcode='22023'; end if;
  return public.review_submission_policy(auth.uid(),p_title,p_text);
end $$;
revoke all on function public.review_submission_status(text,text) from public,anon;
grant execute on function public.review_submission_status(text,text) to authenticated;

-- Keep the existing refund quote and policy, adding the arrival lock.
create or replace function public.get_cancellation_preview(p_reservation uuid,p_initiator text default 'guest')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; t public.transactions%rowtype; p public.booking_policy_versions%rowtype;
  v_staff boolean:=public.refund_staff_permission('cancel_reservation'); v_gross numeric; v_previous numeric;
  v_net numeric; v_base numeric; v_deposit numeric; v_deduction numeric; v_refund numeric; v_allowed boolean;
  v_result jsonb; v_block text;
begin
  if p_initiator is null or p_initiator not in ('guest','resort') then raise exception 'Choose guest or resort cancellation' using errcode='22023'; end if;
  select * into r from public.reservations where reservation_id=p_reservation;
  if not found then raise exception 'Reservation not found' using errcode='22023'; end if;
  if auth.uid() is null or (not v_staff and (r.guest_id is distinct from auth.uid() or p_initiator<>'guest')) then
    raise exception 'Cancellation permission required' using errcode='42501'; end if;
  if p_initiator='resort' and not exists(select 1 from public.staff_users where id=auth.uid() and role='admin' and is_active) then
    raise exception 'Only an administrator may cancel for a resort-attributable reason' using errcode='42501'; end if;
  select * into t from public.transactions where reservation_id=p_reservation;
  if not found then raise exception 'Reservation bill not found' using errcode='22023'; end if;
  select * into p from public.booking_policy_versions where version=r.booking_policy_version;
  if not found then select * into p from public.booking_policy_versions order by version desc limit 1; end if;
  if not found then raise exception 'Booking policy is not configured' using errcode='22023'; end if;
  select coalesce(sum(amount),0) into v_gross from public.payments where reservation_id=p_reservation and status='verified';
  select coalesce(sum(amount),0) into v_previous from public.refund_requests where reservation_id=p_reservation and status='refunded';
  v_net:=round(greatest(v_gross-v_previous,0),2);
  v_base:=coalesce(t.cancellation_deposit_base,t.total_amount);
  v_deposit:=ceil(v_base*20)/100; -- Same cent rounding as the required 20% downpayment.
  v_deduction:=case when p_initiator='guest' then least(v_net,v_deposit) else 0 end;
  v_refund:=round(greatest(v_net-v_deduction,0),2);
  if r.checked_in_at is not null then v_block:='Checked-in reservations cannot be cancelled or rescheduled.';
  elsif r.status not in ('pending','payment_submitted','confirmed','reschedule_requested') then v_block:='This reservation cannot be cancelled.';
  elsif exists(select 1 from public.payments where reservation_id=p_reservation and status='pending') then v_block:='Review pending payments before cancelling.';
  elsif exists(select 1 from public.refund_requests where reservation_id=p_reservation and status='payout_submitted') then v_block:='Verify the existing refund transfer before cancelling.';
  elsif not v_staff and r.start_datetime-now()<make_interval(hours=>p.guest_cancellation_notice_hours) then v_block:='The guest cancellation notice window has passed. Contact the resort.';
  end if;
  v_allowed:=v_block is null;
  v_result:=jsonb_build_object('reservationId',p_reservation,'reference',r.reference_number,'initiator',p_initiator,
    'totalAmount',t.total_amount,'verifiedPaid',v_gross,'previousRefunds',v_previous,'netPaid',v_net,
    'depositBase',v_base,'depositAmount',v_deposit,'deduction',v_deduction,'refundableAmount',v_refund,
    'policyVersion',p.version,'noticeHours',p.guest_cancellation_notice_hours,'allowed',v_allowed,'blockedReason',v_block,
    'outcome',case when v_refund>0 then 'pending_refund' else 'no_refund' end,
    'rule',case when p_initiator='resort' then 'Full refund of remaining verified payments; no deposit deduction.'
      else 'The initial 20% deposit is retained. Only remaining verified payments above that deposit are refundable.' end);
  return v_result || jsonb_build_object('quote',md5(v_result::text));
end $$;
revoke all on function public.get_cancellation_preview(uuid,text) from public,anon;
grant execute on function public.get_cancellation_preview(uuid,text) to authenticated;


notify pgrst, 'reload schema';
commit;


-- ocular-review-migration.sql
-- Apply after role-permissions and the ocular visit/time-slot tables.
begin;
alter table public.ocular_visits add column if not exists review_reason text;
alter table public.ocular_visits add column if not exists reviewed_at timestamptz;
alter table public.ocular_visits add column if not exists reviewed_by uuid references public.staff_users(id);
alter table public.ocular_visits drop constraint if exists ocular_visits_status_check;
alter table public.ocular_visits add constraint ocular_visits_status_check
  check(status in ('pending','confirmed','rejected','cancelled','completed'));

create or replace function public.guard_ocular_review_write()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if current_user in ('anon','authenticated') and (new.status<>'pending' or new.reviewed_at is not null or new.reviewed_by is not null or new.review_reason is not null) then
      raise exception 'New ocular visits must await staff review' using errcode='42501'; end if;
  else
    if current_user in ('anon','authenticated') and (new.reviewed_at is distinct from old.reviewed_at or new.reviewed_by is distinct from old.reviewed_by
      or new.review_reason is distinct from old.review_reason or (new.status is distinct from old.status and new.status in ('confirmed','rejected'))) then
      raise exception 'Use the authorized ocular review action' using errcode='42501'; end if;
    if new.status is distinct from old.status and new.status in ('confirmed','rejected') and (old.status<>'pending'
      or length(btrim(coalesce(new.review_reason,''))) not between 5 and 2000 or new.reviewed_at is null or new.reviewed_by is null) then
      raise exception 'Review a pending ocular visit and document a reason' using errcode='22023'; end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_ocular_review_write on public.ocular_visits;
create trigger guard_ocular_review_write before insert or update on public.ocular_visits for each row execute function public.guard_ocular_review_write();

create or replace function public.review_ocular_visit(p_visit uuid,p_action text,p_reason text,p_staff uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_visit public.ocular_visits%rowtype; v_time time; v_status text;
begin
  if not exists(select 1 from public.staff_users s where s.id=p_staff and s.is_active
    and (s.role='admin' or exists(select 1 from public.role_permissions rp where rp.role=s.role and 'ocular_approval'=any(rp.permissions)))) then
    raise exception 'Ocular approval permission required' using errcode='42501'; end if;
  if p_action is null or p_action not in ('approve','reject') or length(btrim(coalesce(p_reason,''))) not between 5 and 2000 then
    raise exception 'Choose approve or reject and enter a reason of 5 to 2000 characters' using errcode='22023'; end if;
  v_status:=case when p_action='approve' then 'confirmed' else 'rejected' end;
  select * into v_visit from public.ocular_visits where visit_id=p_visit for update;
  if not found then raise exception 'Ocular visit not found' using errcode='P0002'; end if;
  if v_visit.status=v_status and v_visit.reviewed_by=p_staff and v_visit.review_reason=btrim(p_reason) then
    return to_jsonb(v_visit)||jsonb_build_object('alreadyReviewed',true); end if;
  if v_visit.status<>'pending' then raise exception 'This ocular visit was already reviewed. Refresh the calendar' using errcode='40001'; end if;
  if p_action='approve' then
    select start_time into v_time from public.ocular_time_slots where slot_id=v_visit.time_slot_id;
    if v_time is null or ((v_visit.scheduled_date+v_time) at time zone 'Asia/Manila')<=clock_timestamp() then
      raise exception 'Only a future ocular visit with an available time slot can be approved' using errcode='40001'; end if;
  end if;
  update public.ocular_visits set status=v_status,review_reason=btrim(p_reason),reviewed_at=clock_timestamp(),reviewed_by=p_staff
    where visit_id=p_visit returning * into v_visit;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff,p_staff,case when p_action='approve' then 'Approved ocular visit' else 'Rejected ocular visit' end,'ocular_visit',p_visit,
      jsonb_build_object('reference_number',v_visit.reference_number,'reason',btrim(p_reason),'status',v_status,'scheduled_date',v_visit.scheduled_date));
  return to_jsonb(v_visit)||jsonb_build_object('alreadyReviewed',false);
end $$;
revoke all on function public.review_ocular_visit(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.review_ocular_visit(uuid,text,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;

-- guest-reschedule-requests-migration.sql
-- Apply after reschedule-policy and stay-completion migrations, before deploying.
-- Guests may request short-notice changes; only authorized staff approval moves
-- the reservation and adds charges. Existing requests and financial records remain intact.
begin;

create or replace function public.guard_guest_reschedule_policy()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_r public.reservations%rowtype; v_policy jsonb; v_requested_at timestamptz:=clock_timestamp();
begin
  if new.status is distinct from 'pending' then return new; end if;
  select * into v_r from public.reservations where reservation_id=new.reservation_id for update;
  if not found or v_r.status<>'confirmed' or new.requested_by is distinct from v_r.guest_id or v_r.guest_id is null then
    raise exception 'Only the confirmed reservation owner may request rescheduling' using errcode='42501'; end if;
  if auth.uid() is not null and auth.uid()<>v_r.guest_id then
    raise exception 'Not your reservation' using errcode='42501'; end if;
  if v_r.checked_in_at is not null then
    raise exception 'Checked-in reservations cannot be rescheduled' using errcode='40001'; end if;
  -- Short notice changes the fee and review context, not permission to request.
  v_policy:=public.reschedule_policy_snapshot(v_r.start_datetime,v_requested_at);
  if exists(select 1 from public.reservation_reschedules where reservation_id=new.reservation_id and status='pending') then
    raise exception 'A reschedule request is already pending' using errcode='40001'; end if;
  if exists(select 1 from public.payments where reservation_id=new.reservation_id and status='pending') then
    raise exception 'Resolve pending payment review before rescheduling' using errcode='40001'; end if;
  if exists(select 1 from public.refund_requests where reservation_id=new.reservation_id and status in ('pending','reviewed','approved','payout_submitted')) then
    raise exception 'Resolve the open refund before rescheduling' using errcode='40001'; end if;
  if new.old_start is distinct from v_r.start_datetime or new.old_end is distinct from v_r.end_datetime
    or new.new_start=new.old_start or new.new_start<clock_timestamp()+interval '30 minutes'
    or new.new_end-new.new_start<>v_r.end_datetime-v_r.start_datetime
    or mod(extract(epoch from new.new_start-v_r.start_datetime),86400)<>0 then
    raise exception 'Keep the booked package, start time and duration and choose another future date' using errcode='22023'; end if;
  if new.reschedule_fee is distinct from (v_policy->>'noticeFee')::numeric or new.rate_adjustment is null or new.rate_adjustment<0 then
    raise exception 'Reschedule quote changed. Refresh before submitting' using errcode='40001'; end if;
  new.created_at:=v_requested_at;
  return new;
end $$;

drop trigger if exists guard_guest_reschedule_policy on public.reservation_reschedules;
create trigger guard_guest_reschedule_policy before insert on public.reservation_reschedules
for each row execute function public.guard_guest_reschedule_policy();

create or replace function public.approve_reschedule_request(
  p_reschedule_id uuid,
  p_staff_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.reservation_reschedules%rowtype;
  v_reservation public.reservations%rowtype;
  v_total numeric(10,2);
  v_paid numeric(10,2);
  v_new_total numeric(10,2);
  v_charge numeric(10,2);
  v_status text;
  v_policy jsonb;
begin
  if not exists (select 1 from public.staff_users where id = p_staff_id and is_active = true and (role='admin' or exists(select 1 from public.role_permissions rp where rp.role=staff_users.role and 'reschedule_approval'=any(rp.permissions)))) then
    raise exception 'Reschedule approval permission required' using errcode='42501';
  end if;

  select * into v_request from public.reservation_reschedules
  where reschedule_id = p_reschedule_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Reschedule request is no longer pending';
  end if;
  if v_request.new_start < now() + interval '30 minutes' then
    raise exception 'Requested start time is too soon';
  end if;

  select * into v_reservation from public.reservations
  where reservation_id = v_request.reservation_id for update;
  if not found or v_reservation.status <> 'reschedule_requested'
     or v_reservation.start_datetime <> v_request.old_start
     or v_reservation.end_datetime <> v_request.old_end then
    raise exception 'Reservation is no longer awaiting this reschedule';
  end if;

  if v_reservation.checked_in_at is not null then
    raise exception 'Checked-in reservations cannot be rescheduled' using errcode='40001'; end if;
  -- Use the request timestamp so waiting for review does not increase its notice fee.
  v_policy:=public.reschedule_policy_snapshot(v_request.old_start,v_request.created_at);
  if v_request.reschedule_fee is distinct from (v_policy->>'noticeFee')::numeric
    or v_request.rate_adjustment is null or v_request.rate_adjustment<0 then
    raise exception 'Reschedule quote changed. Refresh before approving' using errcode='40001'; end if;
  if v_request.new_end-v_request.new_start<>v_reservation.end_datetime-v_reservation.start_datetime
    or mod(extract(epoch from v_request.new_start-v_reservation.start_datetime),86400)<>0 then
    raise exception 'Keep the booked package, start time and duration' using errcode='22023'; end if;
  if exists(select 1 from public.payments where reservation_id=v_request.reservation_id and status='pending')
    or exists(select 1 from public.refund_requests where reservation_id=v_request.reservation_id and status in ('pending','reviewed','approved','payout_submitted')) then
    raise exception 'Resolve the pending payment or refund review before rescheduling' using errcode='40001'; end if;
  select total_amount,paid_amount into v_total,v_paid from public.transactions where reservation_id=v_request.reservation_id for update;
  if not found then raise exception 'Reservation transaction is missing'; end if;
  v_charge := v_request.reschedule_fee + v_request.rate_adjustment;

  -- The reservation trigger recalculates the base transaction total.
  -- The exclusion constraint rejects a date taken since the guest requested it.
  update public.reservations set
    start_datetime = v_request.new_start,
    end_datetime = v_request.new_end,
    status = 'confirmed'
  where reservation_id = v_request.reservation_id;

  v_new_total := v_total + v_charge;
  v_status := case when coalesce(v_paid, 0) >= v_new_total then 'paid'
                   when coalesce(v_paid, 0) > 0 then 'partial' else 'unpaid' end;
  update public.transactions set total_amount = v_new_total, status = v_status
  where reservation_id = v_request.reservation_id;
  update public.invoices set total_amount = v_new_total, status=case when coalesce(v_paid,0)>=v_new_total then 'paid' when coalesce(v_paid,0)>0 then 'partially_paid' else 'issued' end
  where invoice_id=(select invoice_id from public.invoices where reservation_id=v_request.reservation_id and status<>'void' order by created_at desc,invoice_id desc limit 1);

  update public.reservation_reschedules set
    status = 'approved', approved_by = p_staff_id,
    approved_at = now(), rejection_reason = null
  where reschedule_id = p_reschedule_id;

  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff_id,p_staff_id,'Approved reschedule and charged notice fee','reservation_reschedule',p_reschedule_id,
      jsonb_build_object('notice_fee',v_request.reschedule_fee,'rate_adjustment',v_request.rate_adjustment,'before_total',v_total,'after_total',v_new_total,
        'requested_by',v_request.requested_by,'requested_at',v_request.created_at,
        'policy_at_request',v_policy,'late_request',not (v_policy->>'allowed')::boolean,
        'old_start',v_request.old_start,'old_end',v_request.old_end,
        'new_start',v_request.new_start,'new_end',v_request.new_end));
  return jsonb_build_object(
    'reservationId', v_request.reservation_id,
    'totalAmount', v_new_total,
    'paidAmount', coalesce(v_paid, 0),
    'additionalCharge', v_charge
  );
end;
$$;

revoke all on function public.approve_reschedule_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_reschedule_request(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
commit;


-- Editable package time slots (apply after the package-rate migration).
-- Apply AFTER package-rates-migration.sql in Supabase SQL Editor.
-- Existing versions receive the original fixed times; reservations keep their
-- booked version, exact arrival/departure timestamps, prices and payment history.
begin;

create or replace function public.valid_package_times(p_times jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare v_slot jsonb; v_key text; v_duration integer;
begin
  if jsonb_typeof(p_times) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p_times))<>3
    or jsonb_typeof(p_times->'whole_day') is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p_times->'whole_day'))<>2 then return false; end if;
  foreach v_key in array array['day','night','day_to_night','night_to_day'] loop
    v_slot:=case when v_key in ('day','night') then p_times->v_key else p_times->'whole_day'->v_key end;
    if jsonb_typeof(v_slot) is distinct from 'object' then return false; end if;
    if (select count(*) from jsonb_object_keys(v_slot))<>3
      or jsonb_typeof(v_slot->'start') is distinct from 'string'
      or jsonb_typeof(v_slot->'end') is distinct from 'string'
      or jsonb_typeof(v_slot->'endDayOffset') is distinct from 'number'
      or (v_slot->>'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or (v_slot->>'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or (v_slot->>'endDayOffset')::numeric not in (0,1) then return false; end if;
    v_duration:=extract(epoch from ((v_slot->>'end')::time-(v_slot->>'start')::time))::integer/60
      +(v_slot->>'endDayOffset')::integer*1440;
    if v_duration<=0 or v_duration>1440 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

alter table public.package_rate_versions add column if not exists times jsonb not null default
  '{"day":{"start":"08:00","end":"16:00","endDayOffset":0},"night":{"start":"18:00","end":"06:00","endDayOffset":1},"whole_day":{"day_to_night":{"start":"08:00","end":"06:00","endDayOffset":1},"night_to_day":{"start":"18:00","end":"16:00","endDayOffset":1}}}'::jsonb;
alter table public.package_rate_versions drop constraint if exists package_rate_versions_times_check;
alter table public.package_rate_versions add constraint package_rate_versions_times_check check(public.valid_package_times(times));

-- Return type gains a column, so PostgreSQL requires replacing the function.
drop function public.get_package_rates(bigint);
create function public.get_package_rates(p_version bigint default null)
returns table(version bigint,rates jsonb,times jsonb) language sql stable security definer set search_path='' as $$
  select p.version,p.rates,p.times from public.package_rate_versions p
  where p_version is null or p.version=p_version order by p.version desc limit 1;
$$;
revoke all on function public.get_package_rates(bigint) from public;
grant execute on function public.get_package_rates(bigint) to anon,authenticated,service_role;

drop function if exists public.publish_package_rates(jsonb,bigint);
create or replace function public.publish_package_rates(p_rates jsonb,p_expected_version bigint,p_times jsonb default null)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_previous public.package_rate_versions%rowtype; v_version bigint; v_times jsonb;
begin
  if not exists(select 1 from public.staff_users where id=v_actor and is_active and role='admin') then
    raise exception 'Only an active administrator may change package rates and times' using errcode='42501'; end if;
  lock table public.package_rate_versions in share row exclusive mode;
  select * into v_previous from public.package_rate_versions order by version desc limit 1;
  if p_expected_version is distinct from v_previous.version then
    raise exception 'Package prices or times changed. Reload before saving' using errcode='40001'; end if;
  v_times:=coalesce(p_times,v_previous.times);
  if not public.valid_package_rates(p_rates) or not public.valid_package_times(v_times) then
    raise exception 'Enter valid package prices and time slots lasting more than zero and no more than 24 hours' using errcode='22023'; end if;
  if p_rates=v_previous.rates and v_times=v_previous.times then return v_previous.version; end if;
  insert into public.package_rate_versions(rates,times,created_by) values(p_rates,v_times,v_actor) returning version into v_version;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,details)
    values(v_actor,v_actor,'Updated swimming package rates and time slots','package_rates',
      jsonb_build_object('previous_version',v_previous.version,'version',v_version,'before',v_previous.rates,'after',p_rates,
        'previous_times',v_previous.times,'times',v_times));
  return v_version;
end $$;
revoke all on function public.publish_package_rates(jsonb,bigint,jsonb) from public,anon;
grant execute on function public.publish_package_rates(jsonb,bigint,jsonb) to authenticated;

create or replace function public.matches_package_slot(p_start timestamptz,p_end timestamptz,p_slot jsonb)
returns boolean language sql immutable set search_path='' as $$
  select (p_start at time zone 'Asia/Manila')::time=(p_slot->>'start')::time
    and (p_end at time zone 'Asia/Manila')::time=(p_slot->>'end')::time
    and (p_end at time zone 'Asia/Manila')::date=(p_start at time zone 'Asia/Manila')::date+(p_slot->>'endDayOffset')::integer;
$$;

create or replace function public.set_reservation_package_rate_version()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_schedule public.package_rate_versions%rowtype; v_matches boolean;
begin
  if tg_op='UPDATE' then
    if new.package_rate_version is distinct from old.package_rate_version then
      raise exception 'Booked package rates cannot be replaced' using errcode='22023'; end if;
    return new;
  end if;
  lock table public.package_rate_versions in share mode;
  select * into v_schedule from public.package_rate_versions order by version desc limit 1;
  if v_schedule.version is null then raise exception 'Package rates are not configured' using errcode='22023'; end if;
  if new.package_rate_version is not null and new.package_rate_version<>v_schedule.version then
    raise exception 'Package prices or times changed. Refresh and review the booking again' using errcode='40001'; end if;
  new.package_rate_version:=v_schedule.version;
  if new.booking_mode in ('day','night') then
    v_matches:=public.matches_package_slot(new.start_datetime,new.end_datetime,v_schedule.times->new.booking_mode);
  elsif new.booking_mode='whole_day' then
    v_matches:=public.matches_package_slot(new.start_datetime,new.end_datetime,v_schedule.times->'whole_day'->'day_to_night')
      or public.matches_package_slot(new.start_datetime,new.end_datetime,v_schedule.times->'whole_day'->'night_to_day');
  else return new;
  end if;
  if not coalesce(v_matches,false) then
    raise exception 'Choose the saved package time slot. Refresh the booking form' using errcode='22023'; end if;
  return new;
end $$;
notify pgrst,'reload schema';
commit;


-- guest-auto-reschedule-migration.sql
-- Apply after guest-reschedule-requests, package-rates, maintenance-refunds,
-- guest-account-status and stay-completion migrations before deploying.
-- New guest reschedules are approved immediately. Historical requests are retained.
begin;

alter table public.reservation_reschedules add column if not exists reason text;
-- Remove the earlier signature so callers cannot omit the reason.
drop function if exists public.reschedule_guest_reservation(uuid,uuid,jsonb,timestamptz,timestamptz,numeric,numeric);

create or replace function public.reschedule_guest_reservation(
  p_reservation uuid, p_guest uuid, p_expected jsonb,
  p_new_start timestamptz, p_new_end timestamptz,
  p_notice_fee numeric, p_rate_adjustment numeric, p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_r public.reservations%rowtype;
  v_total numeric; v_paid numeric; v_new_total numeric; v_charge numeric;
  v_policy jsonb; v_at timestamptz; v_id uuid;
  v_day date; v_first date; v_last date;
begin
  if length(trim(coalesce(p_reason,'')))<5 or length(p_reason)>2000 then
    raise exception 'A reschedule reason between 5 and 2000 characters is required' using errcode='22023'; end if;
  select * into v_r from public.reservations where reservation_id=p_reservation for update;
  if not found or v_r.guest_id is distinct from p_guest or p_guest is null
    or (auth.uid() is not null and auth.uid()<>p_guest)
    or not exists(select 1 from public.guests where id=p_guest and is_active=true) then
    raise exception 'An active reservation owner is required' using errcode='42501'; end if;
  if v_r.status<>'confirmed' or v_r.checked_in_at is not null then
    raise exception 'Only confirmed reservations before check-in can be rescheduled' using errcode='40001'; end if;
  if p_expected is null
    or (p_expected->>'startDatetime')::timestamptz is distinct from v_r.start_datetime
    or (p_expected->>'endDatetime')::timestamptz is distinct from v_r.end_datetime
    or (p_expected->>'adultCount')::integer is distinct from v_r.adult_count
    or (p_expected->>'childCount')::integer is distinct from v_r.child_count
    or (p_expected->>'bookingMode') is distinct from v_r.booking_mode
    or (p_expected->>'packageRateVersion')::bigint is distinct from v_r.package_rate_version
    or v_r.package_rate_version is null then
    raise exception 'This reservation changed. Refresh Manage Booking before rescheduling' using errcode='40001'; end if;
  v_at:=clock_timestamp();
  if p_new_start is null or p_new_end is null or not isfinite(p_new_start) or not isfinite(p_new_end)
    or p_new_start<v_at+interval '30 minutes' or p_new_end<=p_new_start
    or p_new_start=v_r.start_datetime or v_r.booking_mode is null
    or p_new_end-p_new_start<>v_r.end_datetime-v_r.start_datetime
    or mod(extract(epoch from p_new_start-v_r.start_datetime),86400)<>0 then
    raise exception 'Keep the booked package, start time and duration and choose another future date' using errcode='22023'; end if;
  if exists(select 1 from public.reservation_reschedules where reservation_id=p_reservation and status='pending')
    or exists(select 1 from public.payments where reservation_id=p_reservation and status='pending')
    or exists(select 1 from public.refund_requests where reservation_id=p_reservation and status in ('pending','reviewed','approved','payout_submitted')) then
    raise exception 'Resolve the pending payment, reschedule or refund review before rescheduling' using errcode='40001'; end if;
  v_policy:=public.reschedule_policy_snapshot(v_r.start_datetime,v_at);
  if p_notice_fee is distinct from (v_policy->>'noticeFee')::numeric
    or p_rate_adjustment is null or p_rate_adjustment<0 or p_rate_adjustment='NaN'::numeric then
    raise exception 'Reschedule quote changed. Refresh before saving' using errcode='40001'; end if;

  -- Use the same Manila-day locks as booking and maintenance creation. The
  -- reservation exclusion constraint remains the final guard against races.
  v_first:=(p_new_start at time zone 'Asia/Manila')::date;
  v_last:=((p_new_end-interval '1 microsecond') at time zone 'Asia/Manila')::date;
  for v_day in select generate_series(v_first,v_last,interval '1 day')::date loop
    perform pg_advisory_xact_lock(424242,hashtext(v_day::text));
  end loop;
  if exists(select 1 from public.maintenance_blocks where status='active' and start_date<=v_last and end_date>=v_first) then
    raise exception 'The selected date is closed for maintenance' using errcode='23P01'; end if;
  if exists(select 1 from public.reservations r where r.reservation_id<>p_reservation
    and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
    and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>v_at)
    and r.start_datetime<p_new_end and r.end_datetime>p_new_start) then
    raise exception 'The selected date has already been reserved' using errcode='23P01'; end if;
  select total_amount,coalesce(paid_amount,0) into v_total,v_paid
    from public.transactions where reservation_id=p_reservation for update;
  if not found then raise exception 'Reservation transaction is missing' using errcode='40001'; end if;
  v_charge:=round(p_notice_fee+p_rate_adjustment,2);
  v_new_total:=v_total+v_charge;

  insert into public.reservation_reschedules(reservation_id,requested_by,old_start,old_end,new_start,new_end,
    reschedule_fee,rate_adjustment,status,approved_by,approved_at,created_at,reason)
    values(p_reservation,p_guest,v_r.start_datetime,v_r.end_datetime,p_new_start,p_new_end,
      p_notice_fee,p_rate_adjustment,'approved',null,v_at,v_at,trim(p_reason)) returning reschedule_id into v_id;
  update public.reservations set start_datetime=p_new_start,end_datetime=p_new_end,status='confirmed'
    where reservation_id=p_reservation;
  -- Restore the captured bill after legacy schedule-recalculation triggers;
  -- preserve all existing payments, service prices, receipts and earlier fees.
  update public.transactions set total_amount=v_new_total,paid_amount=v_paid,
    status=case when v_paid>=v_new_total then 'paid' when v_paid>0 then 'partial' else 'unpaid' end
    where reservation_id=p_reservation;
  update public.invoices set total_amount=v_new_total,
    status=case when v_paid>=v_new_total then 'paid' when v_paid>0 then 'partially_paid' else 'issued' end
    where invoice_id=(select invoice_id from public.invoices where reservation_id=p_reservation and status<>'void'
      order by created_at desc,invoice_id desc limit 1);
  insert into public.audit_logs(auth_user_id,action,entity_type,entity_id,details)
    values(p_guest,'Automatically approved guest reschedule and charged notice fee','reservation_reschedule',v_id,
      jsonb_build_object('automatic_approval',true,'requested_by',p_guest,'requested_at',v_at,
        'notice_fee',p_notice_fee,'rate_adjustment',p_rate_adjustment,'reason',trim(p_reason),'before_total',v_total,'after_total',v_new_total,
        'policy_at_request',v_policy,'old_start',v_r.start_datetime,'old_end',v_r.end_datetime,
        'new_start',p_new_start,'new_end',p_new_end));
  return jsonb_build_object('reservationId',p_reservation,'rescheduleId',v_id,'status','confirmed',
    'startDatetime',p_new_start,'endDatetime',p_new_end,'rescheduleFee',p_notice_fee,'rateAdjustment',p_rate_adjustment,
    'totalAdditional',v_charge,'totalAmount',v_new_total,'paidAmount',v_paid,'remainingBalance',greatest(v_new_total-v_paid,0));
end $$;

revoke all on function public.reschedule_guest_reservation(uuid,uuid,jsonb,timestamptz,timestamptz,numeric,numeric,text) from public,anon,authenticated;
grant execute on function public.reschedule_guest_reservation(uuid,uuid,jsonb,timestamptz,timestamptz,numeric,numeric,text) to service_role;
notify pgrst, 'reload schema';
commit;

-- Admin read-only operations and manager refund approval
-- Apply after role-permissions, cancellation-refund-workflow,
-- admin-refund-verification, maintenance-refunds and stay-completion migrations.
-- Admins manage Users/Configuration/Catalog and read operational modules.
-- Managers (stored role: staff) approve refunds; payout verification stays independent.
begin;

update public.role_permissions set permissions=(select array_agg(distinct permission)
  from unnest(permissions || array['transactions','refund_approval']) permission) where role='staff';
update public.role_permissions set permissions=array_remove(permissions,'refund_approval') where role='cashier';

create or replace function public.guard_admin_operational_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_bucket text; v_old_bucket text;
begin
  if tg_table_schema='storage' then
    v_bucket:=case when tg_op='DELETE' then old.bucket_id else new.bucket_id end;
    v_old_bucket:=case when tg_op='UPDATE' then old.bucket_id else v_bucket end;
    if v_bucket not in ('payment-proofs','refund-proofs','review-images') and v_old_bucket not in ('payment-proofs','refund-proofs','review-images') then
      if tg_op='DELETE' then return old; end if; return new;
    end if;
  end if;
  if exists(select 1 from public.staff_users where id=auth.uid() and role='admin') then
    raise exception 'Administrators have view-only access to operational modules' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_admin_operational_write() from public,anon,authenticated;

do $$ declare v_table text; begin
  foreach v_table in array array['reservations','walk_in_guests','reservation_reschedules','reservation_units',
    'reservation_services','reservation_reschedule_adjustments','transactions','payments','refund_requests',
    'invoices','receipts','maintenance_blocks','ocular_visits','reviews','reservation_status_logs','review_submission_log'] loop
    if to_regclass('public.'||v_table) is not null then
      execute format('drop trigger if exists guard_admin_operational_write on public.%I',v_table);
      execute format('create trigger guard_admin_operational_write before insert or update or delete on public.%I for each row execute function public.guard_admin_operational_write()',v_table);
    end if;
  end loop;
  if to_regclass('storage.objects') is not null then
    execute 'drop trigger if exists guard_admin_operational_proof_write on storage.objects';
    execute 'create trigger guard_admin_operational_proof_write before insert or update or delete on storage.objects for each row execute function public.guard_admin_operational_write()';
  end if;
end $$;

-- The role check applies even when grants are forged or a security-definer RPC is called directly.
create or replace function public.refund_staff_permission(p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_users s where s.id=auth.uid() and s.is_active and s.role<>'admin'
    and (p_permission<>'refund_approval' or s.role='staff')
    and exists(select 1 from public.role_permissions rp where rp.role=s.role and p_permission=any(rp.permissions)));
$$;
revoke all on function public.refund_staff_permission(text) from public,anon;
grant execute on function public.refund_staff_permission(text) to authenticated;


create or replace function public.notify_refund_workflow(p_guest uuid,p_title text,p_message text,p_entity text,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_guest is not null then
    insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
      values('guest',p_guest,auth.uid(),p_title,p_message,'/manage',p_entity,p_id);
  end if;
  insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
    select s.role,s.id,auth.uid(),p_title,p_message,'/admin/transactions?tab=refunds',p_entity,p_id
    from public.staff_users s where s.is_active and (s.role in ('admin','cashier') or exists
      (select 1 from public.role_permissions rp where rp.role=s.role and
        rp.permissions && array['refund_review','refund_approval','refund_payout','refund_verify']));
end $$;
revoke all on function public.notify_refund_workflow(uuid,text,text,text,uuid) from public,anon,authenticated;

create or replace function public.get_cancellation_preview(p_reservation uuid,p_initiator text default 'guest')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; t public.transactions%rowtype; p public.booking_policy_versions%rowtype;
  v_staff boolean:=public.refund_staff_permission('cancel_reservation'); v_gross numeric; v_previous numeric;
  v_net numeric; v_base numeric; v_deposit numeric; v_deduction numeric; v_refund numeric; v_allowed boolean;
  v_result jsonb; v_block text;
begin
  if p_initiator is null or p_initiator not in ('guest','resort') then raise exception 'Choose guest or resort cancellation' using errcode='22023'; end if;
  select * into r from public.reservations where reservation_id=p_reservation;
  if not found then raise exception 'Reservation not found' using errcode='22023'; end if;
  if auth.uid() is null or (not v_staff and (r.guest_id is distinct from auth.uid() or p_initiator<>'guest')) then
    raise exception 'Cancellation permission required' using errcode='42501'; end if;
  if p_initiator='resort' and not exists(select 1 from public.staff_users where id=auth.uid() and role='staff' and is_active) then
    raise exception 'Only an authorized manager may cancel for a resort-attributable reason' using errcode='42501'; end if;
  select * into t from public.transactions where reservation_id=p_reservation;
  if not found then raise exception 'Reservation bill not found' using errcode='22023'; end if;
  select * into p from public.booking_policy_versions where version=r.booking_policy_version;
  if not found then select * into p from public.booking_policy_versions order by version desc limit 1; end if;
  if not found then raise exception 'Booking policy is not configured' using errcode='22023'; end if;
  select coalesce(sum(amount),0) into v_gross from public.payments where reservation_id=p_reservation and status='verified';
  select coalesce(sum(amount),0) into v_previous from public.refund_requests where reservation_id=p_reservation and status='refunded';
  v_net:=round(greatest(v_gross-v_previous,0),2);
  v_base:=coalesce(t.cancellation_deposit_base,t.total_amount);
  v_deposit:=ceil(v_base*20)/100; -- Same cent rounding as the required 20% downpayment.
  v_deduction:=case when p_initiator='guest' then least(v_net,v_deposit) else 0 end;
  v_refund:=round(greatest(v_net-v_deduction,0),2);
  if r.checked_in_at is not null then v_block:='Checked-in reservations cannot be cancelled or rescheduled.';
  elsif r.status not in ('pending','payment_submitted','confirmed','reschedule_requested') then v_block:='This reservation cannot be cancelled.';
  elsif exists(select 1 from public.payments where reservation_id=p_reservation and status='pending') then v_block:='Review pending payments before cancelling.';
  elsif exists(select 1 from public.refund_requests where reservation_id=p_reservation and status='payout_submitted') then v_block:='Verify the existing refund transfer before cancelling.';
  elsif not v_staff and r.start_datetime-now()<make_interval(hours=>p.guest_cancellation_notice_hours) then v_block:='The guest cancellation notice window has passed. Contact the resort.';
  end if;
  v_allowed:=v_block is null;
  v_result:=jsonb_build_object('reservationId',p_reservation,'reference',r.reference_number,'initiator',p_initiator,
    'totalAmount',t.total_amount,'verifiedPaid',v_gross,'previousRefunds',v_previous,'netPaid',v_net,
    'depositBase',v_base,'depositAmount',v_deposit,'deduction',v_deduction,'refundableAmount',v_refund,
    'policyVersion',p.version,'noticeHours',p.guest_cancellation_notice_hours,'allowed',v_allowed,'blockedReason',v_block,
    'outcome',case when v_refund>0 then 'pending_refund' else 'no_refund' end,
    'rule',case when p_initiator='resort' then 'Full refund of remaining verified payments; no deposit deduction.'
      else 'The initial 20% deposit is retained. Only remaining verified payments above that deposit are refundable.' end);
  return v_result || jsonb_build_object('quote',md5(v_result::text));
end $$;

create or replace function public.recalculate_legacy_cancellation_refund(p_id uuid,p_initiator text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare f public.refund_requests%rowtype; v_res uuid; q jsonb;
begin
  if not public.refund_staff_permission('refund_approval') then
    raise exception 'Manager refund approval permission required' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Document why the legacy cancellation was classified this way' using errcode='22023'; end if;
  select reservation_id into v_res from public.refund_requests where refund_id=p_id;
  perform 1 from public.reservations where reservation_id=v_res and status='cancelled' for update;
  if not found then raise exception 'A cancelled reservation is required' using errcode='22023'; end if;
  perform 1 from public.transactions where reservation_id=v_res for update;
  select * into f from public.refund_requests where refund_id=p_id for update;
  if f.workflow_version<>1 or f.request_kind<>'cancellation' or f.status not in ('pending','reviewed','approved') then
    raise exception 'Only an unprocessed legacy cancellation request can be recalculated' using errcode='22023'; end if;
  q:=public.get_cancellation_preview(v_res,p_initiator);
  if exists(select 1 from public.payments where reservation_id=v_res and status='pending') then
    raise exception 'Review pending payments first' using errcode='40001'; end if;
  update public.refund_requests set amount=case when (q->>'refundableAmount')::numeric>0 then (q->>'refundableAmount')::numeric else amount end,
    status=case when (q->>'refundableAmount')::numeric>0 then 'pending' else 'rejected' end,
    workflow_version=2,calculation_snapshot=q,cancellation_event_id=v_res,policy_snapshot=q->>'rule',
    reviewed_by=null,reviewed_at=null,review_reason=case when (q->>'refundableAmount')::numeric=0 then 'Cancelled - No Refund: deposit retained.' else null end,
    payment_reviewed_by=null,payment_reviewed_at=null,payment_review_notes=null where refund_id=p_id;
  update public.reservations set cancellation_initiator=p_initiator,cancellation_snapshot=q where reservation_id=v_res;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(auth.uid(),auth.uid(),'Recalculated legacy cancellation refund','refund_request',p_id,
      jsonb_build_object('previous',to_jsonb(f),'calculation',q,'reason',trim(p_reason)));
  perform public.notify_refund_workflow(f.guest_id,'Cancellation refund recalculated',
    format('Verified cancellation refund: PHP %s; retained deposit: PHP %s. Manager documentation: %s. A positive refund requires a new review and approval.',q->>'refundableAmount',q->>'deduction',trim(p_reason)), 'refund_request',p_id);
end $$;

create or replace function public.transition_refund_workflow(p_id uuid,p_action text,p_reason text default null,
  p_reference text default null,p_proof text default null,p_method text default 'GCash',p_verified boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare f public.refund_requests%rowtype; v_id uuid; r public.reservations%rowtype;
  v_total numeric; v_available numeric; v_other numeric; v_new text; v_permission text;
begin
  v_permission:=case when p_action='payout_submitted' then 'refund_payout' when p_action='refunded' then 'refund_verify' when p_action in ('approved','rejected') then 'refund_approval' else 'refund_review' end;
  if not public.refund_staff_permission(v_permission) then raise exception 'Refund permission required' using errcode='42501'; end if;
  if p_action in ('approved','rejected') and not exists(select 1 from public.staff_users where id=auth.uid() and role='staff' and is_active) then
    raise exception 'Only an authorized manager can approve or reject refunds' using errcode='42501'; end if;
  select reservation_id into v_id from public.refund_requests where refund_id=p_id;
  if not found then raise exception 'Refund request not found' using errcode='22023'; end if;
  select * into r from public.reservations where reservation_id=v_id for update;
  select total_amount into v_total from public.transactions where reservation_id=v_id for update;
  select * into f from public.refund_requests where refund_id=p_id for update;
  if f.workflow_version=1 and f.request_kind='cancellation' and p_action<>'rejected' then
    raise exception 'A manager must classify and recalculate this legacy cancellation before processing' using errcode='40001'; end if;
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
    if f.payout_submitted_by=auth.uid() then
      raise exception 'Another authorized staff member must verify this payout' using errcode='42501'; end if;
    if f.gcash_reference is null or f.proof_path is null or not exists(select 1 from storage.objects where bucket_id='refund-proofs' and name=f.proof_path) then
      raise exception 'Payout evidence is missing' using errcode='22023'; end if;
    update public.refund_requests set status='refunded',refunded_by=auth.uid(),refunded_at=now(),payout_verification_notes=trim(p_reason) where refund_id=p_id; v_new:='refunded';
  else raise exception 'Invalid refund transition. Refresh the request and complete the preceding step' using errcode='22023'; end if;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(auth.uid(),auth.uid(),'Refund '||v_new,'refund_request',p_id,jsonb_build_object('reservation_id',v_id,'amount',f.amount,
      'old_status',f.status,'new_status',v_new,'reason',p_reason,'reference',coalesce(p_reference,f.gcash_reference),
      'proof',coalesce(p_proof,f.proof_path),'verified',p_verified,
      'same_actor_verification',p_action='refunded' and f.payout_submitted_by=auth.uid()));
  perform public.notify_refund_workflow(f.guest_id,'Refund '||replace(v_new,'_',' '),
    format('Reservation %s: PHP %s refund. %s%s',r.reference_number,f.amount,
      case v_new when 'reviewed' then 'Payment records reviewed; awaiting manager approval.' when 'approved' then 'Approved; awaiting manual transfer through an approved payment method.'
        when 'payout_submitted' then 'Transfer documented; awaiting verification by authorized staff. The refund is not completed yet.'
        when 'refunded' then 'Transfer verified. Refund completed.' else 'Request rejected. ' end,
      case when v_new='rejected' then trim(p_reason) else '' end),'refund_request',p_id);
end $$;

create or replace function public.create_maintenance_block(p_name text, p_reason text, p_start date, p_end date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_day date; v_id uuid; v_actor uuid := auth.uid(); v_announced integer;
begin
  if not exists (select 1 from public.staff_users where id = v_actor and role = 'staff' and is_active and public.refund_staff_permission('edit_reservation')) then
    raise exception 'Only an authorized manager may create maintenance blocks' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 120 or
     length(trim(coalesce(p_reason, ''))) not between 1 and 2000 or
     p_start is null or p_end is null or p_end < p_start or p_end > p_start + 365 then
    raise exception 'Invalid maintenance block' using errcode = '22023';
  end if;
  for v_day in select generate_series(p_start, p_end, interval '1 day')::date order by 1 loop
    perform pg_advisory_xact_lock(424242, hashtext(v_day::text));
  end loop;
  perform public.expire_unpaid_reservations();
  if exists (select 1 from public.reservations r where r.status in
    ('pending', 'payment_submitted', 'confirmed', 'reschedule_requested') and
    daterange((r.start_datetime at time zone 'Asia/Manila')::date,
      (r.end_datetime at time zone 'Asia/Manila')::date +
      case when (r.end_datetime at time zone 'Asia/Manila')::time = time '00:00:00' then 0 else 1 end, '[)')
      && daterange(p_start, p_end + 1, '[)')) then
    raise exception 'An active reservation occupies this date' using errcode = '23P01';
  end if;
  insert into public.maintenance_blocks(name, reason, start_date, end_date, created_by)
  values(trim(p_name), trim(p_reason), p_start, p_end, v_actor) returning block_id into v_id;
  insert into public.notifications(recipient_role, recipient_id, actor_id, title, message, action_url, entity_type, entity_id)
    select 'guest', g.id, v_actor, 'Resort maintenance: ' || trim(p_name),
      p_start::text || ' to ' || p_end::text || ': ' || trim(p_reason) ||
      ' Bookings are unavailable on these dates.', '/booking', 'maintenance_block', v_id
    from public.guests g;
  get diagnostics v_announced = row_count;
  insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id, details)
  values(v_actor, v_actor, 'Created maintenance block', 'maintenance_block', v_id,
    jsonb_build_object('name', trim(p_name), 'reason', trim(p_reason), 'start_date', p_start, 'end_date', p_end,
      'guest_alerts_sent', v_announced));
  return v_id;
end $$;

create or replace function public.release_maintenance_block(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_block public.maintenance_blocks%rowtype; v_actor uuid := auth.uid();
begin
  if not exists (select 1 from public.staff_users where id = v_actor and role = 'staff' and is_active and public.refund_staff_permission('edit_reservation')) then
    raise exception 'Only an authorized manager may release maintenance blocks' using errcode = '42501';
  end if;
  select * into v_block from public.maintenance_blocks where block_id = p_id for update;
  if not found or v_block.status <> 'active' then raise exception 'Active block not found' using errcode = '22023'; end if;
  update public.maintenance_blocks set status = 'released', released_by = v_actor, released_at = now() where block_id = p_id;
  insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id, details)
  values(v_actor, v_actor, 'Released maintenance block', 'maintenance_block', p_id,
    jsonb_build_object('name', v_block.name, 'start_date', v_block.start_date, 'end_date', v_block.end_date));
end $$;


-- Keep configuration/catalog/account policies intact; only operational proof uploads change.
drop policy if exists "Staff upload refund proof" on storage.objects;
create policy "Staff upload refund proof" on storage.objects for insert to authenticated
with check(bucket_id='refund-proofs' and public.refund_staff_permission('refund_payout'));

drop policy if exists "Staff read refund proof" on storage.objects;
create policy "Staff read refund proof" on storage.objects for select to authenticated using(bucket_id='refund-proofs' and exists
  (select 1 from public.staff_users s where s.id=auth.uid() and s.is_active and (s.role='admin' or exists
    (select 1 from public.role_permissions rp where rp.role=s.role and rp.permissions && array['refund_review','refund_approval','refund_payout','refund_verify']))));

revoke all on function public.get_cancellation_preview(uuid,text) from public,anon;
grant execute on function public.get_cancellation_preview(uuid,text) to authenticated;
revoke all on function public.recalculate_legacy_cancellation_refund(uuid,text,text) from public,anon;
grant execute on function public.recalculate_legacy_cancellation_refund(uuid,text,text) to authenticated;
revoke all on function public.transition_refund_workflow(uuid,text,text,text,text,text,boolean) from public,anon;
grant execute on function public.transition_refund_workflow(uuid,text,text,text,text,text,boolean) to authenticated;
revoke all on function public.create_maintenance_block(text,text,date,date) from public,anon;
grant execute on function public.create_maintenance_block(text,text,date,date) to authenticated;
revoke all on function public.release_maintenance_block(uuid) from public,anon;
grant execute on function public.release_maintenance_block(uuid) to authenticated;
notify pgrst,'reload schema';
commit;

-- Reviews no longer require completed reservations
-- Apply after review-feedback-management and stay-completion migrations.
-- Active guests can review without a completed stay or any reservation.
-- Preserve ownership checks, cooldowns, quotas and duplicate-review rules.
begin;

drop trigger if exists guard_review_completed_stay on public.reviews;

create or replace function public.guard_review_reservation_owner()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.reservation_id is not null and not exists(select 1 from public.reservations r
    where r.reservation_id=new.reservation_id and r.guest_id=new.guest_id) then
    raise exception 'Linked reservations must belong to this guest' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_review_reservation_owner() from public,anon,authenticated;
drop trigger if exists guard_review_reservation_owner on public.reviews;
create trigger guard_review_reservation_owner before insert or update of reservation_id,guest_id on public.reviews
for each row execute function public.guard_review_reservation_owner();

create or replace function public.review_submission_status(p_title text,p_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.guests where id=auth.uid() and is_active) then
    raise exception 'An active guest account is required' using errcode='42501'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 or p_text is null or length(btrim(p_text)) not between 50 and 5000 then
    raise exception 'Enter a title of 1-200 characters and review text of 50-5000 characters' using errcode='22023'; end if;
  return public.review_submission_policy(auth.uid(),p_title,p_text);
end $$;
revoke all on function public.review_submission_status(text,text) from public,anon;
grant execute on function public.review_submission_status(text,text) to authenticated;

notify pgrst,'reload schema';
commit;

-- Automatic approval for new consistent OCR payment submissions
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
-- Apply after admin-read-only-manager-refunds-migration.sql.
-- Correct existing and future notification titles without changing refund status.
begin;
create or replace function public.notify_refund_workflow(p_guest uuid,p_title text,p_message text,p_entity text,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_title text:=case when lower(btrim(p_title))='refund refunded' then 'Refund completed' else p_title end;
begin
  if p_guest is not null then
    insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
      values('guest',p_guest,auth.uid(),v_title,p_message,'/manage',p_entity,p_id);
  end if;
  insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
    select s.role,s.id,auth.uid(),v_title,p_message,'/admin/transactions?tab=refunds',p_entity,p_id
    from public.staff_users s where s.is_active and (s.role in ('admin','cashier') or exists
      (select 1 from public.role_permissions rp where rp.role=s.role and
        rp.permissions && array['refund_review','refund_approval','refund_payout','refund_verify']));
end $$;
revoke all on function public.notify_refund_workflow(uuid,text,text,text,uuid) from public,anon,authenticated;
update public.notifications set title='Refund completed' where lower(btrim(title))='refund refunded';
notify pgrst,'reload schema';
commit;
-- Apply after reservation, billing, refund and guest-reschedule migrations.
-- Enrich both existing and future booking notifications without changing recipients.
begin;
create or replace function public.add_notification_customer_name()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_res uuid; v_ref text; v_name text; v_label text; v_candidate text;
begin
  case new.entity_type
    when 'reservation' then v_res:=new.entity_id;
    when 'payment' then select reservation_id into v_res from public.payments where payment_id=new.entity_id;
    when 'refund_request' then select reservation_id into v_res from public.refund_requests where refund_id=new.entity_id;
    when 'reservation_reschedule' then select reservation_id into v_res from public.reservation_reschedules where reschedule_id=new.entity_id;
    when 'transaction' then select reservation_id into v_res from public.transactions where transaction_id=new.entity_id;
    when 'invoice' then select reservation_id into v_res from public.invoices where invoice_id=new.entity_id;
    when 'receipt' then select p.reservation_id into v_res from public.receipts c join public.payments p on p.payment_id=c.payment_id where c.receipt_id=new.entity_id;
    else null;
  end case;
  -- Some historical notifications have no entity link, only a booking reference.
  if v_res is null then
    v_candidate:=substring(concat_ws(' ',new.title,new.message) from '\m(?:SR|MV)-[A-Z0-9-]+\M');
    if v_candidate is not null then
      select reservation_id into v_res from public.reservations where reference_number=v_candidate;
    end if;
  end if;
  if v_res is null then return new; end if;
  select r.reference_number,nullif(btrim(concat_ws(' ',coalesce(g.first_name,w.first_name),coalesce(g.middle_name,w.middle_name),coalesce(g.last_name,w.last_name))),'')
    into v_ref,v_name
    from public.reservations r left join public.guests g on g.id=r.guest_id
    left join public.walk_in_guests w on w.walk_in_guest_id=r.walk_in_guest_id
    where r.reservation_id=v_res and (auth.uid() is null or r.guest_id=auth.uid()
      or exists(select 1 from public.staff_users where id=auth.uid() and is_active));
  if v_ref is null or v_name is null then return new; end if;
  v_label:=v_name||' ('||v_ref||')';
  if position(v_label in new.title)=0 then new.title:=replace(new.title,v_ref,v_label); end if;
  if position(v_label in coalesce(new.message,''))=0 then
    if position(v_ref in coalesce(new.message,''))>0 then new.message:=replace(new.message,v_ref,v_label);
    else new.message:=v_label||case when coalesce(new.message,'')<>'' then E'\n'||new.message else '' end; end if;
  end if;
  return new;
end $$;
revoke all on function public.add_notification_customer_name() from public,anon,authenticated;
drop trigger if exists notification_customer_name on public.notifications;
create trigger notification_customer_name before insert or update of title,message,entity_type,entity_id
  on public.notifications for each row execute function public.add_notification_customer_name();
update public.notifications set message=message;
notify pgrst,'reload schema';
commit;
-- Apply after ocular-review and admin-read-only-manager-refunds migrations.
begin;
alter table public.ocular_visits add column if not exists cancellation_reason text;
alter table public.ocular_visits add column if not exists cancelled_at timestamptz;
alter table public.ocular_visits add column if not exists cancelled_by uuid references public.staff_users(id);

create or replace function public.guard_manager_ocular_cancellation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.role() in ('anon','authenticated') and (new.cancelled_by is distinct from old.cancelled_by
    or (exists(select 1 from public.staff_users where id=auth.uid()) and
      (new.status is distinct from old.status or new.cancellation_reason is distinct from old.cancellation_reason or new.cancelled_at is distinct from old.cancelled_at))) then
    raise exception 'Use the manager ocular cancellation action' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_manager_ocular_cancellation() from public,anon,authenticated;
drop trigger if exists guard_manager_ocular_cancellation on public.ocular_visits;
create trigger guard_manager_ocular_cancellation before update of status,cancellation_reason,cancelled_at,cancelled_by on public.ocular_visits
  for each row execute function public.guard_manager_ocular_cancellation();

create or replace function public.cancel_manager_ocular_visit(p_visit uuid,p_reason text,p_staff uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_visit public.ocular_visits%rowtype;
begin
  if not exists(select 1 from public.staff_users s where s.id=p_staff and s.role='staff' and s.is_active
    and exists(select 1 from public.role_permissions rp where rp.role=s.role and 'ocular_approval'=any(rp.permissions))) then
    raise exception 'Manager ocular approval permission required' using errcode='42501'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 5 and 2000 then
    raise exception 'Enter a cancellation reason of 5 to 2000 characters' using errcode='22023'; end if;
  select * into v_visit from public.ocular_visits where visit_id=p_visit for update;
  if not found then raise exception 'Ocular visit not found' using errcode='P0002'; end if;
  if v_visit.status='cancelled' and v_visit.cancelled_by=p_staff and v_visit.cancellation_reason=btrim(p_reason) then
    return to_jsonb(v_visit)||jsonb_build_object('alreadyCancelled',true); end if;
  if v_visit.status not in ('pending','confirmed') then
    raise exception 'Only pending or confirmed ocular visits can be cancelled. Refresh the visit' using errcode='40001'; end if;
  update public.ocular_visits set status='cancelled',cancellation_reason=btrim(p_reason),cancelled_at=clock_timestamp(),cancelled_by=p_staff
    where visit_id=p_visit returning * into v_visit;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff,p_staff,'Cancelled ocular visit','ocular_visit',p_visit,
      jsonb_build_object('reference_number',v_visit.reference_number,'reason',v_visit.cancellation_reason,'scheduled_date',v_visit.scheduled_date));
  return to_jsonb(v_visit)||jsonb_build_object('alreadyCancelled',false);
end $$;
revoke all on function public.cancel_manager_ocular_visit(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.cancel_manager_ocular_visit(uuid,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;


-- Additional service photos
-- Apply before deploying service photos in Business Catalog and booking.
-- Uses the same admin-only upload endpoint and public bucket as website images.
begin;
alter table public.services add column if not exists image_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-content', 'site-content', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
commit;


-- Apply after reschedule-policy, stay-completion and admin-read-only-manager-refunds.
-- New reservations must start in the future; offline email is optional.
-- Authorized operational staff can update guest counts during an active stay.
begin;
alter table public.walk_in_guests alter column email drop not null;

create or replace function public.guard_new_reservation_start()
returns trigger language plpgsql set search_path='' as $$
begin
  -- timestamptz compares instants. Application package clocks use Asia/Manila.
  if new.start_datetime is null or not isfinite(new.start_datetime)
    or new.start_datetime <= clock_timestamp() then
    raise exception 'The selected package has already started. Choose a future start time (Philippine time)' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function public.guard_new_reservation_start() from public,anon,authenticated;
drop trigger if exists guard_new_reservation_start on public.reservations;
create trigger guard_new_reservation_start before insert on public.reservations
  for each row execute function public.guard_new_reservation_start();

create or replace function public.edit_staff_reservation(
  p_reservation uuid, p_staff uuid, p_expected jsonb, p_patch jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_r public.reservations%rowtype;
  v_t public.transactions%rowtype;
  v_old_services jsonb;
  v_old_units jsonb;
  v_item jsonb;
  v_existing public.reservation_services%rowtype;
  v_catalog public.services%rowtype;
  v_unit public.units%rowtype;
  v_unit_id uuid;
  v_old_unit_id uuid;
  v_seen uuid[] := array[]::uuid[];
  v_service uuid;
  v_quantity integer;
  v_details_changed boolean;
  v_unit_changed boolean;
  v_start timestamptz;
  v_end timestamptz;
  v_old_services_total numeric;
  v_new_services_total numeric;
  v_total numeric(10,2);
  v_paid numeric(10,2);
  v_status text;
begin
  -- Only the server can execute this function or supply a package price delta.
  -- Recheck the actor's grant inside the same database transaction.
  if not exists (select 1 from public.staff_users s where s.id = p_staff and s.is_active
    and s.role <> 'admin' and exists (select 1 from public.role_permissions rp
      where rp.role = s.role and 'edit_reservation' = any(rp.permissions))) then
    raise exception 'You do not have permission to edit reservations' using errcode = '42501';
  end if;
  select * into v_r from public.reservations where reservation_id = p_reservation for update;
  if not found then raise exception 'Reservation not found' using errcode = '22023'; end if;
  select * into v_t from public.transactions where reservation_id = p_reservation for update;
  if not found then raise exception 'Reservation bill not found' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('serviceId', service_id, 'quantity', quantity, 'price', price_at_time)
    order by service_id), '[]'::jsonb), coalesce(sum(quantity * price_at_time), 0)
    into v_old_services, v_old_services_total from public.reservation_services where reservation_id = p_reservation;
  select coalesce(jsonb_agg(jsonb_build_object('unitId', unit_id, 'quantity', quantity, 'price', price_per_night)
    order by unit_id), '[]'::jsonb) into v_old_units from public.reservation_units where reservation_id = p_reservation;
  if v_r.updated_at is distinct from (p_expected->>'updatedAt')::timestamptz
    or v_t.total_amount is distinct from (p_expected->>'totalAmount')::numeric
    or coalesce(v_t.paid_amount, 0) is distinct from (p_expected->>'paidAmount')::numeric
    or v_old_services is distinct from p_expected->'services'
    or v_old_units is distinct from p_expected->'units' then
    raise exception 'This reservation or bill changed. Reload it before saving' using errcode = '40001';
  end if;
  if v_r.status not in ('pending', 'confirmed') or v_r.checked_out_at is not null
    or (v_r.end_datetime <= now() and v_r.checked_in_at is null)
    or (v_r.status = 'pending' and v_r.payment_deadline_at <= now()) then
    raise exception 'This reservation is no longer editable' using errcode = '40001';
  end if;
  if exists (select 1 from public.payments where reservation_id = p_reservation and status = 'pending')
    or exists (select 1 from public.reservation_reschedules where reservation_id = p_reservation and status = 'pending') then
    raise exception 'Resolve pending payments or reschedule requests before editing' using errcode = '40001';
  end if;
  if length(trim(coalesce(p_patch->>'reason', ''))) = 0 or length(p_patch->>'reason') > 1000
    or jsonb_typeof(p_patch->'services') is distinct from 'array' or jsonb_array_length(p_patch->'services') > 100 then
    raise exception 'Provide a reason and valid service list' using errcode = '22023';
  end if;
  v_start := (p_patch->>'startDatetime')::timestamptz;
  v_end := (p_patch->>'endDatetime')::timestamptz;
  if v_start is null or v_end is null or v_end <= v_start or
    (p_patch->>'adultCount')::integer < 1 or (p_patch->>'childCount')::integer < 0 or
    (p_patch->>'adultCount')::integer + (p_patch->>'childCount')::integer > 30 then
    raise exception 'Invalid schedule or guest counts' using errcode = '22023';
  end if;
  if v_start is distinct from v_r.start_datetime or v_end is distinct from v_r.end_datetime
    or p_patch->>'bookingMode' is distinct from coalesce(v_r.booking_mode,'day') then
    raise exception 'Schedule changes must use the reschedule policy workflow' using errcode='22023'; end if;
  v_details_changed := v_r.start_datetime <> v_start or v_r.end_datetime <> v_end
    or v_r.booking_mode is distinct from p_patch->>'bookingMode'
    or v_r.adult_count <> (p_patch->>'adultCount')::integer or v_r.child_count <> (p_patch->>'childCount')::integer;
  v_unit_id := (p_patch->>'unitId')::uuid;
  if jsonb_array_length(v_old_units) = 1 and (v_old_units->0->>'quantity')::integer = 1 then
    v_old_unit_id := (v_old_units->0->>'unitId')::uuid;
  end if;
  v_unit_changed := v_old_unit_id is distinct from v_unit_id;
  -- The schedule above stays fixed. Guest counts remain editable during an
  -- active checked-in stay; accommodation changes remain locked after arrival.
  if v_unit_changed and (v_r.checked_in_at is not null or v_r.start_datetime <= now()) then
    raise exception 'The stay has started. Accommodation cannot be changed' using errcode = '40001';
  end if;
  if not v_details_changed and coalesce((p_patch->>'packageDelta')::numeric, 0) <> 0 then
    raise exception 'Invalid package adjustment' using errcode = '22023';
  end if;
  if v_unit_changed then
    if jsonb_array_length(v_old_units) > 1 or exists (select 1 from public.reservation_units
      where reservation_id = p_reservation and quantity <> 1) then
      raise exception 'Multiple accommodations require individual billing review' using errcode = '22023';
    end if;
    select * into v_unit from public.units where unit_id = v_unit_id and is_active and archived_at is null for share;
    if not found then raise exception 'Selected accommodation is unavailable' using errcode = '22023'; end if;
  end if;
  -- Validate and lock catalog prices before modifying any booking rows.
  for v_item in select value from jsonb_array_elements(p_patch->'services') loop
    v_service := (v_item->>'serviceId')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_service is null or v_quantity is null or v_quantity < 1 or v_quantity > 10000 or v_service = any(v_seen) then
      raise exception 'Invalid service or quantity' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_service);
    select * into v_existing from public.reservation_services where reservation_id = p_reservation and service_id = v_service;
    if found then
      if (v_r.checked_in_at is not null or v_r.start_datetime <= now()) and v_quantity < v_existing.quantity then
        raise exception 'Services cannot be reduced during a stay' using errcode = '22023';
      end if;
      if v_existing.price_at_time is distinct from (v_item->>'price')::numeric then
        raise exception 'Service price changed. Reload the reservation' using errcode = '40001';
      end if;
    else
      select * into v_catalog from public.services where service_id = v_service and is_active for share;
      if not found then raise exception 'Selected service is unavailable' using errcode = '22023'; end if;
      if v_catalog.price is distinct from (v_item->>'price')::numeric then
        raise exception 'Service price changed. Reload the reservation' using errcode = '40001';
      end if;
    end if;
  end loop;
  if (v_r.checked_in_at is not null or v_r.start_datetime <= now()) and exists (select 1 from public.reservation_services
    where reservation_id = p_reservation and not (service_id = any(v_seen))) then
    raise exception 'Services cannot be removed during a stay' using errcode = '22023';
  end if;
  -- Date constraints and the existing maintenance trigger remain authoritative.
  -- Updating a note alone does not run schedule or package recalculation triggers.
  if v_details_changed then
    update public.reservations set start_datetime = v_start, end_datetime = v_end,
      booking_mode = p_patch->>'bookingMode', adult_count = (p_patch->>'adultCount')::integer,
      child_count = (p_patch->>'childCount')::integer, special_requests = nullif(p_patch->>'specialRequests', ''), updated_at = now()
      where reservation_id = p_reservation;
  else
    update public.reservations set special_requests = nullif(p_patch->>'specialRequests', ''), updated_at = now()
      where reservation_id = p_reservation;
  end if;
  if v_unit_changed then
    delete from public.reservation_units where reservation_id = p_reservation;
    insert into public.reservation_units(reservation_id, unit_id, quantity, price_per_night)
      values(p_reservation, v_unit_id, 1, v_unit.base_price);
  end if;
  delete from public.reservation_services where reservation_id = p_reservation and not (service_id = any(v_seen));
  for v_item in select value from jsonb_array_elements(p_patch->'services') loop
    insert into public.reservation_services(reservation_id, service_id, quantity, price_at_time)
      values(p_reservation, (v_item->>'serviceId')::uuid, (v_item->>'quantity')::integer, (v_item->>'price')::numeric)
      on conflict(reservation_id, service_id) do update set quantity = excluded.quantity
      where public.reservation_services.quantity <> excluded.quantity;
  end loop;
  select coalesce(sum(quantity * price_at_time), 0) into v_new_services_total
    from public.reservation_services where reservation_id = p_reservation;
  -- Override intermediate legacy trigger totals with the captured bill + deltas.
  v_total := round(v_t.total_amount + (p_patch->>'packageDelta')::numeric + v_new_services_total - v_old_services_total, 2);
  if v_total < 0 or v_total is distinct from (p_patch->>'expectedTotal')::numeric then
    raise exception 'Bill changed. Reload to review the updated amount' using errcode = '40001';
  end if;
  v_paid := coalesce(v_t.paid_amount, 0);
  v_status := case when v_paid >= v_total then 'paid' when v_paid > 0 then 'partial' else 'unpaid' end;
  update public.transactions set total_amount = v_total, paid_amount = v_paid, status = v_status where reservation_id = p_reservation;
  update public.invoices set total_amount = v_total,
    status = case when v_paid >= v_total then 'paid' when v_paid > 0 then 'partially_paid' else 'issued' end
    where invoice_id = (select invoice_id from public.invoices where reservation_id = p_reservation and status <> 'void'
      order by created_at desc, invoice_id desc limit 1);
  insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id, details)
    values(p_staff, p_staff, 'Edited reservation and bill', 'reservation', p_reservation,
      jsonb_build_object('reference_number', v_r.reference_number, 'reason', p_patch->>'reason',
        'before', to_jsonb(v_r), 'before_bill', to_jsonb(v_t), 'before_services', v_old_services, 'before_units', v_old_units,
        'guest_count_changed', v_r.adult_count is distinct from (p_patch->>'adultCount')::integer or v_r.child_count is distinct from (p_patch->>'childCount')::integer,
        'after_check_in', v_r.checked_in_at is not null,
        'after', p_patch - 'version', 'new_total', v_total, 'paid_amount', v_paid,
        'balance', greatest(v_total - v_paid, 0), 'overpaid_amount', greatest(v_paid - v_total, 0)));
  return jsonb_build_object('totalAmount', v_total, 'paidAmount', v_paid, 'remainingBalance', greatest(v_total - v_paid, 0),
    'overpaidAmount', greatest(v_paid - v_total, 0), 'status', v_status);
end $$;
revoke all on function public.edit_staff_reservation(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.edit_staff_reservation(uuid,uuid,jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;


-- timed-maintenance-auto-ocular-migration.sql
-- Apply after reservation-management-improvements, guest-auto-reschedule,
-- manager-ocular-cancellation and admin-read-only-manager-refunds migrations.
-- Existing date blocks remain whole days in Philippine time; historical pending
-- ocular requests retain their records. Eligible future requests become confirmed.
begin;
alter table public.maintenance_blocks add column if not exists start_datetime timestamptz;
alter table public.maintenance_blocks add column if not exists end_datetime timestamptz;
update public.maintenance_blocks set
  start_datetime=start_date::timestamp at time zone 'Asia/Manila',
  end_datetime=(end_date+1)::timestamp at time zone 'Asia/Manila'
where start_datetime is null or end_datetime is null;
alter table public.maintenance_blocks alter column start_datetime set not null;
alter table public.maintenance_blocks alter column end_datetime set not null;
alter table public.maintenance_blocks drop constraint if exists maintenance_time_range;
alter table public.maintenance_blocks add constraint maintenance_time_range check(
  isfinite(start_datetime) and isfinite(end_datetime) and end_datetime>start_datetime
  and end_datetime<=start_datetime+interval '366 days'
  and start_date=(start_datetime at time zone 'Asia/Manila')::date
  and end_date=((end_datetime-interval '1 microsecond') at time zone 'Asia/Manila')::date);
alter table public.maintenance_blocks drop constraint if exists no_overlapping_maintenance_blocks;
alter table public.maintenance_blocks add constraint no_overlapping_maintenance_blocks
  exclude using gist(tstzrange(start_datetime,end_datetime,'[)') with &&) where(status='active');

-- Admin maintenance is an explicit exception to operational read-only access.
-- All writes use the RPCs below; the other operational-table guards stay intact.
drop trigger if exists guard_admin_operational_write on public.maintenance_blocks;
create or replace function public.guard_maintenance_write()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated') then
    raise exception 'Use the authorized maintenance action' using errcode='42501'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
drop trigger if exists guard_maintenance_write on public.maintenance_blocks;
create trigger guard_maintenance_write before insert or update or delete on public.maintenance_blocks
for each row execute function public.guard_maintenance_write();

create or replace function public.reject_maintenance_booking()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_day date;
begin
  if new.status in ('pending','payment_submitted','confirmed','reschedule_requested') then
    for v_day in select generate_series((new.start_datetime at time zone 'Asia/Manila')::date,
      ((new.end_datetime-interval '1 microsecond') at time zone 'Asia/Manila')::date,interval '1 day')::date order by 1 loop
      perform pg_advisory_xact_lock(424242,hashtext(v_day::text));
    end loop;
    if exists(select 1 from public.maintenance_blocks where status='active'
      and start_datetime<new.end_datetime and end_datetime>new.start_datetime) then
      raise exception 'This time is unavailable due to maintenance' using errcode='23P01'; end if;
  end if;
  return new;
end $$;

create or replace function public.create_timed_maintenance_block(p_name text,p_reason text,p_start timestamptz,p_end timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_day date; v_id uuid; v_actor uuid:=auth.uid();
begin
  if not exists(select 1 from public.staff_users s where s.id=v_actor and s.is_active and
    (s.role='admin' or (s.role='staff' and public.refund_staff_permission('edit_reservation')))) then
    raise exception 'Administrator or authorized manager required' using errcode='42501'; end if;
  if length(trim(coalesce(p_name,''))) not between 1 and 120 or length(trim(coalesce(p_reason,''))) not between 1 and 2000
    or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
    or p_end<=p_start or p_end>p_start+interval '366 days' then
    raise exception 'Enter a valid maintenance period, name and internal reason' using errcode='22023'; end if;
  for v_day in select generate_series((p_start at time zone 'Asia/Manila')::date,
    ((p_end-interval '1 microsecond') at time zone 'Asia/Manila')::date,interval '1 day')::date order by 1 loop
    perform pg_advisory_xact_lock(424242,hashtext(v_day::text));
  end loop;
  -- Ignore expired pending bookings without writing unrelated operational rows.
  if exists(select 1 from public.reservations where status in ('pending','payment_submitted','confirmed','reschedule_requested')
    and (status<>'pending' or payment_deadline_at is null or payment_deadline_at>clock_timestamp())
    and start_datetime<p_end and end_datetime>p_start) then
    raise exception 'An active reservation overlaps this period' using errcode='23P01'; end if;
  if exists(select 1 from public.ocular_visits v join public.ocular_time_slots s on s.slot_id=v.time_slot_id
    where v.status in ('pending','confirmed')
    and ((v.scheduled_date+s.start_time) at time zone 'Asia/Manila')<p_end
    and ((v.scheduled_date+s.end_time) at time zone 'Asia/Manila')>p_start) then
    raise exception 'An ocular visit overlaps this period. Cancel it before blocking this time' using errcode='23P01'; end if;
  insert into public.maintenance_blocks(name,reason,start_date,end_date,start_datetime,end_datetime,created_by)
    values(trim(p_name),trim(p_reason),(p_start at time zone 'Asia/Manila')::date,
      ((p_end-interval '1 microsecond') at time zone 'Asia/Manila')::date,p_start,p_end,v_actor) returning block_id into v_id;
  insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
    select 'guest',id,v_actor,'Scheduled maintenance',
      format('The resort is unavailable due to maintenance from %s to %s (Philippine time).',
        to_char(p_start at time zone 'Asia/Manila','YYYY-MM-DD HH24:MI'),to_char(p_end at time zone 'Asia/Manila','YYYY-MM-DD HH24:MI')),
      '/booking','maintenance_block',v_id from public.guests;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(v_actor,v_actor,'Created maintenance block','maintenance_block',v_id,
      jsonb_build_object('name',trim(p_name),'reason',trim(p_reason),'start_datetime',p_start,'end_datetime',p_end));
  return v_id;
end $$;
-- Retire the date-only write entry point so old callers cannot reintroduce leaks.
drop function if exists public.create_maintenance_block(text,text,date,date);
create or replace function public.release_maintenance_block(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_block public.maintenance_blocks%rowtype; v_actor uuid:=auth.uid();
begin
  if not exists(select 1 from public.staff_users s where s.id=v_actor and s.is_active and
    (s.role='admin' or (s.role='staff' and public.refund_staff_permission('edit_reservation')))) then
    raise exception 'Administrator or authorized manager required' using errcode='42501'; end if;
  select * into v_block from public.maintenance_blocks where block_id=p_id for update;
  if not found or v_block.status<>'active' then raise exception 'Active block not found' using errcode='22023'; end if;
  update public.maintenance_blocks set status='released',released_by=v_actor,released_at=clock_timestamp() where block_id=p_id;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(v_actor,v_actor,'Released maintenance block','maintenance_block',p_id,to_jsonb(v_block));
end $$;
-- Remove historical customer notification disclosures, too.
update public.notifications set title='Scheduled maintenance',
  message='The resort is unavailable during the scheduled maintenance period. Check the booking calendar for available times.'
where recipient_role='guest' and entity_type='maintenance_block';

-- All new and moved visits are confirmed under the same day lock as maintenance.
-- SECURITY DEFINER makes capacity counts independent of guest row visibility.
create or replace function public.guard_ocular_review_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare s public.ocular_time_slots%rowtype; v_start timestamptz; v_end timestamptz;
begin
  if auth.role() in ('anon','authenticated') and (auth.uid() is null or new.guest_id is distinct from auth.uid()) then
    raise exception 'The active visit owner is required' using errcode='42501'; end if;
  if tg_op='UPDATE' then
    if new.guest_id is distinct from old.guest_id or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at or new.review_reason is distinct from old.review_reason then
      raise exception 'Ocular ownership and historical review records cannot be changed' using errcode='42501'; end if;
    if old.status not in ('pending','confirmed') and (new.status is distinct from old.status
      or new.scheduled_date is distinct from old.scheduled_date or new.time_slot_id is distinct from old.time_slot_id) then
      raise exception 'Closed visits cannot be changed' using errcode='40001'; end if;
    if new.status='rejected' and new.status is distinct from old.status then
      raise exception 'Ocular visits no longer require approval or rejection' using errcode='22023'; end if;
    if new.status='completed' and new.status is distinct from old.status then
      if auth.role() is distinct from 'service_role' or auth.uid() is not null then
        raise exception 'Use the authorized mark visited action' using errcode='42501'; end if;
    end if;
  else
    if new.status not in ('pending','confirmed') or new.reviewed_at is not null or new.reviewed_by is not null or new.review_reason is not null then
      raise exception 'New visits must use automatic confirmation' using errcode='22023'; end if;
  end if;
  if tg_op='INSERT' or (new.status in ('pending','confirmed') and
    (new.scheduled_date is distinct from old.scheduled_date or new.time_slot_id is distinct from old.time_slot_id or new.status is distinct from old.status)) then
    if tg_op='UPDATE' and old.status not in ('pending','confirmed') then
      raise exception 'Closed visits cannot be rescheduled' using errcode='40001'; end if;
    if not exists(select 1 from public.guests where id=new.guest_id and is_active) then
      raise exception 'An active guest is required' using errcode='42501'; end if;
    perform pg_advisory_xact_lock(424242,hashtext(new.scheduled_date::text));
    select * into s from public.ocular_time_slots where slot_id=new.time_slot_id and is_active for share;
    if not found or s.start_time<time '08:00' or s.end_time>time '17:00' or s.end_time<=s.start_time then
      raise exception 'Choose an available ocular slot between 8 AM and 5 PM' using errcode='22023'; end if;
    v_start:=(new.scheduled_date+s.start_time) at time zone 'Asia/Manila';
    v_end:=(new.scheduled_date+s.end_time) at time zone 'Asia/Manila';
    if v_start<clock_timestamp()+interval '30 minutes' then
      raise exception 'Choose a visit at least 30 minutes from now' using errcode='22023'; end if;
    if exists(select 1 from public.maintenance_blocks where status='active' and start_datetime<v_end and end_datetime>v_start) then
      raise exception 'This time is unavailable due to maintenance' using errcode='23P01'; end if;
    if (select count(*) from public.ocular_visits where scheduled_date=new.scheduled_date and time_slot_id=new.time_slot_id
      and status in ('pending','confirmed') and visit_id<>new.visit_id)>=coalesce(s.max_capacity,1) then
      raise exception 'This ocular time slot is full' using errcode='23P01'; end if;
    if exists(select 1 from public.ocular_visits where scheduled_date=new.scheduled_date and guest_id=new.guest_id
      and status in ('pending','confirmed') and visit_id<>new.visit_id) then
      raise exception 'You already have an ocular visit on this date' using errcode='23505'; end if;
    new.status:='confirmed';
  end if;
  return new;
end $$;
-- Pending requests already reserve capacity. Confirm only those still eligible;
-- leave past or conflicting historical requests intact for staff follow-up.
update public.ocular_visits v set status='confirmed'
from public.ocular_time_slots s where v.time_slot_id=s.slot_id and v.status='pending' and s.is_active
  and s.start_time>=time '08:00' and s.end_time<=time '17:00' and s.end_time>s.start_time
  and ((v.scheduled_date+s.start_time) at time zone 'Asia/Manila')>clock_timestamp()+interval '30 minutes'
  and exists(select 1 from public.guests g where g.id=v.guest_id and g.is_active)
  and not exists(select 1 from public.maintenance_blocks b where b.status='active'
    and b.start_datetime<((v.scheduled_date+s.end_time) at time zone 'Asia/Manila')
    and b.end_datetime>((v.scheduled_date+s.start_time) at time zone 'Asia/Manila'))
  and (select count(*) from public.ocular_visits x where x.scheduled_date=v.scheduled_date
    and x.time_slot_id=v.time_slot_id and x.status in ('pending','confirmed'))<=coalesce(s.max_capacity,1)
  and not exists(select 1 from public.ocular_visits x where x.visit_id<>v.visit_id and x.guest_id=v.guest_id
    and x.scheduled_date=v.scheduled_date and x.status in ('pending','confirmed'));
revoke all on function public.review_ocular_visit(uuid,text,text,uuid) from public,anon,authenticated,service_role;

create or replace function public.save_confirmed_ocular_visit(p_guest uuid,p_date date,p_slot uuid,p_reference text,p_visit uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.ocular_visits%rowtype;
begin
  if auth.role() is distinct from 'service_role' or auth.uid() is not null then raise exception 'Server workflow required' using errcode='42501'; end if;
  if p_visit is null then
    insert into public.ocular_visits(guest_id,scheduled_date,time_slot_id,reference_number,status)
      values(p_guest,p_date,p_slot,p_reference,'confirmed') returning * into v;
  else
    select * into v from public.ocular_visits where visit_id=p_visit and guest_id=p_guest for update;
    if not found or v.status not in ('pending','confirmed') then raise exception 'This visit cannot be rescheduled' using errcode='40001'; end if;
    update public.ocular_visits set scheduled_date=p_date,time_slot_id=p_slot,status='confirmed' where visit_id=p_visit returning * into v;
  end if;
  return to_jsonb(v);
end $$;
create or replace function public.complete_ocular_visit(p_visit uuid,p_staff uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.ocular_visits%rowtype; v_start timestamptz;
begin
  if auth.role() is distinct from 'service_role' or auth.uid() is not null or not exists(
    select 1 from public.staff_users s where s.id=p_staff and s.is_active and s.role<>'admin' and exists(
      select 1 from public.role_permissions rp where rp.role=s.role and 'ocular_approval'=any(rp.permissions))) then
    raise exception 'Authorized ocular management permission required' using errcode='42501'; end if;
  select * into v from public.ocular_visits where visit_id=p_visit for update;
  if not found or v.status<>'confirmed' then raise exception 'Only confirmed visits may be marked visited' using errcode='40001'; end if;
  select (v.scheduled_date+start_time) at time zone 'Asia/Manila' into v_start from public.ocular_time_slots where slot_id=v.time_slot_id;
  if v_start is null or v_start>clock_timestamp() then raise exception 'A visit cannot be marked visited before its scheduled time' using errcode='22023'; end if;
  update public.ocular_visits set status='completed' where visit_id=p_visit returning * into v;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff,p_staff,'Marked ocular visit as visited','ocular_visit',p_visit,jsonb_build_object('reference_number',v.reference_number,'visited_at',clock_timestamp()));
  return to_jsonb(v);
end $$;

revoke all on function public.guard_maintenance_write() from public,anon,authenticated;
revoke all on function public.create_timed_maintenance_block(text,text,timestamptz,timestamptz) from public,anon;
grant execute on function public.create_timed_maintenance_block(text,text,timestamptz,timestamptz) to authenticated;
revoke all on function public.release_maintenance_block(uuid) from public,anon;
grant execute on function public.release_maintenance_block(uuid) to authenticated;
revoke all on function public.save_confirmed_ocular_visit(uuid,date,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.save_confirmed_ocular_visit(uuid,date,uuid,text,uuid) to service_role;
revoke all on function public.complete_ocular_visit(uuid,uuid) from public,anon,authenticated;
grant execute on function public.complete_ocular_visit(uuid,uuid) to service_role;
-- Replace the legacy date-only check in the automatic guest reschedule RPC.
create or replace function public.reschedule_guest_reservation(
  p_reservation uuid, p_guest uuid, p_expected jsonb,
  p_new_start timestamptz, p_new_end timestamptz,
  p_notice_fee numeric, p_rate_adjustment numeric, p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_r public.reservations%rowtype;
  v_total numeric; v_paid numeric; v_new_total numeric; v_charge numeric;
  v_policy jsonb; v_at timestamptz; v_id uuid;
  v_day date; v_first date; v_last date;
begin
  if length(trim(coalesce(p_reason,'')))<5 or length(p_reason)>2000 then
    raise exception 'A reschedule reason between 5 and 2000 characters is required' using errcode='22023'; end if;
  select * into v_r from public.reservations where reservation_id=p_reservation for update;
  if not found or v_r.guest_id is distinct from p_guest or p_guest is null
    or (auth.uid() is not null and auth.uid()<>p_guest)
    or not exists(select 1 from public.guests where id=p_guest and is_active=true) then
    raise exception 'An active reservation owner is required' using errcode='42501'; end if;
  if v_r.status<>'confirmed' or v_r.checked_in_at is not null then
    raise exception 'Only confirmed reservations before check-in can be rescheduled' using errcode='40001'; end if;
  if p_expected is null
    or (p_expected->>'startDatetime')::timestamptz is distinct from v_r.start_datetime
    or (p_expected->>'endDatetime')::timestamptz is distinct from v_r.end_datetime
    or (p_expected->>'adultCount')::integer is distinct from v_r.adult_count
    or (p_expected->>'childCount')::integer is distinct from v_r.child_count
    or (p_expected->>'bookingMode') is distinct from v_r.booking_mode
    or (p_expected->>'packageRateVersion')::bigint is distinct from v_r.package_rate_version
    or v_r.package_rate_version is null then
    raise exception 'This reservation changed. Refresh Manage Booking before rescheduling' using errcode='40001'; end if;
  v_at:=clock_timestamp();
  if p_new_start is null or p_new_end is null or not isfinite(p_new_start) or not isfinite(p_new_end)
    or p_new_start<v_at+interval '30 minutes' or p_new_end<=p_new_start
    or p_new_start=v_r.start_datetime or v_r.booking_mode is null
    or p_new_end-p_new_start<>v_r.end_datetime-v_r.start_datetime
    or mod(extract(epoch from p_new_start-v_r.start_datetime),86400)<>0 then
    raise exception 'Keep the booked package, start time and duration and choose another future date' using errcode='22023'; end if;
  if exists(select 1 from public.reservation_reschedules where reservation_id=p_reservation and status='pending')
    or exists(select 1 from public.payments where reservation_id=p_reservation and status='pending')
    or exists(select 1 from public.refund_requests where reservation_id=p_reservation and status in ('pending','reviewed','approved','payout_submitted')) then
    raise exception 'Resolve the pending payment, reschedule or refund review before rescheduling' using errcode='40001'; end if;
  v_policy:=public.reschedule_policy_snapshot(v_r.start_datetime,v_at);
  if p_notice_fee is distinct from (v_policy->>'noticeFee')::numeric
    or p_rate_adjustment is null or p_rate_adjustment<0 or p_rate_adjustment='NaN'::numeric then
    raise exception 'Reschedule quote changed. Refresh before saving' using errcode='40001'; end if;

  -- Use the same Manila-day locks as booking and maintenance creation. The
  -- reservation exclusion constraint remains the final guard against races.
  v_first:=(p_new_start at time zone 'Asia/Manila')::date;
  v_last:=((p_new_end-interval '1 microsecond') at time zone 'Asia/Manila')::date;
  for v_day in select generate_series(v_first,v_last,interval '1 day')::date loop
    perform pg_advisory_xact_lock(424242,hashtext(v_day::text));
  end loop;
  if exists(select 1 from public.maintenance_blocks where status='active' and start_datetime<p_new_end and end_datetime>p_new_start) then
    raise exception 'The selected date is closed for maintenance' using errcode='23P01'; end if;
  if exists(select 1 from public.reservations r where r.reservation_id<>p_reservation
    and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
    and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>v_at)
    and r.start_datetime<p_new_end and r.end_datetime>p_new_start) then
    raise exception 'The selected date has already been reserved' using errcode='23P01'; end if;
  select total_amount,coalesce(paid_amount,0) into v_total,v_paid
    from public.transactions where reservation_id=p_reservation for update;
  if not found then raise exception 'Reservation transaction is missing' using errcode='40001'; end if;
  v_charge:=round(p_notice_fee+p_rate_adjustment,2);
  v_new_total:=v_total+v_charge;

  insert into public.reservation_reschedules(reservation_id,requested_by,old_start,old_end,new_start,new_end,
    reschedule_fee,rate_adjustment,status,approved_by,approved_at,created_at,reason)
    values(p_reservation,p_guest,v_r.start_datetime,v_r.end_datetime,p_new_start,p_new_end,
      p_notice_fee,p_rate_adjustment,'approved',null,v_at,v_at,trim(p_reason)) returning reschedule_id into v_id;
  update public.reservations set start_datetime=p_new_start,end_datetime=p_new_end,status='confirmed'
    where reservation_id=p_reservation;
  -- Restore the captured bill after legacy schedule-recalculation triggers;
  -- preserve all existing payments, service prices, receipts and earlier fees.
  update public.transactions set total_amount=v_new_total,paid_amount=v_paid,
    status=case when v_paid>=v_new_total then 'paid' when v_paid>0 then 'partial' else 'unpaid' end
    where reservation_id=p_reservation;
  update public.invoices set total_amount=v_new_total,
    status=case when v_paid>=v_new_total then 'paid' when v_paid>0 then 'partially_paid' else 'issued' end
    where invoice_id=(select invoice_id from public.invoices where reservation_id=p_reservation and status<>'void'
      order by created_at desc,invoice_id desc limit 1);
  insert into public.audit_logs(auth_user_id,action,entity_type,entity_id,details)
    values(p_guest,'Automatically approved guest reschedule and charged notice fee','reservation_reschedule',v_id,
      jsonb_build_object('automatic_approval',true,'requested_by',p_guest,'requested_at',v_at,
        'notice_fee',p_notice_fee,'rate_adjustment',p_rate_adjustment,'reason',trim(p_reason),'before_total',v_total,'after_total',v_new_total,
        'policy_at_request',v_policy,'old_start',v_r.start_datetime,'old_end',v_r.end_datetime,
        'new_start',p_new_start,'new_end',p_new_end));
  return jsonb_build_object('reservationId',p_reservation,'rescheduleId',v_id,'status','confirmed',
    'startDatetime',p_new_start,'endDatetime',p_new_end,'rescheduleFee',p_notice_fee,'rateAdjustment',p_rate_adjustment,
    'totalAdditional',v_charge,'totalAmount',v_new_total,'paidAmount',v_paid,'remainingBalance',greatest(v_new_total-v_paid,0));
end $$;

notify pgrst,'reload schema';
commit;


-- ocr-toggle-manual-review-migration.sql
-- Apply after ocr-auto-approve-payments and its prerequisites before disabling OCR.
-- No existing payment, receipt or balance is changed by this migration.
begin;
create or replace function public.submit_unscreened_gcash_payment(p_payment jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; t public.transactions%rowtype;
  v_id uuid; v_amount numeric; v_minimum numeric; v_reference text; v_type text; v_now timestamptz:=clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' or auth.uid() is not null then
    raise exception 'Server payment submission required' using errcode='42501'; end if;
  if p_payment is null or jsonb_typeof(p_payment)<>'object' or p_payment->>'ocr_status' is distinct from 'skipped' then
    raise exception 'An explicitly unscreened payment is required' using errcode='22023'; end if;
  select * into r from public.reservations where reservation_id=(p_payment->>'reservation_id')::uuid for update;
  if not found or r.guest_id is null or r.guest_id is distinct from (p_payment->>'guest_id')::uuid
    or not exists(select 1 from public.guests where id=r.guest_id and is_active)
    or split_part(coalesce(p_payment->>'proof_path',''),'/',1)<>r.guest_id::text
    or not exists(select 1 from storage.objects where bucket_id='payment-proofs' and name=p_payment->>'proof_path') then
    raise exception 'An active reservation owner and their uploaded receipt are required' using errcode='42501'; end if;
  select * into t from public.transactions where reservation_id=r.reservation_id for update;
  if not found then raise exception 'Reservation bill not found' using errcode='22023'; end if;
  if r.status not in ('pending','confirmed') or exists(select 1 from public.payments where reservation_id=r.reservation_id and status='pending') then
    raise exception 'Reservation changed or a payment is already pending. Reload your booking' using errcode='40001'; end if;
  if r.status='pending' and (r.payment_deadline_at is null or r.payment_deadline_at<=v_now) then
    raise exception 'Payment deadline has expired' using errcode='P0001'; end if;
  if not exists(select 1 from public.payment_methods where payment_method_id=(p_payment->>'payment_method_id')::uuid
    and is_active and (name||' '||type) ~* '\mg[[:space:]]*cash\M') then
    raise exception 'An active GCash method is required' using errcode='22023'; end if;
  v_amount:=(p_payment->>'amount')::numeric;
  v_reference:=p_payment->>'reference_number'; v_type:=p_payment->>'payment_type';
  if v_amount is null or v_amount='NaN'::numeric or v_amount<=0 or v_amount>99999999.99 or v_amount<>round(v_amount,2)
    or v_reference is null or v_reference !~ '^[0-9]{8,20}$' then
    raise exception 'Enter a valid amount and GCash reference' using errcode='22023'; end if;
  if coalesce(t.balance,0)<=0 then raise exception 'This reservation has no remaining balance' using errcode='40001'; end if;
  if v_type='downpayment' and coalesce(t.paid_amount,0)=0 then v_minimum:=ceil(t.total_amount*100*0.20)/100;
  elsif v_type='full' then v_minimum:=t.balance;
  else raise exception 'Only the outstanding balance can be paid after a verified payment' using errcode='40001'; end if;
  if v_amount<v_minimum then raise exception 'Amount is below the current minimum. Reload the bill' using errcode='40001'; end if;
  -- Null receipt time and not_applicable are the existing manual-review representation.
  -- Never invent OCR evidence or set auto_approved for an unscreened upload.
  insert into public.payments(reservation_id,amount,payment_method_id,payment_type,status,reference_number,
    receipt_paid_at,account_name,account_number,proof_path,ocr_status,ocr_notes,ocr_checked_at,auto_approved)
    values(r.reservation_id,v_amount,(p_payment->>'payment_method_id')::uuid,v_type,'pending',v_reference,
      null,p_payment->>'account_name',p_payment->>'account_number',p_payment->>'proof_path','not_applicable',
      'OCR disabled; receipt and received funds require staff verification.',null,false) returning payment_id into v_id;
  update public.reservations set status='payment_submitted' where reservation_id=r.reservation_id and status='pending';
  select * into r from public.reservations where reservation_id=r.reservation_id;
  select * into t from public.transactions where reservation_id=r.reservation_id;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(null,null,'Submitted payment for manual review','payment',v_id,
      jsonb_build_object('guest_id',r.guest_id,'reservation_id',r.reservation_id,'amount',v_amount,'ocr_skipped',true,'automatic_approval',false));
  return jsonb_build_object('payment_id',v_id,'status','pending','ocr_status','not_applicable','auto_approved',false,
    'reservation_status',r.status,'total_amount',t.total_amount,'paid_amount',t.paid_amount,
    'remaining_balance',t.balance,'overpaid_amount',t.overpaid_amount);
end $$;
revoke all on function public.submit_unscreened_gcash_payment(jsonb) from public,anon,authenticated;
grant execute on function public.submit_unscreened_gcash_payment(jsonb) to service_role;
notify pgrst,'reload schema';
commit;


-- ocr-beta-receipt-reuse-migration.sql
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

-- Apply after account-access-migration.sql. Guest logins lock after four failures for one minute.
begin;
create or replace function public.record_login_attempt(
  p_email text, p_device_id uuid, p_kind text, p_result text, p_user_id uuid default null
)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_locked_until timestamptz;
begin
  if p_kind not in ('guest', 'staff') or p_result not in ('success', 'failed', 'blocked', 'device_conflict', 'denied', 'logout') then
    raise exception 'Invalid login audit event';
  end if;

  if p_result = 'failed' then
    insert into public.login_lock_state(email, failed_attempts, updated_at)
    values (v_email, 0, now()) on conflict (email) do nothing;

    update public.login_lock_state
    set failed_attempts = case when locked_until > now() then failed_attempts when locked_until is not null and locked_until <= now() then 1 else failed_attempts + 1 end,
        locked_until = case
          when locked_until > now() then locked_until
          when (case when locked_until is not null and locked_until <= now() then 1 else failed_attempts + 1 end) >= case when p_kind = 'guest' then 4 else 5 end
          then now() + interval '1 minute' else null end,
        updated_at = now()
    where email = v_email
    returning locked_until into v_locked_until;
  elsif p_result = 'success' then
    delete from public.login_lock_state where email = v_email;
  end if;

  insert into public.audit_logs(action, entity_type, attempted_email, auth_user_id, device_id)
  values (
    case when p_result = 'logout' then 'Logout'
         when p_result = 'failed' and v_locked_until is not null then 'Login locked'
         else 'Login ' || replace(p_result, '_', ' ') end,
    p_kind || '_session', v_email, p_user_id, p_device_id
  );
  return v_locked_until;
end;
$$;

create or replace function public.guest_login_attempt_state(p_email text)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'attemptsRemaining', case when s.locked_until > now() then 0
      when s.locked_until <= now() then 4 else greatest(4-coalesce(s.failed_attempts,0),0) end,
    'lockedUntil', case when s.locked_until > now() then s.locked_until else null end)
  from (select 1) seed left join public.login_lock_state s on s.email=lower(trim(p_email));
$$;
revoke all on function public.guest_login_attempt_state(text) from public,anon,authenticated;
grant execute on function public.guest_login_attempt_state(text) to service_role;
notify pgrst,'reload schema';
commit;

-- Apply after billing-document-email-migration.sql. Allow server-approved payments
-- to email billing documents, and record delivery of updated paid invoices.
begin;
create or replace function public.billing_email_enabled()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare enabled_value text;
begin
  if not coalesce(auth.role() = 'service_role' and auth.uid() is null, false) and not exists (
    select 1 from public.staff_users s
    where s.id = auth.uid() and s.is_active = true
      and (s.role in ('admin', 'cashier') or exists (
        select 1 from public.role_permissions rp
        where rp.role = s.role and rp.permissions && array['payment_entry', 'payment_approval']::text[]
      ))
  ) then
    raise exception 'Not authorized to read billing email setting' using errcode = '42501';
  end if;

  select setting_value->>'emailEnabled' into enabled_value
  from public.business_settings where setting_key = 'payments.receipt_settings';
  return enabled_value is distinct from 'false';
end;
$$;

revoke all on function public.billing_email_enabled() from public, anon;
grant execute on function public.billing_email_enabled() to authenticated, service_role;

create or replace function public.record_billing_email_delivery(
  p_document_type text,
  p_document_id uuid,
  p_sent boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(auth.role() = 'service_role' and auth.uid() is null, false) and not exists (
    select 1 from public.staff_users s
    where s.id = auth.uid() and s.is_active = true
      and (s.role in ('admin', 'cashier') or exists (
        select 1 from public.role_permissions rp
        where rp.role = s.role and rp.permissions && array['payment_entry', 'payment_approval']::text[]
      ))
  ) then
    raise exception 'Not authorized to record billing email delivery' using errcode = '42501';
  end if;

  if p_document_type = 'receipt' then
    update public.receipts
    set email_sent = p_sent,
        email_sent_at = case when p_sent then now() else null end,
        email_error = case when p_sent then null else left(coalesce(p_error, 'Email delivery failed'), 500) end
    where receipt_id = p_document_id and email_sent is not true;
  elsif p_document_type = 'invoice' then
    update public.invoices
    set email_sent = p_sent,
        email_sent_at = case when p_sent then now() else null end,
        email_error = case when p_sent then null else left(coalesce(p_error, 'Email delivery failed'), 500) end
    where invoice_id = p_document_id;
  else
    raise exception 'Unknown billing document type' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.record_billing_email_delivery(text, uuid, boolean, text) from public, anon;
grant execute on function public.record_billing_email_delivery(text, uuid, boolean, text) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;


-- Apply after admin-read-only-manager-refunds, stay-completion and guest-auto-reschedule migrations.
-- Applies to new cancellation quotes/requests. Historical refund snapshots and
-- completed payouts are retained. Reapply this migration after older workflow migrations.
begin;

create or replace function public.get_cancellation_preview(p_reservation uuid,p_initiator text default 'guest')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; t public.transactions%rowtype; p public.booking_policy_versions%rowtype;
  v_staff boolean:=public.refund_staff_permission('cancel_reservation'); v_gross numeric; v_previous numeric;
  v_net numeric; v_base numeric; v_deposit numeric; v_deduction numeric; v_refund numeric; v_allowed boolean;
  v_result jsonb; v_block text; v_fees numeric; v_retained_fees numeric; v_retained_deposit numeric;
begin
  if p_initiator is null or p_initiator not in ('guest','resort') then raise exception 'Choose guest or resort cancellation' using errcode='22023'; end if;
  select * into r from public.reservations where reservation_id=p_reservation;
  if not found then raise exception 'Reservation not found' using errcode='22023'; end if;
  if auth.uid() is null or (not v_staff and (r.guest_id is distinct from auth.uid() or p_initiator<>'guest')) then
    raise exception 'Cancellation permission required' using errcode='42501'; end if;
  if p_initiator='resort' and not exists(select 1 from public.staff_users where id=auth.uid() and role='staff' and is_active) then
    raise exception 'Only an authorized manager may cancel for a resort-attributable reason' using errcode='42501'; end if;
  select * into t from public.transactions where reservation_id=p_reservation;
  if not found then raise exception 'Reservation bill not found' using errcode='22023'; end if;
  select * into p from public.booking_policy_versions where version=r.booking_policy_version;
  if not found then select * into p from public.booking_policy_versions order by version desc limit 1; end if;
  if not found then raise exception 'Booking policy is not configured' using errcode='22023'; end if;
  select coalesce(sum(amount),0) into v_gross from public.payments where reservation_id=p_reservation and status='verified';
  select coalesce(sum(amount),0) into v_previous from public.refund_requests where reservation_id=p_reservation and status='refunded';
  v_net:=round(greatest(v_gross-v_previous,0),2);
  v_base:=coalesce(t.cancellation_deposit_base,t.total_amount);
  v_deposit:=ceil(v_base*20)/100; -- Same cent rounding as the required 20% downpayment.
  -- Only approved notice/reschedule fees are non-refundable; date-rate
  -- adjustments are part of the booking price. Unapproved requests add no fee.
  select coalesce(sum(greatest(reschedule_fee,0)),0) into v_fees
    from (
      select reschedule_fee from public.reservation_reschedules where reservation_id=p_reservation and status='approved'
      union all
      select notice_fee from public.reservation_reschedule_adjustments where reservation_id=p_reservation
    ) fees;
  v_retained_fees:=least(v_net,v_fees);
  v_retained_deposit:=case when p_initiator='guest' then least(greatest(v_net-v_retained_fees,0),v_deposit) else 0 end;
  v_deduction:=v_retained_fees+v_retained_deposit;
  v_refund:=round(greatest(v_net-v_deduction,0),2);
  if r.checked_in_at is not null then v_block:='Checked-in reservations cannot be cancelled or rescheduled.';
  elsif r.status not in ('pending','payment_submitted','confirmed','reschedule_requested') then v_block:='This reservation cannot be cancelled.';
  elsif exists(select 1 from public.payments where reservation_id=p_reservation and status='pending') then v_block:='Review pending payments before cancelling.';
  elsif exists(select 1 from public.refund_requests where reservation_id=p_reservation and status='payout_submitted') then v_block:='Verify the existing refund transfer before cancelling.';
  elsif not v_staff and r.start_datetime-now()<make_interval(hours=>p.guest_cancellation_notice_hours) then v_block:='The guest cancellation notice window has passed. Contact the resort.';
  end if;
  v_allowed:=v_block is null;
  v_result:=jsonb_build_object('reservationId',p_reservation,'reference',r.reference_number,'initiator',p_initiator,
    'totalAmount',t.total_amount,'verifiedPaid',v_gross,'previousRefunds',v_previous,'netPaid',v_net,
    'depositBase',v_base,'depositAmount',v_deposit,'deduction',v_deduction,'refundableAmount',v_refund,
    'rescheduleFees',v_fees,'retainedRescheduleFees',v_retained_fees,'retainedDeposit',v_retained_deposit,
    'policyVersion',p.version,'noticeHours',p.guest_cancellation_notice_hours,'allowed',v_allowed,'blockedReason',v_block,
    'outcome',case when v_refund>0 then 'pending_refund' else 'no_refund' end,
    'rule',case when p_initiator='resort' then 'Remaining verified payments are refundable after non-refundable reschedule fees; no deposit deduction.'
      else 'The initial 20% deposit and approved reschedule fees are non-refundable. Only remaining verified payments above these deductions are refundable.' end);
  return v_result || jsonb_build_object('quote',md5(v_result::text));
end $$;

revoke all on function public.get_cancellation_preview(uuid,text) from public,anon;
grant execute on function public.get_cancellation_preview(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;


-- Manager approval -> cashier payout -> manager verification (latest refund workflow).
-- Apply AFTER admin-read-only-manager-refunds-migration.sql and
-- non-refundable-reschedule-fees-migration.sql, and after all older refund migrations.
-- Safe to reapply. Preserves refund amounts, snapshots, historical review notes,
-- completed payouts and existing statuses. Legacy reviewed requests can be approved directly.
-- Deploy together with the manager -> cashier -> manager application changes.
begin;

-- Keep unrelated grants; retire the cashier-review step and incompatible refund grants.
update public.role_permissions set permissions=array(
  select distinct p from unnest(array_remove(array_remove(permissions,'refund_review'),'refund_payout')
    || array['transactions','refund_approval','refund_verify']) p
) where role='staff';
update public.role_permissions set permissions=array(
  select distinct p from unnest(array_remove(array_remove(array_remove(permissions,'refund_review'),'refund_approval'),'refund_verify')
    || array['transactions','refund_payout']) p
) where role='cashier';

-- Enforce role boundaries even when permission arrays are forged or RPCs are called directly.
create or replace function public.refund_staff_permission(p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_users s where s.id=auth.uid() and s.is_active and s.role<>'admin'
    and p_permission<>'refund_review'
    and (p_permission not in ('refund_approval','refund_verify') or s.role='staff')
    and (p_permission<>'refund_payout' or s.role='cashier')
    and exists(select 1 from public.role_permissions rp where rp.role=s.role and p_permission=any(rp.permissions)));
$$;
revoke all on function public.refund_staff_permission(text) from public,anon;
grant execute on function public.refund_staff_permission(text) to authenticated;

create or replace function public.transition_refund_workflow(p_id uuid,p_action text,p_reason text default null,
  p_reference text default null,p_proof text default null,p_method text default 'GCash',p_verified boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare f public.refund_requests%rowtype; v_id uuid; r public.reservations%rowtype;
  v_total numeric; v_available numeric; v_other numeric; v_new text; v_permission text;
begin
  if p_action is null or p_action not in ('approved','rejected','payout_submitted','refunded') then
    raise exception 'Refunds go directly to manager approval; a separate payment-review step is not supported' using errcode='22023';
  end if;
  v_permission:=case when p_action='payout_submitted' then 'refund_payout' when p_action='refunded' then 'refund_verify' else 'refund_approval' end;
  if not public.refund_staff_permission(v_permission) then raise exception 'Refund permission required' using errcode='42501'; end if;
  if p_action in ('approved','rejected') and not exists(select 1 from public.staff_users where id=auth.uid() and role='staff' and is_active) then
    raise exception 'Only an authorized manager can approve or reject refunds' using errcode='42501'; end if;
  select reservation_id into v_id from public.refund_requests where refund_id=p_id;
  if not found then raise exception 'Refund request not found' using errcode='22023'; end if;
  select * into r from public.reservations where reservation_id=v_id for update;
  select total_amount into v_total from public.transactions where reservation_id=v_id for update;
  select * into f from public.refund_requests where refund_id=p_id for update;
  if f.workflow_version=1 and f.request_kind='cancellation' and p_action<>'rejected' then
    raise exception 'A manager must classify and recalculate this legacy cancellation before processing' using errcode='40001'; end if;
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
  if p_action='approved' and f.status in ('pending','reviewed') then
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
    if f.payout_submitted_by=auth.uid() then
      raise exception 'A different authorized manager must verify this payout' using errcode='42501'; end if;
    if f.gcash_reference is null or f.proof_path is null or not exists(select 1 from storage.objects where bucket_id='refund-proofs' and name=f.proof_path) then
      raise exception 'Payout evidence is missing' using errcode='22023'; end if;
    update public.refund_requests set status='refunded',refunded_by=auth.uid(),refunded_at=now(),payout_verification_notes=trim(p_reason) where refund_id=p_id; v_new:='refunded';
  else raise exception 'Invalid refund transition. Refresh the request and complete the preceding step' using errcode='22023'; end if;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(auth.uid(),auth.uid(),'Refund '||v_new,'refund_request',p_id,jsonb_build_object('reservation_id',v_id,'amount',f.amount,
      'old_status',f.status,'new_status',v_new,'reason',p_reason,'reference',coalesce(p_reference,f.gcash_reference),
      'proof',coalesce(p_proof,f.proof_path),'verified',p_verified,
      'same_actor_verification',p_action='refunded' and f.payout_submitted_by=auth.uid()));
  perform public.notify_refund_workflow(f.guest_id,'Refund '||replace(v_new,'_',' '),
    format('Reservation %s: PHP %s refund. %s%s',r.reference_number,f.amount,
      case v_new when 'approved' then 'Approved by a manager; awaiting manual transfer by a cashier through an approved payment method.'
        when 'payout_submitted' then 'Transfer documented; awaiting verification by an authorized manager. The refund is not completed yet.'
        when 'refunded' then 'Transfer verified. Refund completed.' else 'Request rejected. ' end,
      case when v_new='rejected' then trim(p_reason) else '' end),'refund_request',p_id);
end $$;

create or replace function public.cancel_reservation_evaluated(p_reservation uuid,p_reason text,p_initiator text,p_expected_quote text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; v_quote jsonb; v_id uuid; v_previous public.refund_requests%rowtype;
  v_amount numeric; v_policy text; v_staff boolean:=public.refund_staff_permission('cancel_reservation');
begin
  if length(trim(coalesce(p_reason,''))) not between 5 and 2000 then raise exception 'A documented cancellation reason (5-2000 characters) is required' using errcode='22023'; end if;
  select * into r from public.reservations where reservation_id=p_reservation for update;
  perform 1 from public.transactions where reservation_id=p_reservation for update;
  v_quote:=public.get_cancellation_preview(p_reservation,p_initiator);
  if not (v_quote->>'allowed')::boolean then raise exception '%',v_quote->>'blockedReason' using errcode='40001'; end if;
  if p_expected_quote is null or p_expected_quote is distinct from v_quote->>'quote' then
    raise exception 'Payments, refunds or the bill changed. Reload the cancellation preview before confirming' using errcode='40001'; end if;
  v_amount:=(v_quote->>'refundableAmount')::numeric;
  v_policy:=v_quote->>'rule';
  select * into v_previous from public.refund_requests where reservation_id=p_reservation
    and status in ('pending','reviewed','approved') for update;
  update public.reservations set status='cancelled',cancelled_at=now(),cancellation_reason=trim(p_reason),
    cancellation_initiator=p_initiator,cancelled_by=auth.uid(),cancellation_snapshot=v_quote where reservation_id=p_reservation;
  update public.invoices set status='void' where reservation_id=p_reservation;
  if v_amount>0 then
    if v_previous.refund_id is null then
      insert into public.refund_requests(reservation_id,guest_id,amount,request_kind,policy_snapshot,policy_version,
        cancellation_event_id,calculation_snapshot,workflow_version)
      values(p_reservation,r.guest_id,v_amount,'cancellation',v_policy,(v_quote->>'policyVersion')::bigint,
        p_reservation,v_quote,2) returning refund_id into v_id;
    else
      v_id:=v_previous.refund_id;
      update public.refund_requests set amount=v_amount,request_kind='cancellation',status='pending',
        policy_snapshot=v_policy,policy_version=(v_quote->>'policyVersion')::bigint,cancellation_event_id=p_reservation,
        calculation_snapshot=v_quote,workflow_version=2,reviewed_by=null,reviewed_at=null,review_reason=null,
        payment_reviewed_by=null,payment_reviewed_at=null,payment_review_notes=null where refund_id=v_id;
    end if;
  elsif v_previous.refund_id is not null then
    update public.refund_requests set status='rejected',reviewed_at=now(),review_reason='Cancellation evaluation: no refundable verified funds remain.' where refund_id=v_previous.refund_id;
  end if;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(case when v_staff then auth.uid() else null end,auth.uid(),'Cancelled reservation with refund evaluation','reservation',p_reservation,
      v_quote || jsonb_build_object('reason',trim(p_reason),'refund_id',v_id,'previous_refund',to_jsonb(v_previous)));
  perform public.notify_refund_workflow(r.guest_id,
    case when v_id is null then 'Reservation cancelled - no refund' else 'Reservation cancelled - pending refund' end,
    format('Reservation %s cancelled. Reason: %s. Verified payments: PHP %s; previous refunds: PHP %s; retained deposit: PHP %s; refundable: PHP %s. %s',
      r.reference_number,trim(p_reason),v_quote->>'verifiedPaid',v_quote->>'previousRefunds',v_quote->>'deduction',v_quote->>'refundableAmount',
      case when v_id is null then 'No refund request is needed.' else 'A refund request was created automatically. A manager will approve or reject it, a cashier will transfer approved funds, and a manager will verify the transfer.' end),
    case when v_id is null then 'reservation' else 'refund_request' end,coalesce(v_id,p_reservation));
  return v_quote || jsonb_build_object('refundId',v_id,'status','cancelled');
end $$;

create or replace function public.recalculate_legacy_cancellation_refund(p_id uuid,p_initiator text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare f public.refund_requests%rowtype; v_res uuid; q jsonb;
begin
  if not public.refund_staff_permission('refund_approval') then
    raise exception 'Manager refund approval permission required' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Document why the legacy cancellation was classified this way' using errcode='22023'; end if;
  select reservation_id into v_res from public.refund_requests where refund_id=p_id;
  perform 1 from public.reservations where reservation_id=v_res and status='cancelled' for update;
  if not found then raise exception 'A cancelled reservation is required' using errcode='22023'; end if;
  perform 1 from public.transactions where reservation_id=v_res for update;
  select * into f from public.refund_requests where refund_id=p_id for update;
  if f.workflow_version<>1 or f.request_kind<>'cancellation' or f.status not in ('pending','reviewed','approved') then
    raise exception 'Only an unprocessed legacy cancellation request can be recalculated' using errcode='22023'; end if;
  q:=public.get_cancellation_preview(v_res,p_initiator);
  if exists(select 1 from public.payments where reservation_id=v_res and status='pending') then
    raise exception 'Review pending payments first' using errcode='40001'; end if;
  update public.refund_requests set amount=case when (q->>'refundableAmount')::numeric>0 then (q->>'refundableAmount')::numeric else amount end,
    status=case when (q->>'refundableAmount')::numeric>0 then 'pending' else 'rejected' end,
    workflow_version=2,calculation_snapshot=q,cancellation_event_id=v_res,policy_snapshot=q->>'rule',
    reviewed_by=null,reviewed_at=null,review_reason=case when (q->>'refundableAmount')::numeric=0 then 'Cancelled - No Refund: deposit retained.' else null end,
    payment_reviewed_by=null,payment_reviewed_at=null,payment_review_notes=null where refund_id=p_id;
  update public.reservations set cancellation_initiator=p_initiator,cancellation_snapshot=q where reservation_id=v_res;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(auth.uid(),auth.uid(),'Recalculated legacy cancellation refund','refund_request',p_id,
      jsonb_build_object('previous',to_jsonb(f),'calculation',q,'reason',trim(p_reason)));
  perform public.notify_refund_workflow(f.guest_id,'Cancellation refund recalculated',
    format('Verified cancellation refund: PHP %s; retained deposit: PHP %s. Manager documentation: %s. A positive refund is awaiting manager approval.',q->>'refundableAmount',q->>'deduction',trim(p_reason)), 'refund_request',p_id);
end $$;

revoke all on function public.transition_refund_workflow(uuid,text,text,text,text,text,boolean) from public,anon;
grant execute on function public.transition_refund_workflow(uuid,text,text,text,text,text,boolean) to authenticated;
revoke all on function public.cancel_reservation_evaluated(uuid,text,text,text) from public,anon;
grant execute on function public.cancel_reservation_evaluated(uuid,text,text,text) to authenticated;
revoke all on function public.recalculate_legacy_cancellation_refund(uuid,text,text) from public,anon;
grant execute on function public.recalculate_legacy_cancellation_refund(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;


-- Manager-recorded reservation no-shows.
-- Apply after the reservation lifecycle, stay completion, timed maintenance,
-- reservation management and manager-cashier refund workflow migrations.
-- Safe to reapply. Existing reservations, bills, payments and refunds are preserved.
-- Manager-only; confirmed reservations without attendance, after scheduled departure.
begin;
alter table public.reservations add column if not exists no_show_at timestamptz;
alter table public.reservations add column if not exists no_show_by uuid references public.staff_users(id);
alter table public.reservations add column if not exists no_show_reason text;
alter table public.reservations drop constraint if exists reservations_status_check;
alter table public.reservations add constraint reservations_status_check
  check(status in ('pending','payment_submitted','confirmed','expired','rejected','cancelled','completed','reschedule_requested','no_show'));
alter table public.reservations drop constraint if exists reservation_no_show_metadata_check;
alter table public.reservations add constraint reservation_no_show_metadata_check check(
  (status='no_show' and no_show_at is not null and no_show_by is not null and char_length(btrim(coalesce(no_show_reason,''))) between 5 and 2000)
  or (status<>'no_show' and no_show_at is null and no_show_by is null and no_show_reason is null)
);

create or replace function public.reservation_state_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not exists (
      select 1 from public.staff_users where id = auth.uid() and is_active
    ) and (new.guest_id is distinct from auth.uid() or new.status <> 'pending') then
      raise exception 'Guests may only create pending reservations for themselves' using errcode = '42501';
    end if;
    if auth.uid() is not null and not exists (
      select 1 from public.staff_users where id = auth.uid() and is_active
    ) then
      if new.start_datetime <= clock_timestamp() then
        raise exception 'Reservation must start in the future' using errcode = '23514';
      end if;
      new.booking_type := 'online';
      new.walk_in_guest_id := null;
    end if;
    if new.status = 'pending' then
      new.payment_deadline_at := clock_timestamp() + interval '30 minutes';
    end if;
  else
    if auth.uid() is not null and old.guest_id = auth.uid() and not exists (
      select 1 from public.staff_users where id = auth.uid() and is_active
    ) and (new.status <> 'cancelled' or new.start_datetime is distinct from old.start_datetime
      or new.end_datetime is distinct from old.end_datetime or new.guest_id is distinct from old.guest_id
      or new.payment_deadline_at is distinct from old.payment_deadline_at
      or new.reference_number is distinct from old.reference_number
      or new.booking_mode is distinct from old.booking_mode
      or new.booking_type is distinct from old.booking_type
      or new.adult_count is distinct from old.adult_count
      or new.child_count is distinct from old.child_count
      or new.walk_in_guest_id is distinct from old.walk_in_guest_id
      or new.special_requests is distinct from old.special_requests) then
      raise exception 'Guests may only cancel their own reservations' using errcode = '42501';
    end if;
    if old.status is distinct from new.status and not (
      (old.status = 'pending' and new.status in ('payment_submitted', 'confirmed', 'expired', 'cancelled', 'reschedule_requested')) or
      (old.status = 'payment_submitted' and new.status in ('confirmed', 'rejected', 'cancelled', 'reschedule_requested')) or
      (old.status = 'confirmed' and new.status in ('cancelled', 'completed', 'reschedule_requested', 'no_show')) or
      (old.status = 'reschedule_requested' and new.status in ('pending', 'payment_submitted', 'confirmed', 'cancelled'))
    ) then
      raise exception 'Invalid reservation state transition: % to %', old.status, new.status using errcode = '23514';
    end if;
    if old.status is distinct from new.status and new.status = 'confirmed' and not exists (
      select 1 from public.payments where reservation_id = new.reservation_id and status = 'verified'
    ) then
      raise exception 'A verified payment is required to confirm a reservation' using errcode = '23514';
    end if;
    if old.status is distinct from new.status and new.status = 'payment_submitted' and not exists (
      select 1 from public.payments where reservation_id = new.reservation_id and status = 'pending'
    ) then
      raise exception 'A submitted payment is required' using errcode = '23514';
    end if;
    if old.status is distinct from new.status and new.status = 'expired' and
      (old.payment_deadline_at is null or clock_timestamp() < old.payment_deadline_at) then
      raise exception 'Payment deadline has not passed' using errcode = '23514';
    end if;
    if old.status is distinct from new.status and new.status = 'rejected' and not exists (
      select 1 from public.payments where reservation_id = new.reservation_id and status = 'rejected'
    ) then
      raise exception 'A rejected payment is required to reject a reservation' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists reservation_state_guard_trigger on public.reservations;
create trigger reservation_state_guard_trigger before insert or update on public.reservations
for each row execute function public.reservation_state_guard();

-- Browser roles must use the manager endpoint. The service-only RPC supplies the
-- authenticated actor and server timestamp; existing markers are immutable.
create or replace function public.guard_reservation_no_show()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.status='no_show' or new.no_show_at is not null or new.no_show_by is not null or new.no_show_reason is not null then
      raise exception 'Use the manager no-show action on a confirmed reservation' using errcode='42501';
    end if;
    return new;
  end if;
  if new.no_show_at is distinct from old.no_show_at or new.no_show_by is distinct from old.no_show_by
    or new.no_show_reason is distinct from old.no_show_reason or (new.status is distinct from old.status and (new.status='no_show' or old.status='no_show')) then
    if current_user in ('anon','authenticated') then raise exception 'Use the manager no-show action' using errcode='42501'; end if;
    if old.status='no_show' then raise exception 'A no-show record cannot be reopened or rewritten' using errcode='40001'; end if;
    if new.status<>'no_show' or old.status<>'confirmed' or old.checked_in_at is not null or old.checked_out_at is not null then
      raise exception 'Only a confirmed reservation without attendance can be marked as a no-show' using errcode='40001'; end if;
    if old.end_datetime>=clock_timestamp() then raise exception 'No show is available only after the scheduled end time' using errcode='40001'; end if;
    if not exists(select 1 from public.staff_users s join public.role_permissions rp on rp.role=s.role
      where s.id=new.no_show_by and s.role='staff' and s.is_active and 'edit_reservation'=any(rp.permissions)) then
      raise exception 'Manager reservation-edit permission required' using errcode='42501'; end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_reservation_no_show on public.reservations;
create trigger guard_reservation_no_show before insert or update on public.reservations
for each row execute function public.guard_reservation_no_show();

-- Lock the same reservation as payment submission and check-in to serialize races.
create or replace function public.mark_reservation_no_show(p_reservation uuid,p_staff uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype;
begin
  if not exists(select 1 from public.staff_users s join public.role_permissions rp on rp.role=s.role
    where s.id=p_staff and s.role='staff' and s.is_active and 'edit_reservation'=any(rp.permissions)) then
    raise exception 'Only an active manager with Edit reservations permission can record a no-show' using errcode='42501'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 5 and 2000 then
    raise exception 'Enter a no-show reason between 5 and 2000 characters' using errcode='22023'; end if;
  select * into r from public.reservations where reservation_id=p_reservation for update;
  if not found then raise exception 'Reservation not found' using errcode='P0002'; end if;
  if r.status='no_show' then return to_jsonb(r)||jsonb_build_object('alreadyMarkedNoShow',true); end if;
  if r.status<>'confirmed' or r.checked_in_at is not null or r.checked_out_at is not null then
    raise exception 'Only a confirmed reservation without attendance can be marked as a no-show' using errcode='40001'; end if;
  if r.end_datetime>=clock_timestamp() then raise exception 'No show is available only after the scheduled end time' using errcode='40001'; end if;
  if exists(select 1 from public.payments where reservation_id=p_reservation and status='pending') then
    raise exception 'Review pending payments before recording a no-show' using errcode='40001'; end if;
  if exists(select 1 from public.reservation_reschedules where reservation_id=p_reservation and status='pending') then
    raise exception 'Resolve pending reschedule requests before recording a no-show' using errcode='40001'; end if;
  if exists(select 1 from public.refund_requests where reservation_id=p_reservation and status in ('pending','reviewed','approved','payout_submitted')) then
    raise exception 'Resolve the open refund before recording a no-show' using errcode='40001'; end if;
  update public.reservations set status='no_show',no_show_at=clock_timestamp(),no_show_by=p_staff,no_show_reason=btrim(p_reason)
    where reservation_id=p_reservation returning * into r;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(p_staff,p_staff,'Marked reservation No show','reservation',p_reservation,jsonb_build_object(
      'reference_number',r.reference_number,'old_status','confirmed','new_status','no_show','no_show_at',r.no_show_at,
      'reason',r.no_show_reason,'start_datetime',r.start_datetime,'end_datetime',r.end_datetime));
  if r.guest_id is not null then
    insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
      values('guest',r.guest_id,p_staff,'Reservation marked No show',
        format('Reservation %s was marked No show because no guest arrival was recorded. Contact the resort if this is incorrect.',r.reference_number),
        '/manage','reservation',p_reservation);
  end if;
  return to_jsonb(r)||jsonb_build_object('alreadyMarkedNoShow',false);
end $$;
revoke all on function public.mark_reservation_no_show(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.mark_reservation_no_show(uuid,uuid,text) to service_role;

-- Retain the existing bill and historical payments; closed no-shows cannot take
-- new payments, have payment evidence rewritten, or lose payment history.
create or replace function public.guard_no_show_payments()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_ids uuid[];
begin
  if tg_op='INSERT' then v_ids:=array[new.reservation_id];
  elsif tg_op='DELETE' then v_ids:=array[old.reservation_id];
  else v_ids:=array[old.reservation_id,new.reservation_id]; end if;
  perform 1 from public.reservations where reservation_id=any(v_ids) order by reservation_id for update;
  if exists(select 1 from public.reservations where reservation_id=any(v_ids) and status='no_show') then
    if tg_op in ('INSERT','DELETE') then raise exception 'No-show reservations cannot receive new payments or lose payment history' using errcode='40001'; end if;
    if new.reservation_id is distinct from old.reservation_id or new.amount is distinct from old.amount or new.status is distinct from old.status
      or to_jsonb(new)->'reference_number' is distinct from to_jsonb(old)->'reference_number'
      or to_jsonb(new)->'proof_path' is distinct from to_jsonb(old)->'proof_path' then
      raise exception 'No-show payment history is read-only' using errcode='40001'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists guard_no_show_payments on public.payments;
create trigger guard_no_show_payments before insert or update or delete on public.payments
for each row execute function public.guard_no_show_payments();
notify pgrst,'reload schema';
commit;


-- Manager-only maintenance authorization (apply last).
-- Apply after docs/timed-maintenance-auto-ocular-migration.sql.
-- Only active Managers (stored role staff) with edit_reservation can create or
-- release maintenance blocks. Admin and Cashier access remains read-only.
-- Replaces existing RPC bodies without changing records or role grants.
begin;

create or replace function public.create_timed_maintenance_block(p_name text,p_reason text,p_start timestamptz,p_end timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_day date; v_id uuid; v_actor uuid:=auth.uid();
begin
  if not exists(select 1 from public.staff_users s where s.id=v_actor and s.is_active and
    s.role='staff' and public.refund_staff_permission('edit_reservation')) then
    raise exception 'Authorized manager required' using errcode='42501'; end if;
  if length(trim(coalesce(p_name,''))) not between 1 and 120 or length(trim(coalesce(p_reason,''))) not between 1 and 2000
    or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
    or p_end<=p_start or p_end>p_start+interval '366 days' then
    raise exception 'Enter a valid maintenance period, name and internal reason' using errcode='22023'; end if;
  for v_day in select generate_series((p_start at time zone 'Asia/Manila')::date,
    ((p_end-interval '1 microsecond') at time zone 'Asia/Manila')::date,interval '1 day')::date order by 1 loop
    perform pg_advisory_xact_lock(424242,hashtext(v_day::text));
  end loop;
  -- Ignore expired pending bookings without writing unrelated operational rows.
  if exists(select 1 from public.reservations where status in ('pending','payment_submitted','confirmed','reschedule_requested')
    and (status<>'pending' or payment_deadline_at is null or payment_deadline_at>clock_timestamp())
    and start_datetime<p_end and end_datetime>p_start) then
    raise exception 'An active reservation overlaps this period' using errcode='23P01'; end if;
  if exists(select 1 from public.ocular_visits v join public.ocular_time_slots s on s.slot_id=v.time_slot_id
    where v.status in ('pending','confirmed')
    and ((v.scheduled_date+s.start_time) at time zone 'Asia/Manila')<p_end
    and ((v.scheduled_date+s.end_time) at time zone 'Asia/Manila')>p_start) then
    raise exception 'An ocular visit overlaps this period. Cancel it before blocking this time' using errcode='23P01'; end if;
  insert into public.maintenance_blocks(name,reason,start_date,end_date,start_datetime,end_datetime,created_by)
    values(trim(p_name),trim(p_reason),(p_start at time zone 'Asia/Manila')::date,
      ((p_end-interval '1 microsecond') at time zone 'Asia/Manila')::date,p_start,p_end,v_actor) returning block_id into v_id;
  insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
    select 'guest',id,v_actor,'Scheduled maintenance',
      format('The resort is unavailable due to maintenance from %s to %s (Philippine time).',
        to_char(p_start at time zone 'Asia/Manila','YYYY-MM-DD HH24:MI'),to_char(p_end at time zone 'Asia/Manila','YYYY-MM-DD HH24:MI')),
      '/booking','maintenance_block',v_id from public.guests;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(v_actor,v_actor,'Created maintenance block','maintenance_block',v_id,
      jsonb_build_object('name',trim(p_name),'reason',trim(p_reason),'start_datetime',p_start,'end_datetime',p_end));
  return v_id;
end $$;
-- Retire the date-only write entry point so old callers cannot reintroduce leaks.
drop function if exists public.create_maintenance_block(text,text,date,date);
create or replace function public.release_maintenance_block(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_block public.maintenance_blocks%rowtype; v_actor uuid:=auth.uid();
begin
  if not exists(select 1 from public.staff_users s where s.id=v_actor and s.is_active and
    s.role='staff' and public.refund_staff_permission('edit_reservation')) then
    raise exception 'Authorized manager required' using errcode='42501'; end if;
  select * into v_block from public.maintenance_blocks where block_id=p_id for update;
  if not found or v_block.status<>'active' then raise exception 'Active block not found' using errcode='22023'; end if;
  update public.maintenance_blocks set status='released',released_by=v_actor,released_at=clock_timestamp() where block_id=p_id;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(v_actor,v_actor,'Released maintenance block','maintenance_block',p_id,to_jsonb(v_block));
end $$;

revoke all on function public.create_timed_maintenance_block(text,text,timestamptz,timestamptz) from public,anon;
grant execute on function public.create_timed_maintenance_block(text,text,timestamptz,timestamptz) to authenticated;
revoke all on function public.release_maintenance_block(uuid) from public,anon;
grant execute on function public.release_maintenance_block(uuid) to authenticated;

commit;


-- Staff entries for active non-cash catalog payment methods.
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


-- Guest online non-cash methods with required manual approval.
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


-- service-quantity-limits-migration.sql
-- Apply before deploying service quantity controls. No new table is created.
-- Existing services retain the previous 10,000 technical ceiling. Configure
-- actual per-booking limits in Business Catalog > Services after applying.
begin;

alter table public.services add column if not exists max_quantity integer not null default 10000;
update public.services set max_quantity=10000 where max_quantity is null;
alter table public.services alter column max_quantity set default 10000;
alter table public.services alter column max_quantity set not null;
alter table public.services drop constraint if exists services_max_quantity_check;
alter table public.services add constraint services_max_quantity_check check (max_quantity between 1 and 10000);

create or replace function public.enforce_service_quantity_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_limit integer; v_name text; v_allowed integer;
begin
  if new.quantity is null or new.quantity < 1 or new.quantity > 10000 then
    raise exception 'Choose a whole-number service quantity from 1 to 10000' using errcode='22023';
  end if;
  select max_quantity,name into v_limit,v_name from public.services where service_id=new.service_id for share;
  if not found then raise exception 'Selected service is unavailable' using errcode='22023'; end if;
  v_allowed:=v_limit;
  -- Keep historical bookings valid when an administrator lowers a limit.
  -- Quantities above the new cap may be retained or reduced, never increased.
  if tg_op='UPDATE' then
    if old.service_id=new.service_id and old.reservation_id=new.reservation_id then
      v_allowed:=greatest(v_limit,coalesce(old.quantity,1));
    end if;
  end if;
  if new.quantity>v_allowed then
    raise exception '% allows a maximum quantity of % per booking',v_name,v_allowed using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_service_quantity_limit() from public,anon,authenticated;
drop trigger if exists enforce_service_quantity_limit on public.reservation_services;
-- AFTER is intentional: INSERT ... ON CONFLICT must resolve to UPDATE before
-- checking the historical quantity. Any violation rolls back the whole statement.
create trigger enforce_service_quantity_limit after insert or update of quantity,service_id,reservation_id
on public.reservation_services for each row execute function public.enforce_service_quantity_limit();

commit;


-- EDITABLE LEGAL DOCUMENTS AND IMMUTABLE ACCEPTANCE VERSIONS
-- Apply after the existing catalog, guest registration and booking migrations.
-- Published legal versions reuse reservation_policies. No new table is created.
begin;

alter table public.reservation_policies
  add column if not exists document_type text not null default 'general',
  add column if not exists version integer not null default 1,
  add column if not exists published_at timestamptz not null default now(),
  add column if not exists published_by uuid references public.staff_users(id),
  add column if not exists change_note text not null default '';
alter table public.reservation_policies drop constraint if exists legal_policy_document_type_check;
alter table public.reservation_policies add constraint legal_policy_document_type_check check(document_type in ('general','terms','privacy') and version between 1 and 999999999);
create unique index if not exists legal_policy_version_unique on public.reservation_policies(document_type,version) where document_type in ('terms','privacy');
create unique index if not exists legal_policy_current_unique on public.reservation_policies(document_type) where document_type in ('terms','privacy') and is_active;

-- Import the exact existing website documents as version 1. Existing general
-- catalog policy records are retained and never overwrite either document.
insert into public.reservation_policies(title,content,document_type,version,change_note,is_active)
select 'Terms and Conditions', $baseline_terms$# 1. Reservations and payment

A booking request is subject to availability. A reservation is saved when you submit it, and payment proof remains pending until resort staff verifies the actual transaction. A submitted screenshot or reference number does not by itself confirm payment.

You may pay a 20% down payment or the full amount shown at checkout. Any remaining balance must be paid upon arrival before swimming. Keep your booking reference and payment confirmation for check-in.

# 2. Package rates and guest count

The displayed booking quote shows the applicable package rate, selected services, and additional guest charges. Packages include up to 20 guests; up to 10 additional guests may be added at the per-head rate shown at checkout, for a maximum of 30 guests in total. Adults and children both count toward this limit.

The booking summary is the amount to review before saving. Ask the resort about holiday rates or special arrangements before paying if the displayed quote does not match your expected rate.

# 3. Changes and cancellation

The cancellation notice and refund rules for your reservation are the booking policy version displayed above and saved with your reservation. Standard rescheduling notice is 14 Philippine calendar days for an original swimming date in March-May or September-December, or 7 days in other months. Guests with confirmed reservations who have not checked in may also submit shorter-notice, same-day or past-date requests through Manage Booking. Available future dates are approved automatically without staff review; the new start must be at least 30 minutes away. The booked package, original start time and duration remain fixed.

Change fees are ₱50 for six or more calendar days' notice, ₱100 for three to five days, ₱300 for one to two days, and ₱500 on or after the original swimming date. On-time reschedules carry the ₱50 fee plus any higher-date-rate adjustment. Saving a valid reschedule immediately updates the schedule and adds the displayed charges to your bill, including for short-notice changes. A cheaper date does not automatically reduce the bill.

# 4. Included amenities and optional charges

The private pool package lists a cottage, two air-conditioned rooms with beds and private toilets, videoke, griller, parking, and the food inclusions shown in the booking offer. Availability and any selected add-ons appear in the booking summary.

Listed optional charges include ₱200 corkage for outside food and drinks, additional rooms at the regular rate, extra mattress foam at ₱300, cooking from ₱150, swimming extension at ₱500 per hour per 20 guests, and an electricity charge for appliances. Confirm any optional charge and availability with staff before use.

# 5. Guest safety and conduct

Children should be accompanied by adults, especially near the pool. Follow lifeguard and staff instructions. Do not swim while intoxicated. Report hazards or emergencies to staff immediately. Fake or prank drowning may result in removal from the resort; emergency responders may be contacted when needed.

Please keep personal belongings attended and report lost or damaged items promptly. Guests are responsible for their own conduct and for following posted resort rules. Nothing in these terms removes rights or responsibilities that cannot legally be excluded.

# 6. Contact

For a booking, payment, schedule change, or special arrangement, contact MarVille Resort Complex at emailmarvilleresort@gmail.com or 09172796592 / 82360633. The resort is at Cabrera Road, Hapay na Mangga, Brgy. Dolores, Taytay, Rizal 1920.$baseline_terms$,'terms',1,'Imported from website legal version 2026-10',true
where not exists(select 1 from public.reservation_policies where document_type='terms');
insert into public.reservation_policies(title,content,document_type,version,change_note,is_active)
select 'Privacy Policy', $baseline_privacy$# 1. Information we collect

When you create an account, book, pay, or contact us, we may collect:

- Name, email address, phone number, and address
- Account and authentication information
- Reservation dates, guest counts, selected packages, services, and requests
- Payment details and proof of payment, including information visible in an uploaded image
- Transaction history and messages sent to the resort

# 2. Why and how we use it

We use this information to create and manage reservations, check availability, verify payments, send confirmations and billing documents, assist guests, maintain accounts, prevent unauthorized activity, and keep operational and accounting records. We process information needed to provide the service you request and to meet applicable legal obligations. We do not use booking information for unrelated marketing without a separate basis.

Passwords are handled by our authentication provider; the resort does not store them in plain text. We do not ask for or store your GCash password or PIN.

# 3. Who may receive it

Authorized resort administrators, managers, and cashiers may access information needed for their duties. Service providers supporting website hosting, authentication, database storage, email delivery, and payments may process the information needed to provide those services. Payment providers, including GCash when used, have their own privacy practices. We may disclose information when required by law or a lawful request. We do not sell or rent guest information.

# 4. Security and retention

We use access controls, authentication, and other reasonable safeguards to protect guest information. No electronic system can guarantee absolute security.

We retain account, reservation, payment, and communication records while needed to provide services and meet operational, accounting, security, and legal requirements. When those purposes end, we take reasonable steps to delete, anonymize, or securely dispose of information, subject to any required retention. Contact us for details about the period applicable to your records.

# 5. Cookies and sessions

The website uses essential cookies or similar technology to maintain signed-in sessions, protect accounts, and provide core website functions.

# 6. Your rights

Under applicable Philippine data privacy law, you may ask to be informed about processing, access or correct your information, object to certain processing, and request erasure or blocking where allowed. You may also raise a privacy complaint with the National Privacy Commission. We may need to verify your identity and retain records where the law or an ongoing transaction requires it.

# 7. Updates and contact

We may update this policy when our services or practices change. The current version will be available on this website with its revision date.

For privacy questions or requests, contact MarVille Resort Complex at emailmarvilleresort@gmail.com or 09172796592 / 82360633, or visit Cabrera Road, Hapay na Mangga, Brgy. Dolores, Taytay, Rizal 1920.$baseline_privacy$,'privacy',1,'Imported from website legal version 2026-10',true
where not exists(select 1 from public.reservation_policies where document_type='privacy');

create or replace function public.protect_published_legal_policy()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then
    if old.document_type in ('terms','privacy') then raise exception 'Published policy versions cannot be deleted' using errcode='42501'; end if;
    return old;
  end if;
  if tg_op='UPDATE' and old.document_type in ('terms','privacy') then
    if row(new.policy_id,new.document_type,new.version,new.title,new.content,new.published_at,new.published_by,new.change_note)
      is distinct from row(old.policy_id,old.document_type,old.version,old.title,old.content,old.published_at,old.published_by,old.change_note) then
      raise exception 'Published policy text is immutable. Publish a new version' using errcode='42501';
    end if;
    if new.is_active is distinct from old.is_active and current_setting('app.legal_policy_publish',true) is distinct from 'true' then
      raise exception 'Publish a new policy version instead of archiving or restoring it' using errcode='42501'; end if;
  elsif new.document_type in ('terms','privacy') and current_setting('app.legal_policy_publish',true) is distinct from 'true' then
    raise exception 'Use the legal policy publisher to create legal versions' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.protect_published_legal_policy() from public,anon,authenticated;
drop trigger if exists protect_published_legal_policy on public.reservation_policies;
create trigger protect_published_legal_policy before insert or update or delete on public.reservation_policies
for each row execute function public.protect_published_legal_policy();

alter table public.reservation_policies enable row level security;
drop policy if exists "Read general catalog policies" on public.reservation_policies;
create policy "Read general catalog policies" on public.reservation_policies for select to anon,authenticated using(document_type='general');
drop policy if exists "Legal history is administrator only" on public.reservation_policies;
create policy "Legal history is administrator only" on public.reservation_policies as restrictive for select to anon,authenticated
using(document_type='general' or exists(select 1 from public.staff_users where id=auth.uid() and is_active and role='admin'));
drop policy if exists "Administrators manage legal policies" on public.reservation_policies;
create policy "Administrators manage legal policies" on public.reservation_policies for all to authenticated
using(exists(select 1 from public.staff_users where id=auth.uid() and is_active and role='admin'))
with check(exists(select 1 from public.staff_users where id=auth.uid() and is_active and role='admin'));

create or replace function public.get_legal_policies(p_terms_id uuid default null,p_privacy_id uuid default null)
returns table(policy_id uuid,document_type text,version integer,title text,content text,published_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
  select p.policy_id,p.document_type,p.version,p.title,p.content,p.published_at from public.reservation_policies p
  where (p.document_type='terms' and case when p_terms_id is null then p.is_active else p.policy_id=p_terms_id end)
    or (p.document_type='privacy' and case when p_privacy_id is null then p.is_active else p.policy_id=p_privacy_id end);
$$;
revoke all on function public.get_legal_policies(uuid,uuid) from public;
grant execute on function public.get_legal_policies(uuid,uuid) to anon,authenticated,service_role;

create or replace function public.get_baseline_legal_policies()
returns table(policy_id uuid,document_type text) language sql stable security definer set search_path=public,pg_temp as $$
  select p.policy_id,p.document_type from public.reservation_policies p where p.document_type in ('terms','privacy') and p.version=1;
$$;
revoke all on function public.get_baseline_legal_policies() from public;
grant execute on function public.get_baseline_legal_policies() to anon,authenticated,service_role;

create or replace function public.publish_legal_policy(p_document_type text,p_title text,p_content text,p_change_note text,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_previous public.reservation_policies%rowtype; v_next public.reservation_policies%rowtype;
  v_actor uuid:=auth.uid(); v_setting text:=current_setting('app.legal_policy_publish',true);
begin
  if not exists(select 1 from public.staff_users where id=v_actor and is_active and role='admin') then raise exception 'Admin access required' using errcode='42501'; end if;
  if p_document_type not in ('terms','privacy') or p_document_type is null or p_expected_version is null
    or length(btrim(coalesce(p_title,''))) not between 3 and 200 or length(btrim(coalesce(p_content,''))) not between 20 and 50000
    or length(btrim(coalesce(p_change_note,''))) not between 1 and 1000 then raise exception 'Enter valid policy text and a reason for the revision' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(82453197);
  select * into v_previous from public.reservation_policies where document_type=p_document_type and is_active for update;
  if not found or v_previous.version<>p_expected_version then raise exception 'This policy changed. Reload the current version before publishing' using errcode='40001'; end if;
  if v_previous.title=btrim(p_title) and v_previous.content=btrim(p_content) then raise exception 'No policy text changed' using errcode='22023'; end if;
  perform set_config('app.legal_policy_publish','true',true);
  update public.reservation_policies set is_active=false where policy_id=v_previous.policy_id;
  insert into public.reservation_policies(title,content,document_type,version,published_by,change_note,is_active)
  values(btrim(p_title),btrim(p_content),p_document_type,v_previous.version+1,v_actor,btrim(p_change_note),true) returning * into v_next;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
  values(v_actor,v_actor,'Published legal policy version','reservation_policies',v_next.policy_id,
    jsonb_build_object('document_type',p_document_type,'previous_policy_id',v_previous.policy_id,'previous_version',v_previous.version,'new_version',v_next.version,'change_note',v_next.change_note));
  perform set_config('app.legal_policy_publish',coalesce(v_setting,''),true);
  return to_jsonb(v_next);
end $$;
revoke all on function public.publish_legal_policy(text,text,text,text,integer) from public,anon;
grant execute on function public.publish_legal_policy(text,text,text,text,integer) to authenticated;

alter table public.reservations
  add column if not exists terms_policy_id uuid references public.reservation_policies(policy_id),
  add column if not exists privacy_policy_id uuid references public.reservation_policies(policy_id),
  add column if not exists legal_accepted_at timestamptz;
alter table public.guests
  add column if not exists terms_policy_id uuid references public.reservation_policies(policy_id),
  add column if not exists privacy_policy_id uuid references public.reservation_policies(policy_id),
  add column if not exists legal_accepted_at timestamptz;

create or replace function public.validate_current_legal_pair(p_terms uuid,p_privacy uuid)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_terms integer; v_privacy integer;
begin
  select version into v_terms from public.reservation_policies where policy_id=p_terms and document_type='terms' and is_active for share;
  select version into v_privacy from public.reservation_policies where policy_id=p_privacy and document_type='privacy' and is_active for share;
  if v_terms is null or v_privacy is null then raise exception 'The legal policies changed. Reload, read and agree again' using errcode='40001'; end if;
  return format('terms:%s;privacy:%s',v_terms,v_privacy);
end $$;
revoke all on function public.validate_current_legal_pair(uuid,uuid) from public,anon,authenticated;

create or replace function public.stamp_reservation_legal_consent()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' then
    if row(new.terms_policy_id,new.privacy_policy_id,new.legal_accepted_at) is distinct from row(old.terms_policy_id,old.privacy_policy_id,old.legal_accepted_at) then
      raise exception 'The legal versions accepted for a booking cannot be changed' using errcode='42501'; end if;
  elsif new.terms_policy_id is not null or new.privacy_policy_id is not null then
    perform public.validate_current_legal_pair(new.terms_policy_id,new.privacy_policy_id);
    new.legal_accepted_at:=clock_timestamp();
  elsif new.legal_accepted_at is not null then
    raise exception 'Policy versions are required for legal acceptance' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function public.stamp_reservation_legal_consent() from public,anon,authenticated;
drop trigger if exists stamp_reservation_legal_consent on public.reservations;
create trigger stamp_reservation_legal_consent before insert or update of terms_policy_id,privacy_policy_id,legal_accepted_at
on public.reservations for each row execute function public.stamp_reservation_legal_consent();

create or replace function public.stamp_guest_legal_consent()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_consent jsonb; v_token text;
begin
  if tg_op='UPDATE' then
    if row(new.terms_policy_id,new.privacy_policy_id,new.legal_accepted_at) is distinct from row(old.terms_policy_id,old.privacy_policy_id,old.legal_accepted_at) then
      raise exception 'Registration legal acceptance cannot be changed' using errcode='42501'; end if;
    return new;
  end if;
  new.terms_policy_id:=null; new.privacy_policy_id:=null; new.legal_accepted_at:=null;
  select raw_user_meta_data->'legal_consent' into v_consent from auth.users where id=new.id;
  -- Staff provisioning and historical accounts may have no registration consent.
  if v_consent is null then return new; end if;
  if v_consent->>'terms_accepted' is distinct from 'true' or v_consent->>'privacy_acknowledged' is distinct from 'true' then
    raise exception 'Explicit legal acceptance is required' using errcode='22023'; end if;
  new.terms_policy_id:=(v_consent->>'terms_policy_id')::uuid;
  new.privacy_policy_id:=(v_consent->>'privacy_policy_id')::uuid;
  v_token:=public.validate_current_legal_pair(new.terms_policy_id,new.privacy_policy_id);
  if v_token is distinct from v_consent->>'policy_version' then raise exception 'Invalid legal acceptance version' using errcode='22023'; end if;
  new.legal_accepted_at:=clock_timestamp();
  return new;
end $$;
revoke all on function public.stamp_guest_legal_consent() from public,anon,authenticated;
drop trigger if exists stamp_guest_legal_consent on public.guests;
create trigger stamp_guest_legal_consent before insert or update of terms_policy_id,privacy_policy_id,legal_accepted_at
on public.guests for each row execute function public.stamp_guest_legal_consent();

commit;


-- RESTORE COMPLETED-STAY REVIEW ELIGIBILITY
-- Apply after stay-completion, review-feedback-management and (if installed)
-- review-without-completed-stay migrations. This restores completed-stay eligibility.
-- Existing feedback, photos, quotas, moderation and audit history are preserved.
begin;

create or replace function public.guard_review_completed_stay()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Historical feedback remains editable under its existing moderation rules.
  if tg_op='UPDATE' then
    if new.guest_id is not distinct from old.guest_id and new.reservation_id is not distinct from old.reservation_id then
      return new;
    end if;
  end if;
  if not exists(select 1 from public.reservations r where r.guest_id=new.guest_id and r.status='completed'
    and (new.reservation_id is null or r.reservation_id=new.reservation_id)) then
    raise exception 'Complete a resort stay before submitting a review. Linked reservations must be your own completed stays' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_review_completed_stay() from public,anon,authenticated;
drop trigger if exists guard_review_completed_stay on public.reviews;
create trigger guard_review_completed_stay before insert or update of reservation_id,guest_id on public.reviews
for each row execute function public.guard_review_completed_stay();

create or replace function public.review_submission_status(p_title text,p_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.guests where id=auth.uid() and is_active) then
    raise exception 'An active guest account is required' using errcode='42501'; end if;
  if not exists(select 1 from public.reservations where guest_id=auth.uid() and status='completed') then
    raise exception 'Complete a resort stay before submitting a review' using errcode='42501'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 or p_text is null or length(btrim(p_text)) not between 50 and 5000 then
    raise exception 'Enter a title of 1-200 characters and review text of 50-5000 characters' using errcode='22023'; end if;
  return public.review_submission_policy(auth.uid(),p_title,p_text);
end $$;
revoke all on function public.review_submission_status(text,text) from public,anon;
grant execute on function public.review_submission_status(text,text) to authenticated;

notify pgrst,'reload schema';
commit;

-- Public swimming, cottage and room collections (14 November 2026).
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
