-- Apply after role-permissions, cancellation-refund-workflow,
-- admin-refund-verification, maintenance-refunds and stay-completion migrations.
-- Admins manage Users/Configuration/Catalog and read operational modules.
-- Managers (stored role: staff) approve refunds; payout verification stays independent.
begin;

update public.role_permissions set permissions=(select array_agg(distinct permission)
  from unnest(permissions || array['transactions','refund_approval']) permission) where role='staff';
update public.role_permissions set permissions=array_remove(permissions,'refund_approval') where role='cashier';

create or replace function public.guard_admin_operational_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_bucket text; v_old_bucket text;
begin
  if tg_table_schema='storage' then
    v_bucket:=case when tg_op='DELETE' then old.bucket_id else new.bucket_id end;
    v_old_bucket:=case when tg_op='UPDATE' then old.bucket_id else v_bucket end;
    if v_bucket not in ('payment-proofs','refund-proofs','review-images') and v_old_bucket not in ('payment-proofs','refund-proofs','review-images') then
      if tg_op='DELETE' then return old; end if; return new;
    end if;
  end if;
  if exists(select 1 from public.staff_users where id=auth.uid() and role='admin') then
    raise exception 'Administrators have view-only access to operational modules' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_admin_operational_write() from public,anon,authenticated;

do $$ declare v_table text; begin
  foreach v_table in array array['reservations','walk_in_guests','reservation_reschedules','reservation_units',
    'reservation_services','reservation_reschedule_adjustments','transactions','payments','refund_requests',
    'invoices','receipts','maintenance_blocks','ocular_visits','reviews','reservation_status_logs','review_submission_log'] loop
    if to_regclass('public.'||v_table) is not null then
      execute format('drop trigger if exists guard_admin_operational_write on public.%I',v_table);
      execute format('create trigger guard_admin_operational_write before insert or update or delete on public.%I for each row execute function public.guard_admin_operational_write()',v_table);
    end if;
  end loop;
  if to_regclass('storage.objects') is not null then
    execute 'drop trigger if exists guard_admin_operational_proof_write on storage.objects';
    execute 'create trigger guard_admin_operational_proof_write before insert or update or delete on storage.objects for each row execute function public.guard_admin_operational_write()';
  end if;
end $$;

-- The role check applies even when grants are forged or a security-definer RPC is called directly.
create or replace function public.refund_staff_permission(p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_users s where s.id=auth.uid() and s.is_active and s.role<>'admin'
    and (p_permission<>'refund_approval' or s.role='staff')
    and exists(select 1 from public.role_permissions rp where rp.role=s.role and p_permission=any(rp.permissions)));
$$;
revoke all on function public.refund_staff_permission(text) from public,anon;
grant execute on function public.refund_staff_permission(text) to authenticated;


create or replace function public.notify_refund_workflow(p_guest uuid,p_title text,p_message text,p_entity text,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_title text:=case when lower(btrim(p_title))='refund refunded' then 'Refund completed' else p_title end;
begin
  if p_guest is not null then
    insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
      values('guest',p_guest,auth.uid(),v_title,p_message,'/manage',p_entity,p_id);
  end if;
  insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
    select s.role,s.id,auth.uid(),v_title,p_message,'/admin/transactions?tab=refunds',p_entity,p_id
    from public.staff_users s where s.is_active and (s.role in ('admin','cashier') or exists
      (select 1 from public.role_permissions rp where rp.role=s.role and
        rp.permissions && array['refund_review','refund_approval','refund_payout','refund_verify']));
end $$;
revoke all on function public.notify_refund_workflow(uuid,text,text,text,uuid) from public,anon,authenticated;

create or replace function public.get_cancellation_preview(p_reservation uuid,p_initiator text default 'guest')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; t public.transactions%rowtype; p public.booking_policy_versions%rowtype;
  v_staff boolean:=public.refund_staff_permission('cancel_reservation'); v_gross numeric; v_previous numeric;
  v_net numeric; v_base numeric; v_deposit numeric; v_deduction numeric; v_refund numeric; v_allowed boolean;
  v_result jsonb; v_block text;
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
  v_deduction:=case when p_initiator='guest' then least(v_net,v_deposit) else 0 end;
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
    'policyVersion',p.version,'noticeHours',p.guest_cancellation_notice_hours,'allowed',v_allowed,'blockedReason',v_block,
    'outcome',case when v_refund>0 then 'pending_refund' else 'no_refund' end,
    'rule',case when p_initiator='resort' then 'Full refund of remaining verified payments; no deposit deduction.'
      else 'The initial 20% deposit is retained. Only remaining verified payments above that deposit are refundable.' end);
  return v_result || jsonb_build_object('quote',md5(v_result::text));
