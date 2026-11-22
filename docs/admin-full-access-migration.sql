-- Apply LAST, after all existing operational migrations, including manager-cashier-refund-workflow,
-- non-refundable-reschedule-fees, accommodation-and-manager-service-edit, timed-maintenance-auto-ocular,
-- manager-ocular-cancellation, reservation-no-show, public-access-sales and review-moderation-permissions.
-- Safe to reapply. Restores full admin access; retains validation, evidence, auditing and independent payout verification.
begin;

-- Remove only admin-specific vetoes; workflow guards and RLS remain in place.
do $$ declare t record; begin
  for t in select n.nspname,c.relname,g.tgname from pg_trigger g
    join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where not g.tgisinternal and n.nspname in ('public','storage')
      and g.tgname in ('guard_admin_operational_write','guard_admin_operational_proof_write','guard_review_admin_write')
  loop
    execute format('drop trigger %I on %I.%I',t.tgname,t.nspname,t.relname);
  end loop;
end $$;

create or replace function public.refund_staff_permission(p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select p_permission<>'refund_review' and exists(
    select 1 from public.staff_users s where s.id=auth.uid() and s.is_active
      and (s.role='admin' or (
        (p_permission not in ('refund_approval','refund_verify') or s.role='staff')
        and (p_permission<>'refund_payout' or s.role='cashier')
        and exists(select 1 from public.role_permissions rp where rp.role=s.role and p_permission=any(rp.permissions)))));
$$;
revoke all on function public.refund_staff_permission(text) from public,anon;
grant execute on function public.refund_staff_permission(text) to authenticated;

-- get_cancellation_preview: includes administrators.
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
  if p_initiator='resort' and not exists(select 1 from public.staff_users where id=auth.uid() and role in ('admin','staff') and is_active) then
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

-- transition_refund_workflow: includes administrators.
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
  if p_action in ('approved','rejected') and not exists(select 1 from public.staff_users where id=auth.uid() and role in ('admin','staff') and is_active) then
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

-- edit_staff_reservation: includes administrators.
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
  if v_r.status not in ('pending', 'confirmed') or v_r.checked_out_at is not null
    or (v_r.end_datetime <= now() and v_r.checked_in_at is null)
    or (v_r.status = 'pending' and v_r.payment_deadline_at <= now()) then
    raise exception 'This reservation is no longer editable' using errcode = '40001';
  end if;
  if exists (select 1 from public.payments where reservation_id = p_reservation and status = 'pending')
    or exists (select 1 from public.reservation_reschedules where reservation_id = p_reservation and status = 'pending') then
    raise exception 'Resolve pending payments or reschedule requests before editing' using errcode = '40001';
  end if;
  if exists(select 1 from public.refund_requests where reservation_id=p_reservation and status in ('pending','reviewed','approved','payout_submitted')) then
    raise exception 'Resolve the open refund before editing this booking' using errcode='40001'; end if;
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
  if v_unit_changed and (v_r.checked_in_at is not null or v_r.start_datetime <= now())
    and not exists(select 1 from public.staff_users where id=p_staff and role in ('admin','staff') and is_active) then
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
      if (v_r.checked_in_at is not null or v_r.start_datetime <= now()) and v_quantity < v_existing.quantity
        and not exists(select 1 from public.staff_users where id=p_staff and role in ('admin','staff') and is_active) then
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
  if (v_r.checked_in_at is not null or v_r.start_datetime <= now())
    and not exists(select 1 from public.staff_users where id=p_staff and role in ('admin','staff') and is_active)
    and exists (select 1 from public.reservation_services
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

-- complete_ocular_visit: includes administrators.
create or replace function public.complete_ocular_visit(p_visit uuid,p_staff uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.ocular_visits%rowtype; v_start timestamptz;
begin
  if auth.role() is distinct from 'service_role' or auth.uid() is not null or not exists(
    select 1 from public.staff_users s where s.id=p_staff and s.is_active and (s.role='admin' or exists(
      select 1 from public.role_permissions rp where rp.role=s.role and 'ocular_approval'=any(rp.permissions)))) then
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

-- cancel_manager_ocular_visit: includes administrators.
create or replace function public.cancel_manager_ocular_visit(p_visit uuid,p_reason text,p_staff uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_visit public.ocular_visits%rowtype;
begin
  if not exists(select 1 from public.staff_users s where s.id=p_staff and s.is_active and (s.role='admin' or (s.role='staff'
    and exists(select 1 from public.role_permissions rp where rp.role=s.role and 'ocular_approval'=any(rp.permissions))))) then
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

-- mark_reservation_no_show: includes administrators.
create or replace function public.mark_reservation_no_show(p_reservation uuid,p_staff uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype;
begin
  if not exists(select 1 from public.staff_users s left join public.role_permissions rp on rp.role=s.role
    where s.id=p_staff and s.is_active and (s.role='admin' or (s.role='staff' and 'edit_reservation'=any(rp.permissions)))) then
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

-- record_public_access_sale: includes administrators.
create or replace function public.record_public_access_sale(p_request uuid,p_guest text,p_contact text,p_type text,p_payment_for text,
  p_amount numeric,p_method uuid,p_reference text,p_proof text,p_received boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.staff_users%rowtype; m public.payment_methods%rowtype; existing public.public_access_sales%rowtype;
  sale public.public_access_sales%rowtype; v_reference text; v_cash boolean;
begin
  select * into s from public.staff_users where id=auth.uid() and is_active and role in ('admin','cashier') for share;
  if not found or s.active_session_id is null or s.active_session_id::text is distinct from auth.jwt()->>'session_id'
    or (s.role<>'admin' and not exists(select 1 from public.role_permissions where role=s.role and 'transactions'=any(permissions) and 'payment_entry'=any(permissions))) then
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

-- create_maintenance_block: includes administrators.
create or replace function public.create_maintenance_block(p_name text, p_reason text, p_start date, p_end date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_day date; v_id uuid; v_actor uuid := auth.uid(); v_announced integer;
begin
  if not exists (select 1 from public.staff_users where id = v_actor and role in ('admin','staff') and is_active and public.refund_staff_permission('edit_reservation')) then
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

-- Preserve service-only access to RPCs accepting an actor ID.
revoke all on function public.edit_staff_reservation(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.edit_staff_reservation(uuid,uuid,jsonb,jsonb) to service_role;
revoke all on function public.complete_ocular_visit(uuid,uuid) from public,anon,authenticated;
grant execute on function public.complete_ocular_visit(uuid,uuid) to service_role;
revoke all on function public.cancel_manager_ocular_visit(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.cancel_manager_ocular_visit(uuid,text,uuid) to service_role;
revoke all on function public.mark_reservation_no_show(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.mark_reservation_no_show(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
