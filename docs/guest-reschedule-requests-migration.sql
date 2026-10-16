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
