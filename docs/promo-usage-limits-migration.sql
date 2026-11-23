-- Apply AFTER guest-discounts-promos-refund-details-migration.sql.
-- A successful reservation means confirmed (including a zero-total booking).
-- Pending bookings reserve capacity; only the winning promo consumes a use.
-- Confirmation is counted once. Cancelling a previously confirmed booking does
-- not replenish a used voucher. Unconfirmed cancellations/expiry release holds.
begin;

alter table public.promo_codes add column if not exists max_uses integer;
alter table public.promo_codes drop constraint if exists promo_codes_max_uses_check;
alter table public.promo_codes add constraint promo_codes_max_uses_check check(max_uses is null or max_uses>=1);
alter table public.transactions add column if not exists discount_promo_id uuid references public.promo_codes(promo_id);

create table if not exists public.promo_redemptions(
  promo_id uuid not null references public.promo_codes(promo_id),
  reservation_id uuid not null references public.reservations(reservation_id) on delete cascade,
  state text not null check(state in ('held','redeemed','released')),
  redeemed_at timestamptz,
  primary key(promo_id,reservation_id),
  check((state='redeemed')=(redeemed_at is not null))
);
create index if not exists promo_redemptions_reservation_idx on public.promo_redemptions(reservation_id);
alter table public.promo_redemptions enable row level security;
revoke all on public.promo_redemptions from public,anon,authenticated;
grant select on public.promo_redemptions to service_role;

-- A stored identity preserves redemption history if an administrator renames a code.
create or replace function public.attach_booking_promo_identity()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.discount_promo_code is not distinct from old.discount_promo_code then
    new.discount_promo_id:=old.discount_promo_id;
  elsif new.discount_promo_code is null then new.discount_promo_id:=null;
  else
    select promo_id into new.discount_promo_id from public.promo_codes where code=new.discount_promo_code;
    if not found then raise exception 'Promo code is unavailable' using errcode='22023'; end if;
  end if;
  return new;
end $$;
revoke all on function public.attach_booking_promo_identity() from public,anon,authenticated;

-- Backfill without changing existing bills or counting a reservation twice.
-- Run before attaching the identity trigger so pre-migration snapshots are linked.
update public.transactions t set discount_promo_id=p.promo_id
  from public.promo_codes p where t.discount_promo_id is null and t.discount_promo_code=p.code;
insert into public.promo_redemptions(promo_id,reservation_id,state,redeemed_at)
select t.discount_promo_id,r.reservation_id,
  case when r.status in ('confirmed','completed','no_show') then 'redeemed' else 'held' end,
  case when r.status in ('confirmed','completed','no_show') then now() else null end
from public.transactions t join public.reservations r using(reservation_id)
where t.discount_promo_id is not null and t.discount_kind='promo' and t.discount_amount>0
  and r.status in ('pending','payment_submitted','reschedule_requested','confirmed','completed','no_show')
on conflict(promo_id,reservation_id) do nothing;

drop trigger if exists attach_booking_promo_identity on public.transactions;
create trigger attach_booking_promo_identity before insert or update of discount_promo_code,discount_promo_id
  on public.transactions for each row execute function public.attach_booking_promo_identity();

-- Service-only aggregate: no guest, reservation or payout identities are exposed.
create or replace view public.promo_code_availability as
select p.*,
  counts.usage_count, counts.pending_uses,
  case when p.max_uses is null then null else greatest(0,p.max_uses-counts.usage_count-counts.pending_uses) end as remaining_uses
from public.promo_codes p cross join lateral (
  select count(*) filter(where u.state='redeemed') as usage_count,
    count(*) filter(where u.state='held' and r.status in ('pending','payment_submitted','reschedule_requested')
      and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>now())) as pending_uses
  from public.promo_redemptions u join public.reservations r using(reservation_id) where u.promo_id=p.promo_id
) counts;
revoke all on public.promo_code_availability from public,anon,authenticated;
grant select on public.promo_code_availability to service_role;

