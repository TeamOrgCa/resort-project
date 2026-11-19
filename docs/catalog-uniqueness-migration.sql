-- Apply after the Business Catalog and ocular time-slot migrations.
-- Includes archived records: rename duplicates before applying this migration,
-- or restore an existing item instead of creating another. No records are deleted.
begin;

do $$
declare v_table text; v_duplicate text;
begin
  foreach v_table in array array['services','units','payment_methods'] loop
    execute format('select lower(btrim(regexp_replace(name,''[[:space:]]+'','' '',''g'')))
      from public.%I group by 1 having count(*)>1 limit 1',v_table) into v_duplicate;
    if v_duplicate is not null then
      raise exception 'Duplicate name in %: %. Rename the duplicate records before applying this migration.',v_table,v_duplicate;
    end if;
  end loop;
  if exists(select 1 from public.ocular_time_slots group by start_time,end_time having count(*)>1) then
    raise exception 'Duplicate ocular time slots exist. Change the duplicate time ranges before applying this migration.';
  end if;
end $$;

create unique index if not exists catalog_services_name_unique
  on public.services ((lower(btrim(regexp_replace(name,'[[:space:]]+',' ','g')))));
create unique index if not exists catalog_units_name_unique
  on public.units ((lower(btrim(regexp_replace(name,'[[:space:]]+',' ','g')))));
create unique index if not exists catalog_payment_methods_name_unique
  on public.payment_methods ((lower(btrim(regexp_replace(name,'[[:space:]]+',' ','g')))));
create unique index if not exists catalog_ocular_slot_times_unique
  on public.ocular_time_slots(start_time,end_time);

commit;
