-- Remove ONLY records created by the former check-in demo seed.
-- Run this entire file in Supabase SQL Editor as postgres.
-- Covers all seed dates, including checked-in, completed and cancelled demos.
-- Keeps audit history and package prices/time slots. No staff/account is deleted.
-- Stops if demo bookings have non-demo payments, refunds or linked reviews.
-- After an error, run ROLLBACK; before retrying. Safe to run again after success.
begin;

create temporary table demo_cleanup_summary(item text,deleted_count integer) on commit drop;

do $cleanup$
declare
  v_guests constant uuid[] := array[
    'de000000-0000-4000-8000-000000000001'::uuid,
    'de000000-0000-4000-8000-000000000011'::uuid,
    'de000000-0000-4000-8000-000000000012'::uuid];
  v_unit constant uuid := 'de000000-0000-4000-8000-000000000002';
  v_service constant uuid := 'de000000-0000-4000-8000-000000000003';
  v_method constant uuid := 'de000000-0000-4000-8000-000000000004';
  v_ids uuid[];
  v_count integer;
begin
  if current_user in ('anon','authenticated') or auth.uid() is not null then
    raise exception 'Run this cleanup in Supabase SQL Editor as postgres, without a guest/staff JWT.';
  end if;
  lock table public.reservations,public.payments,public.reservation_units,public.reservation_services,
    public.unit_rates,public.payment_accounts in share row exclusive mode;

  -- Require the reference format, fixed demo guest UUID AND the seed audit marker.
  -- Names alone never identify a reservation for deletion.
  select coalesce(array_agg(r.reservation_id),array[]::uuid[]) into v_ids
    from public.reservations r
    where r.guest_id is null and r.booking_type='walk_in' and r.walk_in_guest_id=any(v_guests)
      and r.reference_number ~ '^MV-DEMO-CHECKIN-[0-9]{8}(-0[23])?$'
      and exists(select 1 from public.audit_logs a where a.entity_type='reservation' and a.entity_id=r.reservation_id
        and a.action='Seeded synthetic check-in demo' and a.details->'test_data'='true'::jsonb
        and a.details->'actual_money_received'='false'::jsonb);

  if exists(select 1 from public.payments p join public.reservations r using(reservation_id)
    where p.reservation_id=any(v_ids) and not coalesce(
      p.payment_method_id=v_method and p.reference_number=r.reference_number||'-PAY'
      and p.account_name='DEMO ONLY - no actual payment' and p.proof_path=''
      and p.ocr_status='not_applicable' and p.receipt_paid_at is null,false)) then
    raise exception 'A demo booking has a non-demo payment. Nothing was deleted; review that booking separately.';
  end if;
  if exists(select 1 from public.refund_requests where reservation_id=any(v_ids)) then
    raise exception 'A demo booking has a refund record. Nothing was deleted; review that booking separately.';
  end if;
  if exists(select 1 from public.reviews where reservation_id=any(v_ids)) then
    raise exception 'A demo booking has a linked review. Nothing was deleted; review that booking separately.';
  end if;

  -- This table has a non-cascading reservation foreign key on current installs.
  if to_regclass('public.reservation_reschedule_adjustments') is not null then
    delete from public.reservation_reschedule_adjustments where reservation_id=any(v_ids);
  end if;
  delete from public.notifications where entity_type='reservation' and entity_id=any(v_ids);
  get diagnostics v_count=row_count;
  insert into demo_cleanup_summary values('Demo reservation notifications',v_count);

  -- Delete parents first: the existing FKs cascade their synthetic payments,
  -- receipts, invoices, transactions, units, services, status logs and requests.
  -- Payment guards can then see that the reservation itself has been removed.
  delete from public.reservations where reservation_id=any(v_ids);
  get diagnostics v_count=row_count;
  insert into demo_cleanup_summary values('Demo bookings and their billing records',v_count);

  delete from public.walk_in_guests w where w.walk_in_guest_id=any(v_guests)
    and w.first_name='Demo' and w.last_name in ('Tester','Tester Two','Tester Three')
    and w.address='TEST DATA - Marville Resort demonstration'
    and not exists(select 1 from public.reservations r where r.walk_in_guest_id=w.walk_in_guest_id);
  get diagnostics v_count=row_count;
  insert into demo_cleanup_summary values('Unused demo walk-in profiles',v_count);

  -- Keep shared demo catalog entries if another reservation/rate/account uses them.
  delete from public.units u where u.unit_id=v_unit and u.name='[DEMO] Cottage and rooms'
    and not exists(select 1 from public.reservation_units ru where ru.unit_id=u.unit_id)
    and not exists(select 1 from public.unit_rates ur where ur.unit_id=u.unit_id);
  get diagnostics v_count=row_count;
  insert into demo_cleanup_summary values('Unused demo accommodation',v_count);
  delete from public.services s where s.service_id=v_service and s.name='[DEMO] Extra mattress rental'
    and not exists(select 1 from public.reservation_services rs where rs.service_id=s.service_id);
  get diagnostics v_count=row_count;
  insert into demo_cleanup_summary values('Unused demo mattress service',v_count);
  delete from public.payment_methods m where m.payment_method_id=v_method and m.type='demo'
    and m.name='[DEMO] Test payment - no money received'
    and not exists(select 1 from public.payments p where p.payment_method_id=m.payment_method_id)
    and not exists(select 1 from public.payment_accounts a where a.payment_method_id=m.payment_method_id);
  get diagnostics v_count=row_count;
  insert into demo_cleanup_summary values('Unused demo payment method',v_count);

  if cardinality(v_ids)>0 then
    insert into public.audit_logs(action,entity_type,details)
      values('Removed synthetic check-in demo','reservation',
        jsonb_build_object('test_data',true,'deleted_reservation_ids',to_jsonb(v_ids),'actual_money_received',false));
  end if;
end
$cleanup$;

select * from demo_cleanup_summary;
commit;
