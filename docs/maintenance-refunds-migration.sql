-- Apply after first-come-booking-migration.sql. Test on a copy first.
begin;

alter table public.audit_logs add column if not exists details jsonb;

create table if not exists public.maintenance_blocks (
  block_id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  reason text not null check (length(trim(reason)) between 1 and 2000),
  start_date date not null,
  end_date date not null,
  status text not null default 'active' check (status in ('active', 'released')),
  created_by uuid references public.staff_users(id) on delete set null,
  released_by uuid references public.staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  check (end_date >= start_date),
  check (end_date <= start_date + 365)
);
create extension if not exists btree_gist;
alter table public.maintenance_blocks add constraint no_overlapping_maintenance_blocks
  exclude using gist (daterange(start_date, end_date + 1, '[)') with &&)
  where (status = 'active');
create index maintenance_blocks_dates_idx on public.maintenance_blocks(start_date, end_date) where status = 'active';
alter table public.maintenance_blocks enable row level security;
create policy "Staff view maintenance blocks" on public.maintenance_blocks for select to authenticated
  using (exists (select 1 from public.staff_users where id = auth.uid() and is_active));

-- The booking trigger already locks each Manila day; check maintenance while
-- those same locks are held. The RPC below uses the same locks for new blocks.
create or replace function public.reject_maintenance_booking()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_day date;
begin
  if new.status in ('pending', 'payment_submitted', 'confirmed', 'reschedule_requested') then
    for v_day in select generate_series(
      (new.start_datetime at time zone 'Asia/Manila')::date,
      (new.end_datetime at time zone 'Asia/Manila')::date -
        case when (new.end_datetime at time zone 'Asia/Manila')::time = time '00:00:00' then 1 else 0 end,
      interval '1 day')::date order by 1 loop
      perform pg_advisory_xact_lock(424242, hashtext(v_day::text));
    end loop;
  end if;
  if new.status in ('pending', 'payment_submitted', 'confirmed', 'reschedule_requested')
     and exists (
       select 1 from public.maintenance_blocks b
       where b.status = 'active' and daterange(b.start_date, b.end_date + 1, '[)') &&
         daterange((new.start_datetime at time zone 'Asia/Manila')::date,
           (new.end_datetime at time zone 'Asia/Manila')::date +
           case when (new.end_datetime at time zone 'Asia/Manila')::time = time '00:00:00' then 0 else 1 end, '[)')
     ) then
    raise exception 'Booking date is blocked for maintenance' using errcode = '23P01';
  end if;
  return new;
end $$;
drop trigger if exists reject_maintenance_booking_trigger on public.reservations;
create trigger reject_maintenance_booking_trigger before insert or update of start_datetime, end_datetime, status
on public.reservations for each row execute function public.reject_maintenance_booking();

create or replace function public.create_maintenance_block(p_name text, p_reason text, p_start date, p_end date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_day date; v_id uuid; v_actor uuid := auth.uid(); v_announced integer;
begin
  if not exists (select 1 from public.staff_users where id = v_actor and role = 'admin' and is_active) then
    raise exception 'Only an active admin may create maintenance blocks' using errcode = '42501';
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
  if not exists (select 1 from public.staff_users where id = v_actor and role = 'admin' and is_active) then
    raise exception 'Only an active admin may release maintenance blocks' using errcode = '42501';
  end if;
  select * into v_block from public.maintenance_blocks where block_id = p_id for update;
  if not found or v_block.status <> 'active' then raise exception 'Active block not found' using errcode = '22023'; end if;
  update public.maintenance_blocks set status = 'released', released_by = v_actor, released_at = now() where block_id = p_id;
  insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id, details)
  values(v_actor, v_actor, 'Released maintenance block', 'maintenance_block', p_id,
    jsonb_build_object('name', v_block.name, 'start_date', v_block.start_date, 'end_date', v_block.end_date));
end $$;

create table if not exists public.refund_requests (
  refund_id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.reservations(reservation_id),
  guest_id uuid references public.guests(id),
  amount numeric(10,2) not null check (amount > 0),
  policy_snapshot text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'refunded')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.staff_users(id),
  reviewed_at timestamptz,
  review_reason text,
  refunded_by uuid references public.staff_users(id),
  refunded_at timestamptz,
  gcash_reference text,
  proof_path text,
  check (status <> 'refunded' or (gcash_reference is not null and proof_path is not null and refunded_at is not null))
);
alter table public.refund_requests enable row level security;
create policy "Guests read own refunds" on public.refund_requests for select to authenticated using (guest_id = auth.uid());
create policy "Staff read refunds" on public.refund_requests for select to authenticated
  using (exists (select 1 from public.staff_users where id = auth.uid() and is_active));

