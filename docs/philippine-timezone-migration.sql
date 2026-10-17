-- Run in Supabase SQL Editor as postgres after the app's existing migrations.
-- Corrects timestamp defaults and SQL calendar labels; never rewrites history.
-- timestamptz preserves an instant. Display it in Asia/Manila in the app or SQL
-- session; do not add eight hours to stored timestamps or convert them to text.
begin;

-- timezone('utc', now()) removes timezone information. Reassigning that naive
-- value to timestamptz can shift the instant if the session timezone changes.
-- now() already returns a timezone-aware instant and works in every session.
do $defaults$
declare v_column record;
begin
  for v_column in
    select n.nspname, c.relname, a.attname
    from pg_catalog.pg_attrdef d
    join pg_catalog.pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
    join pg_catalog.pg_class c on c.oid=d.adrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
      and a.atttypid='timestamptz'::regtype and not a.attisdropped
      and lower(pg_catalog.pg_get_expr(d.adbin,d.adrelid)) in (
        'timezone(''utc''::text, now())', 'timezone(''utc'', now())',
        'timezone(''utc''::text, current_timestamp)', 'timezone(''utc'', current_timestamp)')
  loop
    execute format('alter table %I.%I alter column %I set default now()', v_column.nspname,v_column.relname,v_column.attname);
  end loop;
end
$defaults$;

-- Keep the legacy report RPC's signature, permissions, and invoker/RLS behavior.
-- Its labels must use resort dates regardless of the database session timezone.
create or replace function public.get_sales_report(report_period text)
returns table(label text,revenue numeric,bookings bigint)
language sql stable security invoker set search_path='' as $$
  select case
      when report_period='daily' then to_char(created_at at time zone 'Asia/Manila','Dy')
      when report_period='weekly' then 'Week '||extract(week from created_at at time zone 'Asia/Manila')
      else to_char(created_at at time zone 'Asia/Manila','Mon')
    end as label,
    sum(total_amount) as revenue,count(*) as bookings
  from public.transactions group by label order by min(created_at);
$$;

notify pgrst,'reload schema';
commit;
