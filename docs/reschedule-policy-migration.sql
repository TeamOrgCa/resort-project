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
