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
