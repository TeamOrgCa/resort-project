-- Apply before deploying service quantity controls. No new table is created.
-- Existing services retain the previous 10,000 technical ceiling. Configure
-- actual per-booking limits in Business Catalog > Services after applying.
begin;

alter table public.services add column if not exists max_quantity integer not null default 10000;
update public.services set max_quantity=10000 where max_quantity is null;
alter table public.services alter column max_quantity set default 10000;
alter table public.services alter column max_quantity set not null;
alter table public.services drop constraint if exists services_max_quantity_check;
alter table public.services add constraint services_max_quantity_check check (max_quantity between 1 and 10000);

create or replace function public.enforce_service_quantity_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_limit integer; v_name text; v_allowed integer;
begin
  if new.quantity is null or new.quantity < 1 or new.quantity > 10000 then
    raise exception 'Choose a whole-number service quantity from 1 to 10000' using errcode='22023';
  end if;
  select max_quantity,name into v_limit,v_name from public.services where service_id=new.service_id for share;
  if not found then raise exception 'Selected service is unavailable' using errcode='22023'; end if;
  v_allowed:=v_limit;
  -- Keep historical bookings valid when an administrator lowers a limit.
  -- Quantities above the new cap may be retained or reduced, never increased.
  if tg_op='UPDATE' then
    if old.service_id=new.service_id and old.reservation_id=new.reservation_id then
      v_allowed:=greatest(v_limit,coalesce(old.quantity,1));
    end if;
  end if;
  if new.quantity>v_allowed then
    raise exception '% allows a maximum quantity of % per booking',v_name,v_allowed using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_service_quantity_limit() from public,anon,authenticated;
drop trigger if exists enforce_service_quantity_limit on public.reservation_services;
-- AFTER is intentional: INSERT ... ON CONFLICT must resolve to UPDATE before
-- checking the historical quantity. Any violation rolls back the whole statement.
create trigger enforce_service_quantity_limit after insert or update of quantity,service_id,reservation_id
on public.reservation_services for each row execute function public.enforce_service_quantity_limit();

commit;
