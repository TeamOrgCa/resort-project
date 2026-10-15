# Rescheduling policy and installation

Apply [reschedule-policy-migration.sql](reschedule-policy-migration.sql) in the Supabase SQL editor after the prerequisites listed at its top, then deploy the application. It is safe to reapply. Existing requests, charges, verified payments and receipts are not rewritten. The consolidated `updated-schema.sql` includes the same migration for fresh installations.

## Rules applied to guest requests and staff date edits

- The original swimming date determines the season and notice deadline. Peak is March-May (summer) and September-December (Ber months), requiring at least **14 Philippine calendar days**. January-February and June-August require at least **7 calendar days**.
- A request on the displayed deadline is allowed for that entire Philippine date. Moving a booking to a different season does not change the notice needed for that request.
- Guests outside that window see the deadline and a contact-resort alert. They cannot submit a late self-service request.
- Staff with **Edit reservation** and **Reschedule approval** permissions can process a shorter-notice exception for a confirmed reservation by checking the exception acknowledgement and recording a reason. Administrators have these permissions. Closed, completed, cancelled or expired reservations cannot be reopened this way. A confirmed reservation with a past schedule can be moved to an available future date.
- The booked package, time of day and exact duration remain fixed. Availability and maintenance blocks are checked again when saving. The new start must be at least 30 minutes away.
- Pending payments/reschedules and open refunds must be resolved before a staff reschedule. Once the stay starts, guest counts/accommodation and existing service minimums remain protected.

| Notice before the original swimming date | Notice fee |
| --- | ---: |
| 6 or more calendar days | PHP 50 |
| 3-5 calendar days | PHP 100 |
| 1-2 calendar days | PHP 300 |
| Same date or past date | PHP 500 |

The 6+ and 3-5 ranges preserve the existing fee brackets. In particular, an ordinary on-time reschedule carries PHP 50; it is not automatically free. Short-notice fees apply only to authorized staff exceptions.

## Billing and audit

The preview shows the notice fee before saving. Staff changes update the date, current transaction, current invoice, adjustment record and audit log atomically. A failed change rolls back all of them. Stale retries cannot charge again.

Each staff date change creates an immutable `reservation_reschedule_adjustments` row with before/after dates, notice, fee, positive rate difference, exception acknowledgement, reason and actor. An in-app notification is attempted for linked guest accounts; walk-in guests without an account must be informed by staff.

Guest requests remain pending until approved in Records. Their fee is fixed at request time; approving later does not change its notice bracket. Approval adds the stored notice fee and any higher-date-rate adjustment to the captured bill and updates the current invoice. Legacy late guest requests must be rejected and handled as documented staff exceptions.

Existing paid amounts, earlier fees, discounts and negotiated charges are retained. Package differences use the booking's saved package-rate version. A higher date rate adds a charge; a lower date rate does not automatically reduce the bill or release a refund. Service-only edits do not incur a notice fee. No money is transferred automatically.

## Verification

`node --test tests/reschedule-charge-policy.test.mjs tests/reschedule-policy-db.test.mjs tests/guest-reschedule-policy-api.test.mjs tests/reservation-edit.test.mjs tests/reservation-edit-calendar.test.mjs tests/manage-booking-ui.test.mjs`

The isolated PostgreSQL tests run the actual migration and cover all seasonal cutoffs/fees, Philippine midnight, role restrictions, late/past-date exceptions, duplicate/stale requests, atomic rollback, invoice/payment preservation and migration reapplication.
