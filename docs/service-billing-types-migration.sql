-- Apply after service-quantity-limits and existing reservation-edit migrations.
-- Existing services and booked lines keep quantity-based billing and their saved prices.
-- Set rentals to Duration-based in Business Catalog; prices then mean PHP per hour.
begin;

alter table public.services add column if not exists billing_type text not null default 'quantity';
alter table public.services drop constraint if exists services_billing_type_check;
alter table public.services add constraint services_billing_type_check check(billing_type in ('quantity','duration'));
alter table public.reservation_services add column if not exists billing_type text not null default 'quantity';
alter table public.reservation_services drop constraint if exists reservation_services_billing_type_check;
alter table public.reservation_services add constraint reservation_services_billing_type_check check(billing_type in ('quantity','duration'));

-- Capture the server-side catalog type; never trust a browser-supplied billing type.
-- Preserve booked types on updates, including staff INSERT ... ON CONFLICT edits.
create or replace function public.snapshot_service_billing_type()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.service_id=old.service_id and new.reservation_id=old.reservation_id then
      new.billing_type:=old.billing_type;
      return new;
    end if;
  end if;
  select billing_type into new.billing_type from public.services where service_id=new.service_id for share;
  if not found then raise exception 'Selected service is unavailable' using errcode='22023'; end if;
  return new;
end $$;
revoke all on function public.snapshot_service_billing_type() from public,anon,authenticated;
drop trigger if exists snapshot_service_billing_type on public.reservation_services;
create trigger snapshot_service_billing_type before insert or update on public.reservation_services
for each row execute function public.snapshot_service_billing_type();

create or replace function public.enforce_service_quantity_limit()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_limit integer; v_name text; v_allowed integer;
begin
  if new.quantity is null or new.quantity<1 or new.quantity>10000 then
    raise exception 'Choose a whole-number quantity or rental duration from 1 to 10000' using errcode='22023'; end if;
  select max_quantity,name into v_limit,v_name from public.services where service_id=new.service_id for share;
  if not found then raise exception 'Selected service is unavailable' using errcode='22023'; end if;
  v_allowed:=v_limit;
  if tg_op='UPDATE' then
    if old.service_id=new.service_id and old.reservation_id=new.reservation_id then
      v_allowed:=greatest(v_limit,coalesce(old.quantity,1)); end if;
  end if;
  if new.quantity>v_allowed then
    if new.billing_type='duration' then
      raise exception '% allows a maximum of % rental hours per booking',v_name,v_allowed using errcode='22023';
    else
      raise exception '% allows a maximum quantity of % per booking',v_name,v_allowed using errcode='22023';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_service_quantity_limit() from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
