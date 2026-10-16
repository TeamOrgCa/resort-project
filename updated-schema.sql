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

  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
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

  created_at timestamptz default timezone('utc', now()) not null
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

  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
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

  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
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
  
  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null,

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

  created_at timestamptz default timezone('utc', now()) not null
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
  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null,
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

  created_at timestamptz default timezone('utc', now()) not null,

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

  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
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

  created_at timestamptz default timezone('utc', now()) not null,

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

  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
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

  paid_at timestamptz default timezone('utc', now()),
  receipt_paid_at timestamptz,

  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null,
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
  issued_at timestamptz default timezone('utc', now()) not null,
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
            to_char(now(), 'YYYYMMDD') ||
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
  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
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
  
  created_at timestamptz default timezone('utc', now()) not null
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
  created_at timestamptz default timezone('utc', now()) not null
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

  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
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
        then to_char(created_at, 'Dy')
      when report_period = 'weekly'
        then 'Week ' || extract(week from created_at)
      else to_char(created_at, 'Mon')
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
