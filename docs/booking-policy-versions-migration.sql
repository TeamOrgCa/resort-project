-- Run after maintenance-refunds-migration.sql. New reservations retain the policy
-- version in force when they are created; existing reservations keep NULL and use
-- the current policy when cancelled because their original version is unknown.

create table if not exists public.booking_policy_versions (
  version bigint generated always as identity primary key,
  cancellation_text text not null check (length(trim(cancellation_text)) between 20 and 5000),
  refund_text text not null check (length(trim(refund_text)) between 20 and 5000),
  refund_review_enabled boolean not null default true,
  guest_cancellation_notice_hours integer not null check (guest_cancellation_notice_hours between 0 and 8760),
  created_by uuid references public.staff_users(id),
  created_at timestamptz not null default now()
);

alter table public.booking_policy_versions enable row level security;
create policy "Admins read booking policy versions" on public.booking_policy_versions
  for select to authenticated using (exists (
    select 1 from public.staff_users where id = auth.uid() and is_active and role = 'admin'
  ));

insert into public.booking_policy_versions(cancellation_text, refund_text, refund_review_enabled, guest_cancellation_notice_hours)
select coalesce((select setting_value #>> '{}' from public.business_settings
                 where setting_key = 'reservation.cancellation_policy'),
                'Down payments are non-refundable on cancellation. Contact the resort about rescheduling.'),
       'Down payments are non-refundable. Any refund of other verified payments requires administrator review; a refund request is not a guarantee of payment.',
       true, 48
where not exists (select 1 from public.booking_policy_versions);

alter table public.reservations
  add column if not exists booking_policy_version bigint references public.booking_policy_versions(version);
alter table public.refund_requests
  add column if not exists policy_version bigint references public.booking_policy_versions(version);

create or replace function public.set_reservation_booking_policy_version()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_current_version bigint;
begin
  select version into v_current_version
  from public.booking_policy_versions order by version desc limit 1;
  if v_current_version is null then
    raise exception 'Booking policy is not configured' using errcode = '22023';
  end if;
  if new.booking_policy_version is not null and new.booking_policy_version <> v_current_version then
    raise exception 'Booking policy changed; refresh and review it again' using errcode = '40001';
  end if;
  new.booking_policy_version := v_current_version;
  return new;
end $$;

drop trigger if exists reservation_booking_policy_version on public.reservations;
create trigger reservation_booking_policy_version before insert on public.reservations
  for each row execute function public.set_reservation_booking_policy_version();

