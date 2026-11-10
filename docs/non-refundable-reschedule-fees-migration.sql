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