create or replace function public.sync_booking_promo_usage(p_reservation uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; t public.transactions%rowtype; p public.promo_codes%rowtype;
  previous public.promo_redemptions%rowtype; occupied bigint; successful boolean; pending boolean;
begin
  select * into r from public.reservations where reservation_id=p_reservation for update;
  if not found then return; end if;
  select * into t from public.transactions where reservation_id=p_reservation for update;
  if not found then return; end if;
  -- All bookings lock promo rows in the same order before checking capacity.
  perform 1 from public.promo_codes where promo_id=t.discount_promo_id or promo_id in
    (select promo_id from public.promo_redemptions where reservation_id=p_reservation and state='held')
    order by promo_id for no key update;
  successful:=r.status in ('confirmed','completed','no_show');
  pending:=r.status in ('pending','payment_submitted','reschedule_requested') and
    (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>now());
  update public.promo_redemptions set state='released' where reservation_id=p_reservation and state='held'
    and (promo_id is distinct from t.discount_promo_id or t.discount_kind<>'promo' or t.discount_amount<=0 or not(successful or pending));
  if t.discount_promo_id is null or t.discount_kind<>'promo' or t.discount_amount<=0 or not(successful or pending) then return; end if;
  select * into p from public.promo_codes where promo_id=t.discount_promo_id;
  select * into previous from public.promo_redemptions where promo_id=p.promo_id and reservation_id=p_reservation;
  if previous.state='redeemed' then return; end if;
  -- Existing held quotes keep their terms when a code expires or is archived.
  if previous.state is distinct from 'held' and (not p.is_active
    or p.starts_at>(now() at time zone 'Asia/Manila')::date or p.ends_at<(now() at time zone 'Asia/Manila')::date) then
    raise exception 'Promo code is unavailable or expired. Remove it and review the bill' using errcode='22023'; end if;
  select count(*) into occupied from public.promo_redemptions u join public.reservations b using(reservation_id)
    where u.promo_id=p.promo_id and u.reservation_id<>p_reservation and (u.state='redeemed' or
      u.state='held' and b.status in ('pending','payment_submitted','reschedule_requested') and
      (b.status<>'pending' or b.payment_deadline_at is null or b.payment_deadline_at>now()));
  if p.max_uses is not null and occupied>=p.max_uses then
    raise exception 'This promo has no remaining uses. Remove it or choose another code before saving' using errcode='40001'; end if;
  insert into public.promo_redemptions(promo_id,reservation_id,state,redeemed_at)
    values(p.promo_id,p_reservation,case when successful then 'redeemed' else 'held' end,case when successful then now() else null end)
    on conflict(promo_id,reservation_id) do update set state=excluded.state,redeemed_at=excluded.redeemed_at;
end $$;
revoke all on function public.sync_booking_promo_usage(uuid) from public,anon,authenticated;

create or replace function public.sync_booking_promo_usage_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
begin perform public.sync_booking_promo_usage(new.reservation_id); return new; end $$;
revoke all on function public.sync_booking_promo_usage_trigger() from public,anon,authenticated;
drop trigger if exists sync_booking_promo_bill on public.transactions;
-- Metadata changes happen before repricing; synchronize only the final winner.
create trigger sync_booking_promo_bill after insert or update of discount_kind,discount_amount on public.transactions
  for each row execute function public.sync_booking_promo_usage_trigger();
drop trigger if exists sync_booking_promo_confirmation on public.reservations;
create trigger sync_booking_promo_confirmation after insert or update of status,payment_deadline_at on public.reservations
  for each row execute function public.sync_booking_promo_usage_trigger();

create or replace function public.guard_promo_usage_limit()
returns trigger language plpgsql security definer set search_path='' as $$
declare occupied bigint;
begin
  if new.max_uses is null or new.max_uses is not distinct from old.max_uses then return new; end if;
  select usage_count+pending_uses into occupied from public.promo_code_availability where promo_id=old.promo_id;
  if new.max_uses<occupied then
    raise exception 'Maximum uses cannot be below the confirmed uses plus active pending holds (%)',occupied using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.guard_promo_usage_limit() from public,anon,authenticated;
drop trigger if exists guard_promo_usage_limit on public.promo_codes;
create trigger guard_promo_usage_limit before update of max_uses on public.promo_codes
  for each row execute function public.guard_promo_usage_limit();

-- Use KEY SHARE for the catalog snapshot, compatible with the NO KEY UPDATE
-- capacity lock and foreign-key checks. Concurrent new reservations then wait
-- without attempting to upgrade two shared promo locks.
create or replace function public.set_booking_discount(p_reservation uuid,p_actor uuid,p_eligible integer,p_code text,
  p_expected_total numeric,p_reason text,p_guest boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; t public.transactions%rowtype; s public.staff_users%rowtype; p public.promo_codes%rowtype; result jsonb;
begin
  select * into r from public.reservations where reservation_id=p_reservation for update;
  select * into t from public.transactions where reservation_id=p_reservation for update;
  if not found then raise exception 'Reservation bill not found' using errcode='22023'; end if;
  if p_actor is null then raise exception 'An authenticated actor is required' using errcode='42501'; end if;
  if p_guest then
    if r.guest_id is distinct from p_actor or r.status<>'pending' or t.paid_amount>0 or p_eligible<>0 or t.discount_eligible_guests<>0 then
      raise exception 'Only an unpaid booking owner can apply a new-booking promo' using errcode='42501'; end if;
  else
    select * into s from public.staff_users where id=p_actor and is_active;
    if not found or not (s.role='admin' or (s.role='staff' and exists(select 1 from public.role_permissions where role=s.role and 'edit_reservation'=any(permissions)))
      or (s.role='cashier' and exists(select 1 from public.role_permissions where role=s.role and 'transactions'=any(permissions) and 'payment_entry'=any(permissions)))) then
      raise exception 'Manager or cashier billing permission required' using errcode='42501'; end if;
  end if;
  if r.status not in ('pending','confirmed') or r.checked_out_at is not null
    or exists(select 1 from public.payments where reservation_id=p_reservation and status='pending')
    or exists(select 1 from public.refund_requests where reservation_id=p_reservation and status in ('pending','reviewed','approved','payout_submitted')) then
    raise exception 'Resolve open reviews/refunds before changing this bill' using errcode='40001'; end if;
  if p_expected_total is distinct from t.total_amount then raise exception 'Bill changed. Reload before applying a discount' using errcode='40001'; end if;
  if p_eligible is null or p_eligible<0 or p_eligible>r.adult_count+r.child_count or length(btrim(coalesce(p_reason,''))) not between 5 and 1000 then
    raise exception 'Enter a valid eligible guest count and a reason of 5-1000 characters' using errcode='22023'; end if;
  if nullif(btrim(p_code),'') is not null then
    if upper(btrim(p_code))=t.discount_promo_code then
      p.code:=t.discount_promo_code; p.discount_type:=t.discount_promo_type; p.discount_value:=t.discount_promo_value;
    else
    select * into p from public.promo_codes where code=upper(btrim(p_code)) and is_active
      and (starts_at is null or starts_at<=(now() at time zone 'Asia/Manila')::date)
      and (ends_at is null or ends_at>=(now() at time zone 'Asia/Manila')::date) for key share;
    if not found then raise exception 'Promo code is unavailable or expired' using errcode='22023'; end if;
    end if;
  end if;
  update public.transactions set discount_eligible_guests=p_eligible,discount_promo_code=p.code,
    discount_promo_type=p.discount_type,discount_promo_value=coalesce(p.discount_value,0) where reservation_id=p_reservation;
  result:=public.reprice_booking_discount(p_reservation);
  if (result->>'totalAmount')::numeric=0 and r.status='pending' then
    update public.reservations set status='confirmed' where reservation_id=p_reservation;
    result:=public.reprice_booking_discount(p_reservation); -- Update a newly issued zero-total invoice too.
  end if;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(case when p_guest then null else p_actor end,p_actor,'Updated booking discount','reservation',p_reservation,
      result||jsonb_build_object('before_total',t.total_amount,'previous_discount',t.discount_amount,'promo_code',p.code,'reason',btrim(p_reason)));
  return result;
end $$;
revoke all on function public.set_booking_discount(uuid,uuid,integer,text,numeric,text,boolean) from public,anon,authenticated;
grant execute on function public.set_booking_discount(uuid,uuid,integer,text,numeric,text,boolean) to service_role;

-- Validate the displayed net quote in the same transaction as the hold/redemption.
-- If a promo price changed, even zero-total confirmation rolls back before the
-- creation route removes its still-pending reservation.
create or replace function public.apply_new_booking_promo(p_reservation uuid,p_actor uuid,p_code text,
  p_expected_total numeric,p_guest boolean,p_expected_net numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=public.set_booking_discount(p_reservation,p_actor,0,p_code,p_expected_total,'Promo selected during reservation creation',p_guest);
  if (result->>'totalAmount')::numeric is distinct from p_expected_net then
    raise exception 'The promo changed while saving. Reapply the code and review the new total' using errcode='40001'; end if;
  return result;
end $$;
revoke all on function public.apply_new_booking_promo(uuid,uuid,text,numeric,boolean,numeric) from public,anon,authenticated;
grant execute on function public.apply_new_booking_promo(uuid,uuid,text,numeric,boolean,numeric) to service_role;

notify pgrst,'reload schema';
commit;