create or replace function public.get_booking_policy(p_version bigint default null)
returns table(version bigint, cancellation_text text, refund_text text, refund_review_enabled boolean,
              guest_cancellation_notice_hours integer, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.version, p.cancellation_text, p.refund_text, p.refund_review_enabled,
         p.guest_cancellation_notice_hours, p.created_at
  from public.booking_policy_versions p
  where p_version is null or p.version = p_version
  order by p.version desc limit 1;
$$;
revoke all on function public.get_booking_policy(bigint) from public;
grant execute on function public.get_booking_policy(bigint) to anon, authenticated;

create or replace function public.publish_booking_policy(
  p_cancellation_text text, p_refund_text text, p_notice_hours integer,
  p_refund_review_enabled boolean, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_previous public.booking_policy_versions%rowtype;
        v_new_version bigint;
begin
  if not exists (select 1 from public.staff_users where id = v_actor and is_active and role = 'admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_cancellation_text, ''))) not between 20 and 5000 or
     length(trim(coalesce(p_refund_text, ''))) not between 20 and 5000 or
     p_notice_hours is null or p_notice_hours not between 0 and 8760 or
     p_refund_review_enabled is null then
    raise exception 'Invalid booking policy' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(824531, 1);
  select * into v_previous from public.booking_policy_versions order by version desc limit 1;
  if v_previous.version is distinct from p_expected_version then
    raise exception 'Policy changed since it was loaded; refresh before saving' using errcode = '40001';
  end if;
  if v_previous.cancellation_text = trim(p_cancellation_text) and
     v_previous.refund_text = trim(p_refund_text) and
     v_previous.guest_cancellation_notice_hours = p_notice_hours and
     v_previous.refund_review_enabled = p_refund_review_enabled then
    return v_previous.version;
  end if;
  insert into public.booking_policy_versions(
    cancellation_text, refund_text, refund_review_enabled, guest_cancellation_notice_hours, created_by)
  values(trim(p_cancellation_text), trim(p_refund_text), p_refund_review_enabled, p_notice_hours, v_actor)
  returning version into v_new_version;
  insert into public.audit_logs(user_id, auth_user_id, action, entity_type, details)
  values(v_actor, v_actor, 'Published booking policy', 'booking_policy',
    jsonb_build_object(
      'old_version', v_previous.version, 'new_version', v_new_version,
      'old_cancellation_text', v_previous.cancellation_text,
      'new_cancellation_text', trim(p_cancellation_text),
      'old_refund_text', v_previous.refund_text,
      'new_refund_text', trim(p_refund_text),
      'old_notice_hours', v_previous.guest_cancellation_notice_hours,
      'new_notice_hours', p_notice_hours,
      'old_refund_review_enabled', v_previous.refund_review_enabled,
      'new_refund_review_enabled', p_refund_review_enabled));
  return v_new_version;
end $$;
revoke all on function public.publish_booking_policy(text,text,integer,boolean,bigint) from public, anon;
grant execute on function public.publish_booking_policy(text,text,integer,boolean,bigint) to authenticated;

-- The transaction uses the policy attached to the booking, including for
-- cancellations after an admin has published a newer version.
create or replace function public.cancel_reservation_with_refund(p_reservation uuid, p_reason text, p_admin boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_r public.reservations%rowtype; v_actor uuid := auth.uid();
  v_amount numeric(10,2); v_refund uuid; v_policy public.booking_policy_versions%rowtype;
  v_snapshot text; v_basis text;
begin
  select * into v_r from public.reservations where reservation_id = p_reservation for update;
  if not found then raise exception 'Reservation not found' using errcode = '22023'; end if;
  if p_admin then
    if not exists (select 1 from public.staff_users where id = v_actor and is_active) then
      raise exception 'Staff access required' using errcode = '42501'; end if;
  else
    if v_r.guest_id is distinct from v_actor then raise exception 'Not your reservation' using errcode = '42501'; end if;
  end if;
  if v_r.status not in ('pending', 'payment_submitted', 'confirmed', 'reschedule_requested') then
    raise exception 'Reservation cannot be cancelled' using errcode = '22023'; end if;
  select * into v_policy from public.booking_policy_versions
    where version = v_r.booking_policy_version;
  if not found then
    select * into v_policy from public.booking_policy_versions order by version desc limit 1;
    v_basis := 'legacy_current_at_cancellation';
  else v_basis := 'booked_policy'; end if;
  if not found then raise exception 'Booking policy is not configured' using errcode = '22023'; end if;
  if not p_admin and v_r.start_datetime - now() <
      make_interval(hours => v_policy.guest_cancellation_notice_hours) then
    raise exception 'Cancellation notice window has passed' using errcode = '22023';
  end if;
  select coalesce(sum(amount), 0) into v_amount from public.payments
    where reservation_id = p_reservation and status = 'verified';
  v_snapshot := format('Policy version %s (captured at cancellation). Cancellation: %s Refund: %s Refund review requests: %s.',
    v_policy.version, v_policy.cancellation_text, v_policy.refund_text,
    case when v_policy.refund_review_enabled then 'enabled' else 'disabled' end);
  update public.reservations set status = 'cancelled', cancelled_at = now(),
    cancellation_reason = trim(p_reason) where reservation_id = p_reservation;
  update public.invoices set status = 'void' where reservation_id = p_reservation;
  if v_amount > 0 and v_policy.refund_review_enabled then
    insert into public.refund_requests(reservation_id, guest_id, amount, policy_snapshot, policy_version)
      values(p_reservation, v_r.guest_id, v_amount, v_snapshot, v_policy.version)
      returning refund_id into v_refund;
    insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id, details)
      values(case when p_admin then v_actor else null end, v_actor,
        'Created refund request', 'refund_request', v_refund,
        jsonb_build_object('reservation_id', p_reservation, 'amount', v_amount,
          'policy_version', v_policy.version, 'policy_snapshot', v_snapshot,
          'policy_basis', v_basis, 'refund_review_enabled', true, 'status', 'pending'));
  end if;
  insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id, details)
    values(case when p_admin then v_actor else null end, v_actor,
      'Cancelled reservation', 'reservation', p_reservation,
      jsonb_build_object('old_status', v_r.status, 'new_status', 'cancelled',
        'reason', trim(p_reason), 'verified_payment_total', v_amount,
        'refund_id', v_refund, 'policy_version', v_policy.version,
        'policy_snapshot', v_snapshot, 'policy_basis', v_basis,
        'refund_review_enabled', v_policy.refund_review_enabled));
  return v_refund;
end $$;
revoke all on function public.cancel_reservation_with_refund(uuid,text,boolean) from public, anon;
grant execute on function public.cancel_reservation_with_refund(uuid,text,boolean) to authenticated;
