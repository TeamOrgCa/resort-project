-- Apply AFTER public-swimming-booking-migration.sql and non-refundable-reschedule-fees-migration.sql.
-- Public customer cancellations return 80% of remaining verified payments.
-- A manager may explicitly approve a documented 100% exception; cashier payout
-- and independent transfer verification continue through the existing workflow.
begin;
do $$ begin
  if to_regprocedure('public.get_cancellation_preview_before_public(uuid,text)') is null then
    alter function public.get_cancellation_preview(uuid,text) rename to get_cancellation_preview_before_public;
  end if;
end $$;
create or replace function public.get_cancellation_preview(p_reservation uuid,p_initiator text default 'guest')
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; r public.reservations%rowtype; net numeric; deduction numeric; blocked text;
begin
  -- The existing function verifies the owner/staff actor and initiator permission.
  result:=public.get_cancellation_preview_before_public(p_reservation,p_initiator);
  select * into r from public.reservations where reservation_id=p_reservation;
  if r.commercial_type<>'public_swimming' or r.room_pricing then return result; end if;
  net:=(result->>'netPaid')::numeric;
  deduction:=case when p_initiator='resort' then 0 else round(net*0.20,2) end;
  if r.checked_in_at is not null or r.start_datetime<=clock_timestamp() then blocked:='Public swimming cancellations must be made before the booked session starts.';
  elsif r.status not in ('pending','payment_submitted','confirmed','reschedule_requested') then blocked:='This booking cannot be cancelled.';
  elsif exists(select 1 from public.payments where reservation_id=p_reservation and status='pending') then blocked:='Review pending payments before cancelling.';
  elsif exists(select 1 from public.refund_requests where reservation_id=p_reservation and status='payout_submitted') then blocked:='Verify the existing refund transfer before cancelling.';
  end if;
  result:=(result-'quote')||jsonb_build_object('commercialType','public_swimming','deduction',deduction,'refundableAmount',net-deduction,'depositAmount',deduction,
    'retainedDeposit',deduction,'rescheduleFees',0,'retainedRescheduleFees',0,'noticeHours',0,'allowed',blocked is null,'blockedReason',blocked,
    'outcome',case when net>deduction then 'pending_refund' else 'no_refund' end,
    'rule',case when p_initiator='resort' then 'Full remaining verified payment is refundable for an authorized resort cancellation.' else 'Public swimming: 20% of remaining verified payments is retained; 80% is refundable. A manager may approve a documented 100% refund exception.' end);
  return result||jsonb_build_object('quote',md5(result::text));
end $$;
create or replace function public.approve_public_full_refund(p_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare f public.refund_requests%rowtype; rid uuid; paid numeric; other numeric; before_amount numeric;
begin
  if not public.refund_staff_permission('refund_approval') or not exists(select 1 from public.staff_users where id=auth.uid() and is_active and role in ('admin','staff')) then raise exception 'Manager refund approval permission required' using errcode='42501'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 5 and 2000 then raise exception 'Document the valid reason for a 100%% refund' using errcode='22023'; end if;
  select reservation_id into rid from public.refund_requests where refund_id=p_id;
  perform 1 from public.reservations where reservation_id=rid and commercial_type='public_swimming' and not room_pricing and status='cancelled' for update;
  if not found then raise exception 'Choose a cancelled public swimming booking' using errcode='22023'; end if;
  perform 1 from public.transactions where reservation_id=rid for update;
  select * into f from public.refund_requests where refund_id=p_id for update;
  if f.status not in ('pending','reviewed') or f.request_kind<>'cancellation' or f.workflow_version<>2 then raise exception 'Choose a current cancellation refund awaiting approval' using errcode='40001'; end if;
  if exists(select 1 from public.payments where reservation_id=rid and status='pending') then raise exception 'Review pending payments first' using errcode='40001'; end if;
  select coalesce(sum(amount),0) into paid from public.payments where reservation_id=rid and status='verified';
  select coalesce(sum(amount),0) into other from public.refund_requests where reservation_id=rid and refund_id<>p_id and status in ('pending','reviewed','approved','payout_submitted','refunded');
  if paid<=other then raise exception 'No unallocated verified payment remains' using errcode='40001'; end if;
  before_amount:=f.amount;
  update public.refund_requests set amount=paid-other,policy_snapshot='100% refund exception approved by a manager for a documented valid reason.',calculation_snapshot=(calculation_snapshot-'quote')||jsonb_build_object('deduction',0,'retainedDeposit',0,'retainedRescheduleFees',0,'refundableAmount',paid-other,
    'managerFullRefund',true,'exceptionReason',btrim(p_reason),'approvedBy',auth.uid(),'rule','100% refund exception approved by a manager for the documented valid reason.') where refund_id=p_id;
  perform public.transition_refund_workflow(p_id,'approved',btrim(p_reason),null,null,'GCash',false);
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details) values(auth.uid(),auth.uid(),'Approved public swimming 100% refund exception','refund_request',p_id,jsonb_build_object('before_amount',before_amount,'after_amount',paid-other,'reason',btrim(p_reason),'reservation_id',rid));
end $$;
revoke all on function public.get_cancellation_preview_before_public(uuid,text),public.get_cancellation_preview(uuid,text),public.approve_public_full_refund(uuid,text) from public,anon;
revoke all on function public.get_cancellation_preview_before_public(uuid,text) from authenticated;
grant execute on function public.get_cancellation_preview(uuid,text),public.approve_public_full_refund(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
