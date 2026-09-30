# Reservation lifecycle implementation

## Existing gap

The previous global exclusion constraint blocked different guests from booking the same period. The application also checked availability before inserting a reservation, which can race when two requests arrive together. Unpaid `pending` reservations had no deadline, and payment verification updated payment and reservation rows in separate requests.

## State rules

The existing `pending` database value represents **PENDING_PAYMENT**. This retains compatibility with the booking screens and historical rows.

| Current state | Allowed next states | Meaning |
| --- | --- | --- |
| `pending` | `payment_submitted`, `expired`, `cancelled`, `confirmed` (staff manual payment) | Awaiting proof for 30 minutes. |
| `payment_submitted` | `confirmed`, `rejected`, `cancelled` | Proof is awaiting admin/cashier review. |
| `confirmed` | `completed`, `cancelled`, `reschedule_requested` | A payment has been verified. A rejected balance payment leaves this state unchanged. |
| `reschedule_requested` | `confirmed`, `cancelled` (legacy unpaid requests may return to `pending` or `payment_submitted`) | Original date remains occupied during staff review. |
| `expired`, `rejected`, `cancelled`, `completed` | None | No further payment approval or new booking state transition. |

The SQL state guard is the final authority. `expired`, `rejected`, and `cancelled` do not count as active. The customer reschedule route now requires a confirmed reservation.

## Database and concurrency

Apply [reservation-lifecycle-migration.sql](reservation-lifecycle-migration.sql) in the Supabase SQL Editor. It replaces the global overlap constraint with a GiST exclusion constraint on **guest ID and occupied Asia/Manila calendar dates**. It includes `pending`, `payment_submitted`, `confirmed`, and `reschedule_requested`. Multiple guests can reserve the same date. Two inserts for the same guest/date cannot both commit.

The payment insert trigger locks the reservation row. A valid proof submission moves `pending` to `payment_submitted` in the same transaction as the payment insert. The expiration function locks due pending rows with `SKIP LOCKED`, then moves them to `expired`. The later lock holder sees the committed state, so a submitted payment cannot be expired afterward. A one minute Supabase Cron job runs expiration independently of website traffic. Repeated runs have no effect after the state changes. The migration uses [Supabase Cron](https://supabase.com/docs/guides/cron) and [pg_cron](https://supabase.com/docs/guides/database/extensions/pg_cron).

Only active admin/cashier accounts can update payment status. The database review trigger changes a pending payment to verified or rejected, records reviewer and time, moves an initial reservation to confirmed or rejected, and writes an audit log in the same transaction. The API update includes `status = pending`, so duplicate admin clicks produce one success and one conflict. A rejected balance payment leaves an already confirmed reservation active.

## Deployment order

1. Check and resolve existing duplicate active reservations for the same guest and occupied date, and duplicate pending payments on one reservation. The new constraints will refuse to install while duplicates exist.
2. Apply [reservation-lifecycle-migration.sql](reservation-lifecycle-migration.sql) to the target Supabase database. Confirm the `expire-unpaid-reservations` job appears in `cron.job` and its runs appear in `cron.job_run_details`.
3. Deploy the application code. The new API queries expect `payment_deadline_at` and the new statuses; apply the migration before sending traffic to this code.
4. Run the integration test against a **test Supabase project** with `RUN_RESERVATION_INTEGRATION=1`, the usual Supabase environment variables, and `RESERVATION_TEST_STAFF_EMAIL`/`RESERVATION_TEST_STAFF_PASSWORD` for an active admin or cashier. The test creates and deletes an isolated guest account.

This workspace has not applied the migration to a database. The integration test is intentionally skipped unless its test-project environment variables are supplied.

## Responses and screens

- Duplicate active guest/date: HTTP 409, `DUPLICATE_RESERVATION`.
- Payment after the deadline: HTTP 410, `PAYMENT_DEADLINE_EXPIRED`.
- Payment on expired/rejected reservation: HTTP 410, `RESERVATION_INACTIVE`.
- Second payment while one awaits review: HTTP 409.
- Repeated admin review: HTTP 409.
- The booking review page shows the payment deadline after saving. Manage Booking shows it for pending reservations and disables closed-record actions. The payment queue exposes approval/rejection controls only to admin/cashier; the API and database independently enforce that role rule.

## Verification

`tests/manila-date.test.mjs` covers the timezone boundary. `tests/reservation-lifecycle.test.mjs` covers concurrent inserts, expiration, payment versus expiry, duplicate approval, and release of rejected/expired dates when configured against a test database.

Local verification on 2026-09-30: TypeScript, ESLint, and the production build passed. The Node test run passed 8 tests; the database integration test was skipped because no isolated test Supabase project and staff credentials were provided. The SQL migration itself has not been executed against a database in this workspace.
