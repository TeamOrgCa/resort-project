-- Apply in the Supabase SQL Editor so day and overnight packages can share a date.
-- Run first on a test project. Existing truly overlapping active reservations
-- must be resolved before the new constraint can be installed.
begin;

alter table public.reservations drop constraint if exists one_active_reservation_per_date;
alter table public.reservations drop constraint if exists one_active_reservation_per_time;
alter table public.reservations add constraint one_active_reservation_per_time
  exclude using gist (
    tstzrange(start_datetime, end_datetime, '[)') with &&
  ) where (status in ('pending', 'payment_submitted', 'confirmed', 'reschedule_requested'));

commit;
