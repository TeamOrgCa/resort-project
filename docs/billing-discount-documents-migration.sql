-- Apply AFTER promo-usage-limits-migration.sql.
-- Preserve the applied discount when a receipt is issued. Older receipts have
-- no reliable historical discount metadata and remain null (never guessed).
begin;

alter table public.receipts add column if not exists discount_snapshot jsonb;

create or replace function public.snapshot_receipt_discount()
returns trigger language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; bill_total numeric;
begin
  if tg_op='UPDATE' then
    if (new.discount_snapshot,new.payment_id,new.transaction_total_at_time) is distinct from
      (old.discount_snapshot,old.payment_id,old.transaction_total_at_time) then
      raise exception 'Receipt discount details are retained as issued' using errcode='42501';
    end if;
    return new;
  end if;
  -- Ignore supplied metadata; read only the bill belonging to this payment.
  select t.total_amount,jsonb_build_object(
    'amount',t.discount_amount,'kind',t.discount_kind,
    'promoCode',case when t.discount_kind='promo' then t.discount_promo_code end,
    'promoType',case when t.discount_kind='promo' then t.discount_promo_type end,
    'promoValue',case when t.discount_kind='promo' then t.discount_promo_value else 0 end,
    'eligibleGuests',case when t.discount_kind='pwd_senior' then t.discount_eligible_guests else 0 end,
    'headCount',r.adult_count+r.child_count,'packagePrice',t.discount_package_price)
    into bill_total,snapshot
    from public.payments p join public.reservations r on r.reservation_id=p.reservation_id
    join public.transactions t on t.reservation_id=r.reservation_id
    where p.payment_id=new.payment_id;
  if not found or bill_total is distinct from new.transaction_total_at_time then
    raise exception 'Receipt total must match the bill at issuance' using errcode='23514';
  end if;
  new.discount_snapshot:=snapshot;
  return new;
end $$;
revoke all on function public.snapshot_receipt_discount() from public,anon,authenticated;
drop trigger if exists snapshot_receipt_discount on public.receipts;
create trigger snapshot_receipt_discount before insert or update on public.receipts
  for each row execute function public.snapshot_receipt_discount();

notify pgrst,'reload schema';
commit;
