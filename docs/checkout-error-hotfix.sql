-- Hotfix for checkout 500 caused by invoice versioning + audit trigger FK issues.
-- Run this in Supabase SQL editor against your live DB.

begin;

-- 1) Allow invoice versioning (remove old unique reservation constraint if it exists)
do $$
declare
  reservation_unique_constraint text;
begin
  select c.conname
  into reservation_unique_constraint
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  where t.relname = 'invoices'
    and c.contype = 'u'
    and c.conkey = array[
      (
        select attnum
        from pg_attribute
        where attrelid = t.oid
          and attname = 'reservation_id'
          and not attisdropped
      )
    ]
  limit 1;

  if reservation_unique_constraint is not null then
    execute format('alter table public.invoices drop constraint %I', reservation_unique_constraint);
  end if;
end
$$;

-- Keep/ensure version uniqueness.
alter table public.invoices
  add constraint invoices_reservation_version_unique unique (reservation_id, version);

-- 2) Prevent guest actions from violating audit_logs.user_id -> staff_users FK
create or replace function public.log_service_change()
returns trigger as $$
declare
  actor_id uuid;
  res_id uuid;
begin
  actor_id := auth.uid();
  res_id := coalesce(new.reservation_id, old.reservation_id);

  insert into public.audit_logs (
    user_id,
    action,
    entity_type,
    entity_id
  )
  values (
    case
      when actor_id is not null and exists (
        select 1
        from public.staff_users
        where id = actor_id
      ) then actor_id
      else null
    end,
    TG_OP || '_SERVICE',
    'reservation',
    res_id
  );

  return null;
end;
$$ language plpgsql;

-- 3) Ensure service-change trigger exists.
do $$
begin
  if to_regclass('public.reservation_services') is not null and not exists (
    select 1
    from pg_trigger
    where tgname = 'trigger_log_service_changes'
      and tgrelid = 'public.reservation_services'::regclass
  ) then
    create trigger trigger_log_service_changes
    after insert or update or delete
    on public.reservation_services
    for each row
    execute procedure public.log_service_change();
  end if;
end
$$;

commit;
