-- =========================
-- STAFF USERS
-- =========================
create table public.staff_users (
  id uuid primary key references auth.users(id) on delete cascade,

  full_name text not null,
  email text not null,

  role text check (role in ('admin', 'staff', 'cashier')) not null default 'staff',
  is_active boolean default true,
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

  created_at timestamptz default timezone('utc', now()) not null
);

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
$$ language plpgsql;

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

  first_name text not null,
  last_name text not null,
  middle_name text,

  email text not null,
  phone_number text not null,
  address text not null,

  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null
);

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
returns trigger as $$
begin
  insert into public.guests (id, email, first_name, last_name, phone_number, address)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', 'Unknown'),
    coalesce(new.raw_user_meta_data->>'last_name', 'Unknown'),
    coalesce(new.raw_user_meta_data->>'phone_number', 'Unknown'),
    coalesce(new.raw_user_meta_data->>'address', 'Unknown')
  );
  return new;
end;
$$ language plpgsql security definer;

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
    status in ('pending', 'confirmed', 'cancelled', 'completed', 'reschedule_requested')
  ) default 'pending',

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

-- Prevent overlapping reservations for the same time period (only for pending and confirmed)
create extension if not exists btree_gist;

alter table public.reservations
add constraint no_overlapping_reservations
exclude using gist (
  tstzrange(start_datetime, end_datetime) with && 
)
where (status in ('pending', 'confirmed'));

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

  status text check (status in ('pending', 'verified')) default 'pending',

  paid_at timestamptz default timezone('utc', now()),

  created_at timestamptz default timezone('utc', now()) not null,
  updated_at timestamptz default timezone('utc', now()) not null,
  reference_number text unique not null,
  account_name text not null,
  account_number text,
  verified_by uuid references public.staff_users(id) on delete set null,
  verified_at timestamptz,
  proof_path text not null,
  check (amount > 0)
);

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

    v_total_due :=
        round(v_subtotal::numeric, 2);

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
-- Assumes a private bucket named `payment-proofs` already exists.
-- Files are stored under: {auth.uid()}/{filename}

-- Create this private bucket before using the admin QR upload module.
insert into storage.buckets (id, name, public)
values ('payment-qr-codes', 'payment-qr-codes', false)
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


-- ============= NOTIFICATIONS =======================

create table public.notifications (
  notification_id uuid primary key default gen_random_uuid(),

  recipient_role text check (recipient_role in ('guest', 'staff')) not null,
  recipient_id uuid,
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

create policy "Guests can view own notifications"
on public.notifications for select
using (
  recipient_role = 'guest'
  and recipient_id = auth.uid()
);

create policy "Guests can update own notifications"
on public.notifications for update
using (
  recipient_role = 'guest'
  and recipient_id = auth.uid()
);

create policy "Guests can insert own notifications"
on public.notifications for insert
with check (
  recipient_role = 'guest'
  and recipient_id = auth.uid()
  and actor_id = auth.uid()
);

create policy "Staff can view notifications"
on public.notifications for select
to authenticated
using (
  recipient_role = 'staff'
  and (
    recipient_id is null
    or recipient_id = auth.uid()
  )
  and exists (
    select 1
    from public.staff_users
    where staff_users.id = auth.uid()
      and staff_users.is_active = true
  )
);

create policy "Staff can update notifications"
on public.notifications for update
to authenticated
using (
  recipient_role = 'staff'
  and (
    recipient_id is null
    or recipient_id = auth.uid()
  )
  and exists (
    select 1
    from public.staff_users
    where staff_users.id = auth.uid()
      and staff_users.is_active = true
  )
);

create policy "Authenticated users can create staff notifications"
on public.notifications for insert
to authenticated
with check (
  recipient_role = 'staff'
  and recipient_id is null
  and actor_id = auth.uid()
);


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