# Philippine time throughout the resort app

The resort timezone is **Asia/Manila (UTC+8)**. Admin and guest screens, receipts, notifications, emails, calendar selections, report periods, date validation and date-based receipt numbers use this timezone. Device and hosting timezones must not choose the resort's calendar date.

App-generated event timestamps carry an explicit `+08:00` offset. For example, `2026-10-17T00:30:00.000+08:00` and `2026-10-16T16:30:00.000Z` represent the same moment. UTC transport values from Supabase and internal query boundaries remain valid; format them through the shared Manila helpers before showing them to a person. Never strip their offset or add eight hours to an instant saved to the database.

Apply [philippine-timezone-migration.sql](philippine-timezone-migration.sql) in Supabase SQL Editor for an existing installation. It replaces timezone-stripping defaults on public `timestamptz` columns with `now()` and makes the legacy sales RPC use Manila calendar labels. It changes no historical records, staff permissions, payment amounts or reservation times. New installations receive the corrected defaults in `updated-schema.sql`.

PostgreSQL stores `timestamptz` as an instant and renders it in the SQL session's timezone. Supabase defaults to UTC; a raw database `+00` timestamp does not mean the app is using the wrong resort date. To inspect timestamp columns as Philippine time in a SQL Editor session:

```sql
set time zone 'Asia/Manila';
select now() as current_philippine_timestamp;
select reference_number, paid_at, created_at, verified_at
from public.payments order by created_at desc limit 10;
```

`SET TIME ZONE` affects that session's display, not saved instants. Keep timezone-aware columns rather than changing them to `timestamp without time zone`. Do not change Supabase's managed `auth` or `storage` schemas for display purposes.

Implementation: `lib/booking/manila-date.ts` provides display, calendar, wall-clock input and timestamp serialization helpers. Date-only inputs stay `YYYY-MM-DD`; package and ocular clocks are interpreted in Philippine time. Internal arithmetic may use UTC date components for calendar calculations without showing UTC dates to guests or staff.

References: [Supabase database configuration](https://supabase.com/docs/guides/database/postgres/configuration), [PostgreSQL date/time types](https://www.postgresql.org/docs/current/datatype-datetime.html).
