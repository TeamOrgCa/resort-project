-- Apply after billing-discount-documents-migration.sql and stay-completion-migration.sql.
-- Then apply room-rates-discounts-migration.sql for configurable 3h/12h stays,
-- current extension defaults and atomic walk-in discounts. Keep this order.
-- Test on a restored database first. Private swimming bookings keep timestamp
-- exclusivity; physical room claims use timestamp intervals across all types.
begin;
create extension if not exists btree_gist;

insert into public.role_permissions(role,permissions) values ('staff','{}'),('cashier','{}') on conflict do nothing;
update public.role_permissions set permissions=(select array_agg(distinct p) from unnest(permissions ||
  case when role='staff' then array['rooms','room_operations','room_export'] else array['rooms'] end) p);

create table if not exists public.room_classifications (
  classification_id uuid primary key default gen_random_uuid(), code text not null unique,
  name text not null check(length(btrim(name)) between 2 and 100),
  included_capacity integer not null check(included_capacity between 1 and 100),
  maximum_capacity integer not null check(maximum_capacity between 1 and 100 and maximum_capacity>=included_capacity),
  base_rate numeric(12,2) not null default 0 check(base_rate>=0),
  base_hours integer not null default 12 check(base_hours between 1 and 168),
  additional_guest_rate numeric(12,2) not null default 0 check(additional_guest_rate>=0),
  extension_hourly_rate numeric(12,2) not null default 100 check(extension_hourly_rate>=0),
  cleaning_buffer_minutes integer not null default 60 check(cleaning_buffer_minutes between 0 and 1440)
);
insert into public.room_classifications(code,name,included_capacity,maximum_capacity) values
  ('standard','Standard Rooms',2,2),('family','Family Rooms',4,6) on conflict(code) do nothing;
create table if not exists public.physical_rooms (
  room_id uuid primary key default gen_random_uuid(), room_number text not null unique check(length(btrim(room_number)) between 1 and 20),
  name text not null default '', classification_id uuid not null references public.room_classifications,
  status text not null default 'vacant' check(status in ('vacant','occupied','cleaning','maintenance')),
  is_active boolean not null default true, condition_notes text,
  updated_at timestamptz not null default now()
);
insert into public.physical_rooms(room_number,name,classification_id)
  select case c.code when 'standard' then 'S' else 'F' end || lpad(n::text,2,'0'),c.name,c.classification_id
  from public.room_classifications c cross join generate_series(1,10) n where c.code in ('standard','family')
  on conflict(room_number) do nothing;

alter table public.reservations add column if not exists commercial_type text not null default 'private_swimming'
  check(commercial_type in ('private_swimming','public_swimming','room_accommodation'));
-- Only service-side room booking may select a non-private commercial type.
create or replace function public.guard_room_commercial_type() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated') and
    ((tg_op='INSERT' and new.commercial_type<>'private_swimming') or
     (tg_op='UPDATE' and new.commercial_type is distinct from old.commercial_type)) then
    raise exception 'Use the authorized room reservation action' using errcode='42501'; end if;
  return new;
end $$;
drop trigger if exists guard_room_commercial_type on public.reservations;
create trigger guard_room_commercial_type before insert or update on public.reservations for each row execute function public.guard_room_commercial_type();
alter table public.reservations drop constraint if exists one_active_reservation_per_date;
-- Replace both predecessor names. Keeping the old global time constraint would
-- still prevent independent rooms and public bookings from sharing an interval.
-- Use the existing time-slot rule, never the older calendar-day projection:
-- a day package and its following overnight package may share a Manila date.
-- [) includes arrival and excludes departure, permitting adjacent time slots.
-- Existing reservation dates, statuses, payments and guest data are unchanged.
alter table public.reservations drop constraint if exists one_active_reservation_per_time;
alter table public.reservations add constraint one_active_reservation_per_time exclude using gist (
  tstzrange(start_datetime,end_datetime,'[)') with &&
) where(commercial_type='private_swimming' and status in ('pending','payment_submitted','confirmed','reschedule_requested'));