end $$;

create or replace function public.recalculate_legacy_cancellation_refund(p_id uuid,p_initiator text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare f public.refund_requests%rowtype; v_res uuid; q jsonb;
begin
  if not public.refund_staff_permission('refund_approval') then
    raise exception 'Manager refund approval permission required' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Document why the legacy cancellation was classified this way' using errcode='22023'; end if;
  select reservation_id into v_res from public.refund_requests where refund_id=p_id;
  perform 1 from public.reservations where reservation_id=v_res and status='cancelled' for update;
  if not found then raise exception 'A cancelled reservation is required' using errcode='22023'; end if;
  perform 1 from public.transactions where reservation_id=v_res for update;
  select * into f from public.refund_requests where refund_id=p_id for update;
  if f.workflow_version<>1 or f.request_kind<>'cancellation' or f.status not in ('pending','reviewed','approved') then
    raise exception 'Only an unprocessed legacy cancellation request can be recalculated' using errcode='22023'; end if;
  q:=public.get_cancellation_preview(v_res,p_initiator);
  if exists(select 1 from public.payments where reservation_id=v_res and status='pending') then
    raise exception 'Review pending payments first' using errcode='40001'; end if;
  update public.refund_requests set amount=case when (q->>'refundableAmount')::numeric>0 then (q->>'refundableAmount')::numeric else amount end,
    status=case when (q->>'refundableAmount')::numeric>0 then 'pending' else 'rejected' end,
    workflow_version=2,calculation_snapshot=q,cancellation_event_id=v_res,policy_snapshot=q->>'rule',
    reviewed_by=null,reviewed_at=null,review_reason=case when (q->>'refundableAmount')::numeric=0 then 'Cancelled - No Refund: deposit retained.' else null end,
    payment_reviewed_by=null,payment_reviewed_at=null,payment_review_notes=null where refund_id=p_id;
  update public.reservations set cancellation_initiator=p_initiator,cancellation_snapshot=q where reservation_id=v_res;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(auth.uid(),auth.uid(),'Recalculated legacy cancellation refund','refund_request',p_id,
      jsonb_build_object('previous',to_jsonb(f),'calculation',q,'reason',trim(p_reason)));
  perform public.notify_refund_workflow(f.guest_id,'Cancellation refund recalculated',
    format('Verified cancellation refund: PHP %s; retained deposit: PHP %s. Manager documentation: %s. A positive refund requires a new review and approval.',q->>'refundableAmount',q->>'deduction',trim(p_reason)), 'refund_request',p_id);
end $$;

create or replace function public.transition_refund_workflow(p_id uuid,p_action text,p_reason text default null,
  p_reference text default null,p_proof text default null,p_method text default 'GCash',p_verified boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare f public.refund_requests%rowtype; v_id uuid; r public.reservations%rowtype;
  v_total numeric; v_available numeric; v_other numeric; v_new text; v_permission text;
begin
  v_permission:=case when p_action='payout_submitted' then 'refund_payout' when p_action='refunded' then 'refund_verify' when p_action in ('approved','rejected') then 'refund_approval' else 'refund_review' end;
  if not public.refund_staff_permission(v_permission) then raise exception 'Refund permission required' using errcode='42501'; end if;
  if p_action in ('approved','rejected') and not exists(select 1 from public.staff_users where id=auth.uid() and role='staff' and is_active) then
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
  if p_action='reviewed' and f.status='pending' then
    if p_verified is distinct from true or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Confirm payment records and enter review notes' using errcode='22023'; end if;
    update public.refund_requests set status='reviewed',payment_reviewed_by=auth.uid(),payment_reviewed_at=now(),payment_review_notes=trim(p_reason) where refund_id=p_id;
    v_new:='reviewed';
  elsif p_action='approved' and f.status='reviewed' then
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
      raise exception 'Another authorized staff member must verify this payout' using errcode='42501'; end if;
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
      case v_new when 'reviewed' then 'Payment records reviewed; awaiting manager approval.' when 'approved' then 'Approved; awaiting manual transfer through an approved payment method.'
        when 'payout_submitted' then 'Transfer documented; awaiting verification by authorized staff. The refund is not completed yet.'
        when 'refunded' then 'Transfer verified. Refund completed.' else 'Request rejected. ' end,
      case when v_new='rejected' then trim(p_reason) else '' end),'refund_request',p_id);
