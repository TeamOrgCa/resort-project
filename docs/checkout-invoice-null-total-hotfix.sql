-- Hotfix: prevent checkout 500 caused by invoice trigger inserting NULL total_amount.
-- Apply in Supabase SQL Editor on live DB.

begin;

create or replace function public.create_invoice_version()
returns trigger as $$
declare
  res_id uuid;
  new_total numeric;
  new_version int;
begin
  res_id := coalesce(new.reservation_id, old.reservation_id);

  insert into public.transactions (reservation_id, total_amount)
  values (res_id, 0)
  on conflict (reservation_id) do nothing;

  select coalesce(total_amount, 0)
  into new_total
  from public.transactions
  where reservation_id = res_id;

  new_total := coalesce(new_total, 0);

  select coalesce(max(version), 0) + 1
  into new_version
  from public.invoices
  where reservation_id = res_id;

  insert into public.invoices (
    reservation_id,
    version,
    total_amount,
    status
  )
  values (
    res_id,
    new_version,
    new_total,
    'issued'
  );

  return null;
end;
$$ language plpgsql;

create or replace function public.create_invoice_on_confirmation()
returns trigger as $$
begin
  if new.status = 'confirmed' then
    insert into public.invoices (reservation_id, version, total_amount, status)
    values (
      new.reservation_id,
      (
        select coalesce(max(version), 0) + 1
        from public.invoices
        where reservation_id = new.reservation_id
      ),
      (
        select coalesce(total_amount, 0)
        from public.transactions
        where reservation_id = new.reservation_id
      ),
      'issued'
    );
  end if;

  return new;
end;
$$ language plpgsql;

commit;