create table if not exists public.room_assignments (
  assignment_id uuid primary key default gen_random_uuid(), room_id uuid not null references public.physical_rooms,
  reservation_id uuid not null references public.reservations(reservation_id) on delete cascade, occupants integer not null check(occupants between 1 and 100),
  starts_at timestamptz not null, expected_checkout timestamptz not null,
  checked_in_at timestamptz, checked_out_at timestamptz,
  state text not null default 'reserved' check(state in ('reserved','occupied','completed','cancelled','transferred')),
  check(expected_checkout>starts_at), check(state<>'occupied' or checked_in_at is not null)
);
create index if not exists room_assignment_reservation_idx on public.room_assignments(reservation_id);
create index if not exists room_assignment_schedule_idx on public.room_assignments(room_id,starts_at,expected_checkout);
create unique index if not exists room_one_current_occupancy on public.room_assignments(room_id) where state='occupied';
create table if not exists public.room_maintenance (
  maintenance_id uuid primary key default gen_random_uuid(), room_id uuid not null references public.physical_rooms,
  starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
  reason text not null check(length(btrim(reason)) between 3 and 2000), created_by uuid not null references public.staff_users(id),
  completed_at timestamptz, completed_by uuid references public.staff_users(id)
);
create index if not exists room_maintenance_schedule_idx on public.room_maintenance(room_id,starts_at,ends_at);
create table if not exists public.room_activity (
  activity_id uuid primary key default gen_random_uuid(), room_id uuid not null references public.physical_rooms,
  -- Like audit_logs.entity_id, retain the identifier even if an unpaid booking
  -- is removed during the existing multi-step booking flow's compensation.
  reservation_id uuid, reference_number text,
  activity_type text not null, description text not null, staff_id uuid references public.staff_users(id),
  staff_name text not null, created_at timestamptz not null default clock_timestamp(), details jsonb not null default '{}'
);
create index if not exists room_activity_history_idx on public.room_activity(room_id,created_at desc);
create table if not exists public.room_charges (
  charge_id uuid primary key default gen_random_uuid(), room_id uuid not null references public.physical_rooms,
  reservation_id uuid not null references public.reservations(reservation_id),
  kind text not null check(kind in ('accommodation','additional_guest','extension','additional_service')),
  description text not null, amount numeric(12,2) not null check(amount>=0), created_by uuid not null references public.staff_users(id),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists room_charge_bill_idx on public.room_charges(reservation_id);
create table if not exists public.room_extensions (
  extension_id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.room_assignments,
  old_checkout timestamptz not null, new_checkout timestamptz not null check(new_checkout>old_checkout),
  hours integer not null check(hours between 1 and 168), hourly_rate numeric(12,2) not null,
  charge_id uuid not null references public.room_charges, approved_by uuid not null references public.staff_users(id),
  created_at timestamptz not null default clock_timestamp()
);
-- Explicit links avoid guessing which existing catalog names represent rooms.
-- Selecting a linked unit/service in any existing booking flow reserves physical
-- inventory in the same transaction as that catalog line.
create table if not exists public.room_catalog_links (
  link_id uuid primary key default gen_random_uuid(), classification_id uuid not null references public.room_classifications,
  unit_id uuid unique references public.units(unit_id), service_id uuid unique references public.services(service_id),
  is_active boolean not null default true,
  check((unit_id is null)<>(service_id is null))
);
alter table public.room_assignments add column if not exists catalog_link_id uuid references public.room_catalog_links;
create table if not exists public.room_occupancy_alerts (
  assignment_id uuid not null references public.room_assignments, expected_checkout timestamptz not null,
  indicator text not null check(indicator in ('expiring','overdue')), created_at timestamptz not null default now(),
  primary key(assignment_id,expected_checkout,indicator)
);

create or replace function public.room_staff_allowed(p_staff uuid,p_permission text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_users s where s.id=p_staff and s.is_active and
    (s.role='admin' or (s.role='staff' and p_permission='room_operations' or p_permission='rooms') and
      exists(select 1 from public.role_permissions rp where rp.role=s.role and p_permission=any(rp.permissions))));
$$;
create or replace function public.room_log(p_room uuid,p_reservation uuid,p_staff uuid,p_type text,p_description text,p_details jsonb default '{}')
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; actor_name text;
begin
  select id,full_name into actor,actor_name from public.staff_users where id=p_staff;
  actor_name:=coalesce(actor_name,case when p_staff is null then 'System' else 'Guest' end);
  insert into public.room_activity(room_id,reservation_id,reference_number,activity_type,description,staff_id,staff_name,details)
  values(p_room,p_reservation,(select reference_number from public.reservations where reservation_id=p_reservation),p_type,p_description,actor,actor_name,p_details);
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(actor,p_staff,p_description,'room',p_room,p_details||jsonb_build_object('reservation_id',p_reservation,'activity_type',p_type));
end $$;

-- Every claim (including transfers, maintenance and edits through older booking
-- routes) takes this same transaction lock before validating timestamp intervals.
create or replace function public.room_assert_available(p_room uuid,p_start timestamptz,p_end timestamptz,p_exclude uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare c public.room_classifications%rowtype; r public.physical_rooms%rowtype;
begin
  perform pg_advisory_xact_lock(73124,1);
  select * into r from public.physical_rooms where room_id=p_room for update;
  select * into c from public.room_classifications where classification_id=r.classification_id;
  if not r.is_active or r.room_id is null then raise exception 'Room is inactive or missing' using errcode='22023'; end if;
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<=p_start then
    raise exception 'Choose a valid room interval' using errcode='22023'; end if;
  if exists(select 1 from public.room_assignments a join public.reservations b using(reservation_id)
    where a.room_id=p_room and a.assignment_id is distinct from p_exclude and
      (a.state='occupied' or a.state='reserved' and b.status in ('pending','payment_submitted','confirmed','reschedule_requested')
       and (b.status<>'pending' or b.payment_deadline_at is null or b.payment_deadline_at>clock_timestamp())) and
      (a.state='occupied' and a.expected_checkout<clock_timestamp() or
       a.starts_at<p_end+make_interval(mins=>c.cleaning_buffer_minutes) and a.expected_checkout+make_interval(mins=>c.cleaning_buffer_minutes)>p_start)) then
    raise exception 'Room is already occupied or reserved, including its cleaning buffer' using errcode='40001'; end if;
  if exists(select 1 from public.room_maintenance m where m.room_id=p_room and m.completed_at is null
    and (m.ends_at<clock_timestamp() or m.starts_at<p_end+make_interval(mins=>c.cleaning_buffer_minutes) and m.ends_at>p_start)) or
    exists(select 1 from public.maintenance_blocks m where m.status='active' and m.start_datetime<p_end and m.end_datetime>p_start) then
    raise exception 'Room interval conflicts with scheduled maintenance' using errcode='40001'; end if;
end $$;
create or replace function public.room_guard_assignment() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.room_classifications%rowtype;
begin
  if new.state in ('reserved','occupied') then
    perform public.room_assert_available(new.room_id,new.starts_at,new.expected_checkout,new.assignment_id);
    select classification.* into c from public.physical_rooms pr join public.room_classifications classification using(classification_id) where pr.room_id=new.room_id;
    if new.occupants>c.maximum_capacity then raise exception 'Room maximum capacity exceeded' using errcode='22023'; end if;
  end if;
  return new;
end $$;
drop trigger if exists room_guard_assignment on public.room_assignments;
create trigger room_guard_assignment before insert or update on public.room_assignments for each row execute function public.room_guard_assignment();

create or replace function public.room_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Room history and charge records are immutable' using errcode='42501'; end $$;
drop trigger if exists room_immutable on public.room_activity;
create trigger room_immutable before update or delete on public.room_activity for each row execute function public.room_immutable();
drop trigger if exists room_immutable on public.room_charges;
create trigger room_immutable before update or delete on public.room_charges for each row execute function public.room_immutable();
drop trigger if exists room_immutable on public.room_extensions;
create trigger room_immutable before update or delete on public.room_extensions for each row execute function public.room_immutable();

-- Charge deltas update the existing bill, current invoice, and verified payment
-- totals atomically. No payment or verification path is added by this module.
create or replace function public.room_charge_bill() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.reservations where reservation_id=new.reservation_id for update;
  perform set_config('app.room_bill_change',new.reservation_id::text,true);
  update public.transactions set total_amount=total_amount+new.amount where reservation_id=new.reservation_id;
  if not found then raise exception 'Reservation bill not found' using errcode='22023'; end if;
  perform public.refresh_reservation_payment_totals(new.reservation_id);
  update public.invoices set total_amount=t.total_amount,
    status=case when t.paid_amount>=t.total_amount then 'paid' when t.paid_amount>0 then 'partially_paid' else 'issued' end
    from public.transactions t where t.reservation_id=new.reservation_id and invoice_id=(select invoice_id from public.invoices
      where reservation_id=new.reservation_id and status<>'void' order by created_at desc,invoice_id desc limit 1);
  insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
    select s.role,s.id,new.created_by,'Room charge requires collection',new.description||' — PHP '||new.amount,
      '/admin/transactions','reservation',new.reservation_id from public.staff_users s where s.is_active
      and (s.role='admin' or s.role='cashier' and exists(select 1 from public.role_permissions p where p.role=s.role and 'payment_entry'=any(p.permissions)))
      and new.amount>0;
  return new;
end $$;
drop trigger if exists room_charge_bill on public.room_charges;
create trigger room_charge_bill after insert on public.room_charges for each row execute function public.room_charge_bill();
create or replace function public.room_guard_bill_total() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.total_amount is distinct from old.total_amount and exists(select 1 from public.room_charges where reservation_id=new.reservation_id)
    and current_setting('app.room_bill_change',true) is distinct from new.reservation_id::text
    and current_setting('app.booking_discount',true) is distinct from new.reservation_id::text then
    raise exception 'Room bills must preserve their recorded charges. Use Room Management or the authorized discount action' using errcode='40001'; end if;
  return new;
end $$;
drop trigger if exists room_guard_bill_total on public.transactions;
create trigger room_guard_bill_total before update of total_amount on public.transactions for each row execute function public.room_guard_bill_total();
create or replace function public.room_guard_charged_schedule() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (new.start_datetime,new.end_datetime,new.booking_mode,new.adult_count,new.child_count) is distinct from
    (old.start_datetime,old.end_datetime,old.booking_mode,old.adult_count,old.child_count)
    and exists(select 1 from public.room_charges where reservation_id=new.reservation_id) then
    raise exception 'This reservation has a room bill. Use Room Management for guest occupancy and stay extensions' using errcode='40001'; end if;
  return new;
end $$;
drop trigger if exists room_guard_charged_schedule on public.reservations;
create trigger room_guard_charged_schedule before update on public.reservations for each row execute function public.room_guard_charged_schedule();

-- Room accommodation is the eligible package basis for room-only reservations;
-- swimming reservations retain the existing booked pool-package discount basis.
create or replace function public.booking_discount_package_price(p_reservation uuid)
returns numeric language plpgsql stable security definer set search_path='' as $$
declare r public.reservations%rowtype; rates jsonb; tier text; mode text; hours numeric; start_hour numeric; room_base numeric;
begin
  select * into r from public.reservations where reservation_id=p_reservation;
  if r.commercial_type<>'private_swimming' then
    select coalesce(sum(amount),0) into room_base from public.room_charges where reservation_id=p_reservation and kind='accommodation';
    return room_base;
  end if;
  select p.rates into rates from public.package_rate_versions p where p.version=r.package_rate_version;
  if rates is null then raise exception 'Booked package rates are unavailable' using errcode='22023'; end if;
  tier:=case when extract(isodow from r.start_datetime at time zone 'Asia/Manila') in (5,6,7) then 'weekend' else 'weekday' end;
  mode:=coalesce(r.booking_mode,'day');
  if mode='custom' then
    hours:=extract(epoch from r.end_datetime-r.start_datetime)/3600;
    start_hour:=extract(hour from r.start_datetime at time zone 'Asia/Manila')+extract(minute from r.start_datetime at time zone 'Asia/Manila')/60;
    select m into mode from (values('day',abs(hours-8)+abs(start_hour-8)),('night',abs(hours-12)+abs(start_hour-18)),
      ('whole_day',abs(hours-22)+least(abs(start_hour-8),abs(start_hour-18)))) options(m,score)
      order by score,(rates->tier->m->>'baseRate')::numeric limit 1;
  end if;
  return (rates->tier->mode->>'baseRate')::numeric;
end $$;
revoke all on function public.booking_discount_package_price(uuid) from public,anon,authenticated;

-- Synchronize old reservation attendance/cancellation/rescheduling actions with
-- physical room records. Occupied rooms remain occupied past expected checkout.
create or replace function public.room_sync_reservation() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.room_assignments%rowtype; actor uuid;
begin
  if (new.status,new.start_datetime,new.end_datetime,new.checked_in_at,new.checked_out_at) is not distinct from
     (old.status,old.start_datetime,old.end_datetime,old.checked_in_at,old.checked_out_at) then return new; end if;
  perform pg_advisory_xact_lock(73124,1);
  actor:=coalesce(new.checked_out_by,new.checked_in_by,new.cancelled_by);
  for a in select * from public.room_assignments where reservation_id=new.reservation_id and state in ('reserved','occupied')
    and (new.checked_in_at is not distinct from old.checked_in_at or nullif(current_setting('app.room_checkin_assignment',true),'') is null
      or assignment_id::text=current_setting('app.room_checkin_assignment',true)) order by room_id for update loop
    if new.checked_out_at is distinct from old.checked_out_at and new.checked_out_at is not null then
      update public.room_assignments set state='completed',checked_out_at=new.checked_out_at where assignment_id=a.assignment_id;
      update public.physical_rooms set status='cleaning' where room_id=a.room_id;
      perform public.room_log(a.room_id,new.reservation_id,actor,'check_out','Guest checked out; room requires cleaning');
    elsif new.status in ('cancelled','expired','rejected','no_show') and a.state='reserved' then
      update public.room_assignments set state='cancelled' where assignment_id=a.assignment_id;
      perform public.room_log(a.room_id,new.reservation_id,actor,'reservation_released','Room reservation released');
    elsif new.start_datetime is distinct from old.start_datetime or new.end_datetime is distinct from old.end_datetime then
      update public.room_assignments set starts_at=new.start_datetime,expected_checkout=new.end_datetime where assignment_id=a.assignment_id;
      perform public.room_log(a.room_id,new.reservation_id,actor,'rescheduled','Room reservation dates changed');
    elsif new.checked_in_at is distinct from old.checked_in_at and new.checked_in_at is not null then
      if not exists(select 1 from public.physical_rooms where room_id=a.room_id and status='vacant' and is_active) then
        raise exception 'Assigned room must be ready before check-in' using errcode='40001'; end if;
      update public.room_assignments set state='occupied',checked_in_at=new.checked_in_at where assignment_id=a.assignment_id;
      update public.physical_rooms set status='occupied' where room_id=a.room_id;
      perform public.room_log(a.room_id,new.reservation_id,actor,'check_in','Guest checked in');
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists room_sync_reservation on public.reservations;
create trigger room_sync_reservation after update on public.reservations for each row execute function public.room_sync_reservation();
create or replace function public.room_guard_reservation_delete() returns trigger language plpgsql security definer set search_path='' as $$
declare claim record;
begin
  perform pg_advisory_xact_lock(73124,1);
  if exists(select 1 from public.room_assignments where reservation_id=old.reservation_id and checked_in_at is not null) then
    raise exception 'Reservations with room attendance must retain their history' using errcode='40001'; end if;
  for claim in select room_id from public.room_assignments where reservation_id=old.reservation_id and state='reserved' loop
    perform public.room_log(claim.room_id,old.reservation_id,null,'reservation_released','Unpaid booking removed; physical room hold released');
  end loop;
  return old;
end $$;
drop trigger if exists room_guard_reservation_delete on public.reservations;
create trigger room_guard_reservation_delete before delete on public.reservations for each row execute function public.room_guard_reservation_delete();

-- Prevent legacy editors from silently repricing a room bill using pool-package
-- formulas. Room operations and existing payments remain available.
create or replace function public.room_guard_legacy_edit() returns trigger language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
  rid:=case when tg_op='DELETE' then old.reservation_id else new.reservation_id end;
  if exists(select 1 from public.room_charges where reservation_id=rid) then
    raise exception 'This reservation has room charges. Use Room Management to record additional charges' using errcode='40001'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
drop trigger if exists room_guard_legacy_edit on public.reservation_services;
create trigger room_guard_legacy_edit before insert or update or delete on public.reservation_services for each row execute function public.room_guard_legacy_edit();
drop trigger if exists room_guard_legacy_edit on public.reservation_units;
create trigger room_guard_legacy_edit before insert or update or delete on public.reservation_units for each row execute function public.room_guard_legacy_edit();

create or replace function public.room_claim_catalog() returns trigger language plpgsql security definer set search_path='' as $$
declare link public.room_catalog_links%rowtype; booking public.reservations%rowtype; candidate public.physical_rooms%rowtype;
  capacity integer; needed integer; room_candidate uuid; actor uuid; existing integer;
begin
  perform pg_advisory_xact_lock(73124,1);
  select * into link from public.room_catalog_links where is_active and (
    (tg_table_name='reservation_units' and unit_id=(to_jsonb(new)->>'unit_id')::uuid) or
    (tg_table_name='reservation_services' and service_id=(to_jsonb(new)->>'service_id')::uuid));
  if not found then return new; end if;
  select * into booking from public.reservations where reservation_id=new.reservation_id for update;
  if booking.status not in ('pending','payment_submitted','confirmed','reschedule_requested') then return new; end if;
  if booking.checked_in_at is not null then raise exception 'Use Room Management to change occupied room assignments' using errcode='40001'; end if;
  select included_capacity into capacity from public.room_classifications where classification_id=link.classification_id;
  select count(*)::integer into existing from public.room_assignments where reservation_id=new.reservation_id and catalog_link_id=link.link_id and state='reserved';
  needed:=new.quantity-existing;
  if needed<0 then
    update public.room_assignments set state='cancelled' where assignment_id in (select assignment_id from public.room_assignments
      where reservation_id=new.reservation_id and catalog_link_id=link.link_id and state='reserved' order by room_id limit -needed);
  end if;
  actor:=case when exists(select 1 from public.staff_users where id=auth.uid()) then auth.uid() else null end;
  while needed>0 loop
    room_candidate:=null;
    for candidate in select * from public.physical_rooms where classification_id=link.classification_id and is_active order by room_number for update loop
      begin
        perform public.room_assert_available(candidate.room_id,booking.start_datetime,booking.end_datetime);
        room_candidate:=candidate.room_id; exit;
      exception when serialization_failure or invalid_parameter_value then null;
      end;
    end loop;
    if room_candidate is null then raise exception 'No physical room is available for the selected catalog item and interval' using errcode='40001'; end if;
    insert into public.room_assignments(room_id,reservation_id,occupants,starts_at,expected_checkout,catalog_link_id)
      values(room_candidate,new.reservation_id,least(capacity,booking.adult_count+booking.child_count),booking.start_datetime,booking.end_datetime,link.link_id);
    perform public.room_log(room_candidate,new.reservation_id,actor,'reservation_created','Physical room allocated from booked catalog item');
    needed:=needed-1;
  end loop;
  return new;
end $$;
drop trigger if exists room_claim_catalog on public.reservation_units;
create trigger room_claim_catalog after insert or update on public.reservation_units for each row execute function public.room_claim_catalog();
drop trigger if exists room_claim_catalog on public.reservation_services;
create trigger room_claim_catalog after insert or update on public.reservation_services for each row execute function public.room_claim_catalog();
create or replace function public.room_release_catalog() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(73124,1);
  update public.room_assignments set state='cancelled' where reservation_id=old.reservation_id and state='reserved'
    and catalog_link_id in(select link_id from public.room_catalog_links where
      (tg_table_name='reservation_units' and unit_id=(to_jsonb(old)->>'unit_id')::uuid) or
      (tg_table_name='reservation_services' and service_id=(to_jsonb(old)->>'service_id')::uuid));
  return old;
end $$;
drop trigger if exists room_release_catalog on public.reservation_units;
create trigger room_release_catalog after delete on public.reservation_units for each row execute function public.room_release_catalog();
drop trigger if exists room_release_catalog on public.reservation_services;
create trigger room_release_catalog after delete on public.reservation_services for each row execute function public.room_release_catalog();

-- Resort-wide maintenance must also consider room extensions whose expected
-- checkout is later than the original reservation's end timestamp.
create or replace function public.room_guard_resort_maintenance() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='active' then
    perform pg_advisory_xact_lock(73124,1);
    if exists(select 1 from public.room_assignments a join public.reservations b using(reservation_id)
      where (a.state='occupied' or a.state='reserved' and b.status in ('pending','payment_submitted','confirmed','reschedule_requested')
        and (b.status<>'pending' or b.payment_deadline_at is null or b.payment_deadline_at>clock_timestamp()))
      and (a.state='occupied' and a.expected_checkout<clock_timestamp() or a.starts_at<new.end_datetime and a.expected_checkout>new.start_datetime)) then
      raise exception 'Resort maintenance conflicts with an assigned room or an active room extension' using errcode='40001'; end if;
  end if;
  return new;
end $$;
drop trigger if exists room_guard_resort_maintenance on public.maintenance_blocks;
create trigger room_guard_resort_maintenance before insert or update on public.maintenance_blocks for each row execute function public.room_guard_resort_maintenance();

create or replace function public.room_set_catalog_link(p_staff uuid,p_classification uuid,p_unit uuid default null,p_service uuid default null,p_remove boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare link public.room_catalog_links%rowtype;
begin
  if not public.room_staff_allowed(p_staff,'configuration') then raise exception 'Admin configuration permission required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(73124,1);
  select * into link from public.room_catalog_links where unit_id=p_unit or service_id=p_service for update;
  if exists(select 1 from public.room_assignments a join public.reservations b using(reservation_id) where a.catalog_link_id=link.link_id
    and a.state in ('reserved','occupied') and b.status in ('pending','payment_submitted','confirmed','reschedule_requested')) then
    raise exception 'Resolve linked room reservations before changing the catalog link' using errcode='40001'; end if;
  if p_remove then update public.room_catalog_links set is_active=false where link_id=link.link_id;
  else
    if p_service is not null and not exists(select 1 from public.services where service_id=p_service and billing_type='quantity') then
      raise exception 'Room catalog items must use quantity-based billing (one quantity per room)' using errcode='22023'; end if;
    if link.link_id is not null then
      update public.room_catalog_links set classification_id=p_classification,is_active=true where link_id=link.link_id;
    else insert into public.room_catalog_links(classification_id,unit_id,service_id) values(p_classification,p_unit,p_service); end if;
  end if;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details) values(p_staff,p_staff,'Updated physical room catalog link','room_classification',p_classification,jsonb_build_object('unit_id',p_unit,'service_id',p_service,'removed',p_remove));
end $$;

-- Called on dashboard refresh; deduplicated by occupancy, deadline and alert.
create or replace function public.room_emit_alerts() returns void language plpgsql security definer set search_path='' as $$
declare claim record; alert text;
begin
  for claim in select a.*,r.room_number,b.reference_number from public.room_assignments a join public.physical_rooms r using(room_id)
    join public.reservations b using(reservation_id) where a.state='occupied' and a.expected_checkout<=clock_timestamp()+interval '30 minutes' loop
    alert:=case when claim.expected_checkout<clock_timestamp() then 'overdue' else 'expiring' end;
    insert into public.room_occupancy_alerts(assignment_id,expected_checkout,indicator) values(claim.assignment_id,claim.expected_checkout,alert) on conflict do nothing;
    if found then
      insert into public.notifications(recipient_role,recipient_id,title,message,action_url,entity_type,entity_id)
        select s.role,s.id,case when alert='overdue' then 'Room occupancy overdue' else 'Room occupancy expiring soon' end,
          claim.room_number||' · '||claim.reference_number||' · Staff checkout or an approved extension is required.',
          '/admin/rooms','room',claim.room_id from public.staff_users s where s.is_active
          and public.room_staff_allowed(s.id,'rooms');
    end if;
  end loop;
end $$;

create or replace function public.room_operate(p_staff uuid,p_room uuid,p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare r public.physical_rooms%rowtype; c public.room_classifications%rowtype; a public.room_assignments%rowtype;
  b public.reservations%rowtype; target public.physical_rooms%rowtype; aid uuid; rid uuid; wid uuid; cid uuid;
  finish timestamptz; start_at timestamptz; hours integer; heads integer; amount numeric; result jsonb; reason text;
begin
  if not public.room_staff_allowed(p_staff,case when p_action in ('configure','inventory') then 'configuration' else 'room_operations' end) then
    raise exception 'Room operation permission required' using errcode='42501'; end if;
  if not public.room_staff_allowed(p_staff,'rooms') then raise exception 'Room access required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(73124,1);
  select * into r from public.physical_rooms where room_id=p_room for update;
  if not found and p_action<>'inventory' then raise exception 'Room not found' using errcode='P0002'; end if;
  select * into c from public.room_classifications where classification_id=r.classification_id for update;
  select * into a from public.room_assignments where room_id=p_room and state='occupied' for update;
  if a.assignment_id is not null then
    perform 1 from public.reservations where reservation_id=a.reservation_id for update;
    select * into b from public.reservations where reservation_id=a.reservation_id;
  end if;
  reason:=btrim(coalesce(p_input->>'reason',''));
  if p_action='configure' then
    if exists(select 1 from public.room_assignments a join public.physical_rooms pr using(room_id)
      where pr.classification_id=c.classification_id and a.state in ('reserved','occupied') and a.occupants>(p_input->>'maximum_capacity')::integer) then
      raise exception 'Capacity cannot invalidate existing room reservations' using errcode='40001'; end if;
    update public.room_classifications set name=p_input->>'name',included_capacity=(p_input->>'included_capacity')::integer,
      maximum_capacity=(p_input->>'maximum_capacity')::integer,base_rate=(p_input->>'base_rate')::numeric,base_hours=(p_input->>'base_hours')::integer,
      additional_guest_rate=(p_input->>'additional_guest_rate')::numeric,extension_hourly_rate=(p_input->>'extension_hourly_rate')::numeric,
      cleaning_buffer_minutes=(p_input->>'cleaning_buffer_minutes')::integer where classification_id=c.classification_id;
    for a in select claim.* from public.room_assignments claim join public.physical_rooms pr using(room_id)
      where pr.classification_id=c.classification_id and claim.state in ('reserved','occupied') loop
      perform public.room_assert_available(a.room_id,a.starts_at,a.expected_checkout,a.assignment_id);
    end loop;
  elsif p_action='inventory' then
    insert into public.physical_rooms(room_number,name,classification_id) values(btrim(p_input->>'room_number'),btrim(p_input->>'name'),(p_input->>'classification_id')::uuid) returning * into r;
    p_room:=r.room_id;
  elsif p_action='deactivate' then
    if r.status<>'vacant' or exists(select 1 from public.room_assignments a join public.reservations b using(reservation_id)
      where a.room_id=p_room and a.state in ('reserved','occupied') and b.status in ('pending','payment_submitted','confirmed','reschedule_requested')) then
      raise exception 'Resolve room occupancy and upcoming reservations before deactivation' using errcode='40001'; end if;
    if not exists(select 1 from public.staff_users where id=p_staff and role='admin') then raise exception 'Admin permission required' using errcode='42501'; end if;
    update public.physical_rooms set is_active=false where room_id=p_room;
  elsif p_action='reactivate' then
    if not exists(select 1 from public.staff_users where id=p_staff and role='admin') then raise exception 'Admin permission required' using errcode='42501'; end if;
    update public.physical_rooms set is_active=true where room_id=p_room;
  elsif p_action in ('reserve','assign') then
    heads:=(p_input->>'occupants')::integer;
    if heads is null or heads<1 or heads>c.maximum_capacity then raise exception 'Choose occupants within room capacity' using errcode='22023'; end if;
    if p_action='assign' then
      select * into b from public.reservations where reference_number=btrim(p_input->>'reference') for update;
      if not found or b.status not in ('pending','payment_submitted','confirmed') or b.checked_out_at is not null then
        raise exception 'Choose an active reservation that has not checked out' using errcode='22023'; end if;
      if b.checked_in_at is not null and r.status<>'vacant' then raise exception 'Assign an existing checked-in guest to a ready, unoccupied room' using errcode='40001'; end if;
      rid:=b.reservation_id; start_at:=b.start_datetime; finish:=b.end_datetime;
    else
      start_at:=(p_input->>'starts_at')::timestamptz; finish:=(p_input->>'ends_at')::timestamptz;
      if c.base_rate<=0 or (heads>c.included_capacity and c.additional_guest_rate<=0) then
        raise exception 'Configure room accommodation and additional guest rates first' using errcode='22023'; end if;
      if start_at<=clock_timestamp() or finish>start_at+interval '30 days' then raise exception 'Choose a future start and a stay of at most 30 days' using errcode='22023'; end if;
      if length(btrim(coalesce(p_input->>'first_name','')))<1 or length(btrim(coalesce(p_input->>'last_name','')))<1 or
        length(btrim(coalesce(p_input->>'address','')))<3 or coalesce(p_input->>'phone','') !~ '^\+639[0-9]{9}$' then
        raise exception 'Enter the guest name, Philippine mobile number and address' using errcode='22023'; end if;
      insert into public.walk_in_guests(first_name,last_name,phone_number,address) values(btrim(p_input->>'first_name'),btrim(p_input->>'last_name'),p_input->>'phone',btrim(p_input->>'address')) returning walk_in_guest_id into wid;
      insert into public.reservations(walk_in_guest_id,reference_number,booking_mode,booking_type,commercial_type,start_datetime,end_datetime,adult_count,child_count,status)
        values(wid,'RM-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),'custom','walk_in',coalesce(p_input->>'commercial_type','room_accommodation'),start_at,finish,heads,0,'pending') returning * into b;
      rid:=b.reservation_id;
      insert into public.transactions(reservation_id,total_amount,status) values(rid,0,'unpaid') on conflict(reservation_id) do nothing;
    end if;
    perform public.room_assert_available(p_room,start_at,finish);
    insert into public.room_assignments(room_id,reservation_id,occupants,starts_at,expected_checkout,state,checked_in_at)
      values(p_room,rid,heads,start_at,finish,case when b.checked_in_at is not null then 'occupied' else 'reserved' end,b.checked_in_at) returning assignment_id into aid;
    if b.checked_in_at is not null then update public.physical_rooms set status='occupied' where room_id=p_room; end if;
    amount:=c.base_rate*greatest(1,ceil(extract(epoch from finish-start_at)/(3600*c.base_hours)));
    if p_action='reserve' or coalesce((p_input->>'charge_accommodation')::boolean,false) then
      if c.base_rate<=0 then raise exception 'Configure accommodation rate first' using errcode='22023'; end if;
      insert into public.room_charges(room_id,reservation_id,kind,description,amount,created_by) values(p_room,rid,'accommodation',r.room_number||' accommodation',amount,p_staff);
    end if;
    if heads>c.included_capacity then
      if c.additional_guest_rate<=0 then raise exception 'Configure the additional guest rate first' using errcode='22023'; end if;
      insert into public.room_charges(room_id,reservation_id,kind,description,amount,created_by)
        values(p_room,rid,'additional_guest',r.room_number||' additional guests', (heads-c.included_capacity)*c.additional_guest_rate,p_staff);
    end if;
    perform public.room_log(p_room,rid,p_staff,'reservation_created','Room assigned to reservation',jsonb_build_object('assignment_id',aid,'occupants',heads));
    return jsonb_build_object('reservation_id',rid,'reference_number',b.reference_number);
  elsif p_action='check_in' then
    select * into a from public.room_assignments where assignment_id=(p_input->>'assignment_id')::uuid and room_id=p_room and state='reserved' for update;
    if not found or r.status<>'vacant' or not r.is_active then raise exception 'Select a reserved, ready room' using errcode='40001'; end if;
    heads:=coalesce((p_input->>'occupants')::integer,a.occupants);
    if heads<a.occupants or heads>c.maximum_capacity then raise exception 'Occupants must cover the booked guest count and stay within capacity' using errcode='22023'; end if;
    amount:=(greatest(0,heads-c.included_capacity)-greatest(0,a.occupants-c.included_capacity))*c.additional_guest_rate;
    if heads>greatest(c.included_capacity,a.occupants) and c.additional_guest_rate<=0 then raise exception 'Configure the additional guest rate before check-in' using errcode='22023'; end if;
    update public.room_assignments set occupants=heads where assignment_id=a.assignment_id;
    if amount>0 then insert into public.room_charges(room_id,reservation_id,kind,description,amount,created_by)
      values(p_room,a.reservation_id,'additional_guest',r.room_number||' additional guests at arrival',amount,p_staff); end if;
    select * into b from public.reservations where reservation_id=a.reservation_id for update;
    if b.checked_in_at is null then
      perform set_config('app.room_checkin_assignment',a.assignment_id::text,true);
      perform public.check_in_reservation(a.reservation_id,p_staff);
    else
      if b.status<>'confirmed' or a.expected_checkout<=clock_timestamp() or a.starts_at>clock_timestamp() then raise exception 'Reservation is not ready for check-in' using errcode='40001'; end if;
      update public.room_assignments set state='occupied',checked_in_at=clock_timestamp() where assignment_id=a.assignment_id;
      update public.physical_rooms set status='occupied' where room_id=p_room;
      perform public.room_log(p_room,a.reservation_id,p_staff,'check_in','Guest checked in');
    end if;
  elsif p_action in ('check_out','extend','transfer','charge') then
    if a.assignment_id is null or r.status<>'occupied' then raise exception 'Room has no active occupancy' using errcode='40001'; end if;
    if p_input->>'assignment_id' is distinct from a.assignment_id::text then raise exception 'Room occupancy changed. Refresh before continuing' using errcode='40001'; end if;
    if p_action='check_out' then
      perform public.refresh_reservation_payment_totals(a.reservation_id);
      if not exists(select 1 from public.transactions where reservation_id=a.reservation_id and balance<=0 and paid_amount>=total_amount) or
        exists(select 1 from public.payments where reservation_id=a.reservation_id and status='pending') then
        raise exception 'Settle the bill and review pending payments before checkout' using errcode='40001'; end if;
      update public.room_assignments set state='completed',checked_out_at=clock_timestamp() where assignment_id=a.assignment_id;
      update public.physical_rooms set status='cleaning' where room_id=p_room;
      perform public.room_log(p_room,a.reservation_id,p_staff,'check_out','Guest checked out; room requires cleaning');
      if not exists(select 1 from public.room_assignments where reservation_id=a.reservation_id and state in ('reserved','occupied')) then
        perform public.check_out_reservation(a.reservation_id,p_staff);
      end if;
    elsif p_action='extend' then
      hours:=(p_input->>'hours')::integer;
      if hours is null or hours<1 or hours>168 or c.extension_hourly_rate<=0 then raise exception 'Choose 1–168 hours and configure an extension rate' using errcode='22023'; end if;
      if (p_input->>'expected_checkout')::timestamptz is distinct from a.expected_checkout then
        raise exception 'Checkout changed. Review the extension again' using errcode='40001'; end if;
      if (p_input->>'hourly_rate')::numeric is distinct from c.extension_hourly_rate then raise exception 'Extension rate changed. Refresh the quote' using errcode='40001'; end if;
      finish:=a.expected_checkout+make_interval(hours=>hours);
      if finish<=clock_timestamp() then raise exception 'Extension must cover the overdue stay' using errcode='22023'; end if;
      perform public.room_assert_available(p_room,a.starts_at,finish,a.assignment_id);
      update public.room_assignments set expected_checkout=finish where assignment_id=a.assignment_id;
      insert into public.room_charges(room_id,reservation_id,kind,description,amount,created_by)
        values(p_room,a.reservation_id,'extension',r.room_number||' extension ('||hours||' hours)',hours*c.extension_hourly_rate,p_staff) returning charge_id into cid;
      insert into public.room_extensions(assignment_id,old_checkout,new_checkout,hours,hourly_rate,charge_id,approved_by)
        values(a.assignment_id,a.expected_checkout,finish,hours,c.extension_hourly_rate,cid,p_staff);
      perform public.room_log(p_room,a.reservation_id,p_staff,'extension','Stay extended by '||hours||' hours',jsonb_build_object('old_checkout',a.expected_checkout,'new_checkout',finish,'charge',hours*c.extension_hourly_rate));
    elsif p_action='charge' then
      amount:=(p_input->>'amount')::numeric;
      if amount is null or amount<=0 or amount>1000000 or length(reason) not between 3 and 500 then raise exception 'Enter a charge of up to PHP 1,000,000 and a description' using errcode='22023'; end if;
      insert into public.room_charges(room_id,reservation_id,kind,description,amount,created_by) values(p_room,a.reservation_id,'additional_service',reason,round(amount,2),p_staff);
      perform public.room_log(p_room,a.reservation_id,p_staff,'additional_charge',reason,jsonb_build_object('amount',amount));
    else
      select * into target from public.physical_rooms where room_id=(p_input->>'target_room')::uuid for update;
      if not found or target.room_id=p_room or target.status<>'vacant' or not target.is_active then raise exception 'Choose another ready room' using errcode='40001'; end if;
      if target.classification_id<>r.classification_id then raise exception 'Transfer to the same room classification to preserve the booked rate' using errcode='22023'; end if;
      perform public.room_assert_available(target.room_id,clock_timestamp(),a.expected_checkout);
      update public.room_assignments set state='transferred',checked_out_at=clock_timestamp() where assignment_id=a.assignment_id;
      insert into public.room_assignments(room_id,reservation_id,occupants,starts_at,expected_checkout,state,checked_in_at)
        values(target.room_id,a.reservation_id,a.occupants,clock_timestamp(),a.expected_checkout,'occupied',clock_timestamp());
      update public.physical_rooms set status=case when room_id=p_room then 'cleaning' else 'occupied' end where room_id in (p_room,target.room_id);
      perform public.room_log(p_room,a.reservation_id,p_staff,'transfer','Guest transferred to '||target.room_number);
      perform public.room_log(target.room_id,a.reservation_id,p_staff,'transfer','Guest transferred from '||r.room_number);
    end if;
  elsif p_action='maintenance' then
    start_at:=(p_input->>'starts_at')::timestamptz; finish:=(p_input->>'ends_at')::timestamptz;
    if start_at<clock_timestamp()-interval '5 minutes' or length(reason) not between 3 and 2000 then raise exception 'Enter a current or future maintenance interval and reason' using errcode='22023'; end if;
    perform public.room_assert_available(p_room,start_at,finish);
    insert into public.room_maintenance(room_id,starts_at,ends_at,reason,created_by) values(p_room,start_at,finish,reason,p_staff);
    if start_at<=clock_timestamp() and r.status<>'occupied' then update public.physical_rooms set status='maintenance',condition_notes=reason where room_id=p_room; end if;
  elsif p_action='complete_maintenance' then
    update public.room_maintenance set completed_at=clock_timestamp(),completed_by=p_staff
      where maintenance_id=(p_input->>'maintenance_id')::uuid and room_id=p_room and completed_at is null;
    if not found then raise exception 'Active maintenance record not found' using errcode='40001'; end if;
    if r.status<>'occupied' then update public.physical_rooms set status='cleaning',condition_notes='Maintenance completed; housekeeping required' where room_id=p_room; end if;
  elsif p_action='ready' then
    if r.status<>'cleaning' or exists(select 1 from public.room_maintenance where room_id=p_room and completed_at is null and starts_at<=clock_timestamp()) then
      raise exception 'Complete maintenance and confirm housekeeping before marking ready' using errcode='40001'; end if;
    update public.physical_rooms set status='vacant',condition_notes='Clean and ready for check-in' where room_id=p_room;
  elsif p_action='cleaning' then
    if r.status<>'vacant' then raise exception 'Only a vacant room may be marked for cleaning' using errcode='40001'; end if;
    update public.physical_rooms set status='cleaning',condition_notes='Awaiting housekeeping' where room_id=p_room;
  else raise exception 'Unknown room action' using errcode='22023'; end if;
  update public.physical_rooms set updated_at=clock_timestamp() where room_id=p_room;
  if p_action not in ('check_in','check_out','extend','transfer','charge') then
    perform public.room_log(p_room,a.reservation_id,p_staff,p_action,replace(initcap(p_action),'_',' ')||case when reason<>'' then ': '||reason else '' end,p_input);
  end if;
  return jsonb_build_object('success',true,'room_id',p_room);
end $$;

-- New tables are private to the authenticated server API; browser clients have
-- no direct write access. Actor IDs are supplied only after session validation.
do $$ declare t text; f regprocedure; begin
  foreach t in array array['room_classifications','physical_rooms','room_assignments','room_maintenance','room_activity','room_charges','room_extensions','room_catalog_links','room_occupancy_alerts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'room\_%' escape '\' loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
-- Billing documents can read charge descriptions using existing authenticated
-- staff permissions or reservation ownership; write privileges remain revoked.
grant select on public.room_charges to authenticated;
drop policy if exists "Read authorized room bill lines" on public.room_charges;
create policy "Read authorized room bill lines" on public.room_charges for select to authenticated using(
  public.room_staff_allowed(auth.uid(),'rooms') or exists(select 1 from public.reservations r where r.reservation_id=room_charges.reservation_id and r.guest_id=auth.uid())
);
grant execute on function public.room_staff_allowed(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
