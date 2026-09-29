-- Run in the Supabase SQL Editor for an existing database that reports
-- PGRST204: payments.ocr_checked_at (or another payments.ocr_* column) missing.
-- This is a focused, idempotent repair. The complete policy changes remain in
-- docs/account-access-migration.sql and should also be applied.

begin;

alter table public.payments
  add column if not exists ocr_status text not null default 'not_applicable',
  add column if not exists ocr_notes text,
  add column if not exists ocr_checked_at timestamptz;

alter table public.payments drop constraint if exists payments_ocr_status_check;
alter table public.payments add constraint payments_ocr_status_check
  check (ocr_status in ('not_applicable', 'consistent', 'mismatch', 'unreadable'));

commit;

notify pgrst, 'reload schema';