end $$;

create or replace function public.create_maintenance_block(p_name text, p_reason text, p_start date, p_end date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_day date; v_id uuid; v_actor uuid := auth.uid(); v_announced integer;
begin
  if not exists (select 1 from public.staff_users where id = v_actor and role = 'staff' and is_active and public.refund_staff_permission('edit_reservation')) then
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

create or replace function public.release_maintenance_block(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_block public.maintenance_blocks%rowtype; v_actor uuid := auth.uid();
begin
  if not exists (select 1 from public.staff_users where id = v_actor and role = 'staff' and is_active and public.refund_staff_permission('edit_reservation')) then
    raise exception 'Only an authorized manager may release maintenance blocks' using errcode = '42501';
  end if;
  select * into v_block from public.maintenance_blocks where block_id = p_id for update;
  if not found or v_block.status <> 'active' then raise exception 'Active block not found' using errcode = '22023'; end if;
  update public.maintenance_blocks set status = 'released', released_by = v_actor, released_at = now() where block_id = p_id;
  insert into public.audit_logs(user_id, auth_user_id, action, entity_type, entity_id, details)
  values(v_actor, v_actor, 'Released maintenance block', 'maintenance_block', p_id,
    jsonb_build_object('name', v_block.name, 'start_date', v_block.start_date, 'end_date', v_block.end_date));
end $$;


-- Keep configuration/catalog/account policies intact; only operational proof uploads change.
drop policy if exists "Staff upload refund proof" on storage.objects;
create policy "Staff upload refund proof" on storage.objects for insert to authenticated
with check(bucket_id='refund-proofs' and public.refund_staff_permission('refund_payout'));

drop policy if exists "Staff read refund proof" on storage.objects;
create policy "Staff read refund proof" on storage.objects for select to authenticated using(bucket_id='refund-proofs' and exists
  (select 1 from public.staff_users s where s.id=auth.uid() and s.is_active and (s.role='admin' or exists
    (select 1 from public.role_permissions rp where rp.role=s.role and rp.permissions && array['refund_review','refund_approval','refund_payout','refund_verify']))));

revoke all on function public.get_cancellation_preview(uuid,text) from public,anon;
grant execute on function public.get_cancellation_preview(uuid,text) to authenticated;
revoke all on function public.recalculate_legacy_cancellation_refund(uuid,text,text) from public,anon;
grant execute on function public.recalculate_legacy_cancellation_refund(uuid,text,text) to authenticated;
revoke all on function public.transition_refund_workflow(uuid,text,text,text,text,text,boolean) from public,anon;
grant execute on function public.transition_refund_workflow(uuid,text,text,text,text,text,boolean) to authenticated;
revoke all on function public.create_maintenance_block(text,text,date,date) from public,anon;
grant execute on function public.create_maintenance_block(text,text,date,date) to authenticated;
revoke all on function public.release_maintenance_block(uuid) from public,anon;
grant execute on function public.release_maintenance_block(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