create or replace function public.cancel_reservation_with_refund(p_reservation uuid, p_reason text, p_admin boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_r public.reservations%rowtype; v_actor uuid := auth.uid(); v_amount numeric(10,2);
  v_refund uuid; v_policy text;
begin
  select * into v_r from public.reservations where reservation_id = p_reservation for update;
  if not found then raise exception 'Reservation not found' using errcode = '22023'; end if;
  if p_admin then
    if not exists (select 1 from public.staff_users where id = v_actor and is_active) then
      raise exception 'Staff access required' using errcode = '42501'; end if;
  else
    if v_r.guest_id is distinct from v_actor then raise exception 'Not your reservation' using errcode = '42501'; end if;
    if v_r.start_datetime - now() < interval '48 hours' then
      raise exception 'Cancellation is only allowed at least 2 days before check-in' using errcode = '22023'; end if;
  end if;
  if v_r.status not in ('pending', 'payment_submitted', 'confirmed', 'reschedule_requested') then
    raise exception 'Reservation cannot be cancelled' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into v_amount from public.payments where reservation_id = p_reservation and status = 'verified';
  select coalesce(setting_value #>> '{}', 'Refund eligibility requires admin review') into v_policy
    from public.business_settings where setting_key = 'reservation.cancellation_policy';
  v_policy := coalesce(v_policy, 'Refund eligibility requires admin review');
  update public.reservations set status = 'cancelled', cancelled_at = now(), cancellation_reason = trim(p_reason)
    where reservation_id = p_reservation;
  update public.invoices set status = 'void' where reservation_id = p_reservation;
  if v_amount > 0 then
    insert into public.refund_requests(reservation_id, guest_id, amount, policy_snapshot)
      values(p_reservation, v_r.guest_id, v_amount, v_policy) returning refund_id into v_refund;
    insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id, details)
      values(case when p_admin then v_actor else null end, v_actor, 'Created refund request', 'refund_request', v_refund,
        jsonb_build_object('reservation_id', p_reservation, 'amount', v_amount, 'policy_snapshot', v_policy, 'status', 'pending'));
  end if;
  insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id, details)
    values(case when p_admin then v_actor else null end, v_actor, 'Cancelled reservation', 'reservation', p_reservation,
      jsonb_build_object('old_status', v_r.status, 'new_status', 'cancelled', 'reason', trim(p_reason),
        'verified_payment_total', v_amount, 'refund_id', v_refund));
  return v_refund;
end $$;

create or replace function public.transition_refund(p_id uuid, p_action text, p_reason text default null,
  p_reference text default null, p_proof text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.refund_requests%rowtype; v_actor uuid := auth.uid();
begin
  if not exists (select 1 from public.staff_users where id = v_actor and is_active and
    (role = 'admin' or (role = 'cashier' and p_action = 'refunded'))) then
    raise exception 'Insufficient staff role' using errcode = '42501'; end if;
  select * into v_r from public.refund_requests where refund_id = p_id for update;
  if not found then raise exception 'Refund request not found' using errcode = '22023'; end if;
  if p_action in ('approved', 'rejected') and v_r.status = 'pending' then
    if p_action = 'rejected' and length(trim(coalesce(p_reason, ''))) < 3 then
      raise exception 'A rejection reason is required' using errcode = '22023'; end if;
    update public.refund_requests set status = p_action, reviewed_by = v_actor, reviewed_at = now(),
      review_reason = nullif(trim(p_reason), '') where refund_id = p_id;
  elsif p_action = 'refunded' and v_r.status = 'approved' then
    if length(trim(coalesce(p_reference, ''))) < 6 or length(trim(coalesce(p_proof, ''))) < 1 then
      raise exception 'GCash reference and proof are required' using errcode = '22023'; end if;
    update public.refund_requests set status = 'refunded', refunded_by = v_actor, refunded_at = now(),
      gcash_reference = trim(p_reference), proof_path = trim(p_proof) where refund_id = p_id;
  else raise exception 'Invalid refund status transition' using errcode = '22023'; end if;
  insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id, details)
    values(v_actor, v_actor, 'Refund ' || p_action, 'refund_request', p_id,
      jsonb_build_object('reservation_id', v_r.reservation_id, 'old_status', v_r.status,
        'new_status', p_action, 'amount', v_r.amount, 'reason', p_reason,
        'gcash_reference', p_reference, 'proof_path', p_proof));
end $$;

-- Refund proof is private and can only be uploaded by active admin/cashier.
insert into storage.buckets(id, name, public) values('refund-proofs', 'refund-proofs', false)
on conflict (id) do nothing;
create policy "Staff upload refund proof" on storage.objects for insert to authenticated
with check (bucket_id = 'refund-proofs' and exists
  (select 1 from public.staff_users where id = auth.uid() and is_active and role in ('admin', 'cashier')));
create policy "Staff read refund proof" on storage.objects for select to authenticated
using (bucket_id = 'refund-proofs' and exists
  (select 1 from public.staff_users where id = auth.uid() and is_active and role in ('admin', 'cashier')));

revoke all on function public.create_maintenance_block(text,text,date,date) from public, anon;
revoke all on function public.release_maintenance_block(uuid) from public, anon;
revoke all on function public.cancel_reservation_with_refund(uuid,text,boolean) from public, anon;
revoke all on function public.transition_refund(uuid,text,text,text,text) from public, anon;
grant execute on function public.create_maintenance_block(text,text,date,date) to authenticated;
grant execute on function public.release_maintenance_block(uuid) to authenticated;
grant execute on function public.cancel_reservation_with_refund(uuid,text,boolean) to authenticated;
grant execute on function public.transition_refund(uuid,text,text,text,text) to authenticated;
commit;
