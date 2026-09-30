# Reservation lifecycle implementation

## Existing gap

The earlier guest-only exclusion constraint let different customers reserve the same date. The application also checked availability before inserting a reservation, which can race when two requests arrive together. Unpaid `pending` reservations need a firm deadline, and payment verification must update payment and reservation state together.

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
Submitting a valid payment proof before the 30-minute deadline moves the hold to `payment_submitted`; staff can review the actual payment afterward. A rejected initial payment releases the date.

## Database and concurrency

Apply [reservation-lifecycle-migration.sql](reservation-lifecycle-migration.sql), then [first-come-booking-migration.sql](first-come-booking-migration.sql), in the Supabase SQL Editor. The final GiST exclusion constraint covers **occupied Asia/Manila calendar dates across all reservations**, including walk-ins. It includes `pending`, `payment_submitted`, `confirmed`, and `reschedule_requested`. Concurrent claims for the same date cannot both commit. A trigger takes transaction-scoped advisory locks on the claimed dates and expires overlapping overdue unpaid holds before the constraint checks the new claim. The claim and expiry happen in one database transaction. Reservation creation, expiry, cancellation/rejection release, and deletion are written to the audit log in that transaction. Guest actions retain the guest's auth ID; the staff audit screen resolves it to a name, while cron expiry appears as a system action.

The payment insert trigger locks the reservation row. A valid proof submission moves `pending` to `payment_submitted` in the same transaction as the payment insert. The expiration function locks due pending rows with `SKIP LOCKED`, then moves them to `expired`. The later lock holder sees the committed state, so a submitted payment cannot be expired afterward. A one minute Supabase Cron job runs expiration independently of website traffic. The claim trigger also releases expired holds immediately when another guest requests the date, so cron timing cannot keep an overdue slot blocked. The migration uses [Supabase Cron](https://supabase.com/docs/guides/cron) and [pg_cron](https://supabase.com/docs/guides/database/extensions/pg_cron).

Only active admin/cashier accounts can update payment status. The database review trigger changes a pending payment to verified or rejected, records reviewer and time, moves an initial reservation to confirmed or rejected, and writes an audit log in the same transaction. The API update includes `status = pending`, so duplicate admin clicks produce one success and one conflict. A rejected balance payment leaves an already confirmed reservation active.

## Deployment order

1. Check and resolve existing duplicate active reservations **across all guests** for each occupied Manila date, and duplicate pending payments on one reservation. The final constraint will refuse to install while duplicates exist. The whole migration rolls back on failure.
2. Apply [reservation-lifecycle-migration.sql](reservation-lifecycle-migration.sql), then [first-come-booking-migration.sql](first-come-booking-migration.sql), to the target Supabase database. Confirm the `expire-unpaid-reservations` job appears in `cron.job` and its runs appear in `cron.job_run_details`.
3. Deploy the application code. The availability endpoint and booking API expect `payment_deadline_at`, the new statuses, and the global date constraint; apply both migrations before sending traffic to this code.
4. Run the integration test against a **test Supabase project** with `RUN_RESERVATION_INTEGRATION=1`, the usual Supabase environment variables, and `RESERVATION_TEST_STAFF_EMAIL`/`RESERVATION_TEST_STAFF_PASSWORD` for an active admin or cashier. The test creates and deletes an isolated guest account.

Before step 2, review cross-customer conflicts with this read-only query. Resolve each pair according to the reservation's creation time and payment history; the migration does not silently cancel a customer's booking.

```sql
select a.reservation_id as first_reservation, a.created_at as first_created_at,
       b.reservation_id as second_reservation, b.created_at as second_created_at
from public.reservations a
join public.reservations b on a.reservation_id < b.reservation_id
where a.status in ('pending', 'payment_submitted', 'confirmed', 'reschedule_requested')
  and b.status in ('pending', 'payment_submitted', 'confirmed', 'reschedule_requested')
  and (a.status <> 'pending' or a.payment_deadline_at > now())
  and (b.status <> 'pending' or b.payment_deadline_at > now())
  and daterange(
    (a.start_datetime at time zone 'Asia/Manila')::date,
    (a.end_datetime at time zone 'Asia/Manila')::date +
      case when (a.end_datetime at time zone 'Asia/Manila')::time = time '00:00' then 0 else 1 end,
    '[)'
  ) && daterange(
    (b.start_datetime at time zone 'Asia/Manila')::date,
    (b.end_datetime at time zone 'Asia/Manila')::date +
      case when (b.end_datetime at time zone 'Asia/Manila')::time = time '00:00' then 0 else 1 end,
    '[)'
  );
```

This workspace has not applied the migration to a database. The integration test is intentionally skipped unless its test-project environment variables are supplied.

## Responses and screens

- Date already held by any active reservation: HTTP 409, `DATE_UNAVAILABLE`.
- Payment after the deadline: HTTP 410, `PAYMENT_DEADLINE_EXPIRED`.
- Payment on expired/rejected reservation: HTTP 410, `RESERVATION_INACTIVE`.
- Second payment while one awaits review: HTTP 409.
- Repeated admin review: HTTP 409.
- The public booking calendar disables dates held by any customer, refreshes every 15 seconds, and treats overdue unpaid holds as available. The database remains the final authority if the calendar is stale. The booking review page shows the payment deadline after saving. Manage Booking shows it for pending reservations and disables closed-record actions. The payment queue exposes approval/rejection controls only to admin/cashier; the API and database independently enforce that role rule.

## Verification

`tests/manila-date.test.mjs` covers the timezone boundary. `tests/reservation-lifecycle.test.mjs` covers concurrent claims by two guests, scheduled and claim-time expiration, payment versus expiry, duplicate approval, and release of rejected/expired dates when configured against a test database.

The database integration test requires an isolated Supabase project and staff credentials. The SQL migrations have not been executed against a database in this workspace; an end-to-end two-customer race must be run on that project before rollout.
