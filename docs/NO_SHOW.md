# Manager-recorded no-shows

An active manager (stored role `staff`) with **Edit reservations** permission can mark a confirmed reservation **No show** only after its complete scheduled end timestamp has passed. This includes overnight bookings: reaching the arrival date or passing midnight does not satisfy the rule. A recorded check-in or checkout prevents the action.

## Using the action

1. Open **Reservations** and select the ended booking in the calendar.
2. In its arrival section, read **Mark as No show**. Before the scheduled end, the action remains disabled and explains the cutoff.
3. Enter a reason of 5–2,000 characters and confirm that the guest did not arrive and no check-in was recorded.
4. Select **Mark as No show**. The calendar changes the record to a closed booking with its own status color. The recorded time and reason remain visible in staff details and Records.

Administrators and cashiers can view records according to their existing permissions but cannot mark no-shows. The API checks the manager role and edit grant; the service-only SQL function checks them again. A browser cannot set the status or its actor/time/reason fields directly.

## Workflow and financial effects

- Pending payments, pending reschedule requests and open refunds must be resolved before marking a no-show.
- The saved status is `no_show`; the server records `no_show_at`, `no_show_by` and `no_show_reason`.
- The status is closed. New payments, check-in, checkout, reservation editing, rescheduling and cancellation are unavailable. No-show markers cannot be rewritten or reopened through the application.
- Bills, invoices, verified payments, historical receipts and previous refunds remain recorded. Marking a no-show does not settle a balance, write off charges or automatically create a cancellation refund.
- Existing payment evidence cannot be rewritten or payment history removed after the no-show. Any separately eligible excess refund continues to use the manager → cashier → manager refund workflow.
- An audit entry records the manager, reason, schedule and timestamp. A linked registered guest receives an in-app notification without the internal reason. Guest Manage Booking displays No Show and its closed-state explanation.
- The reservation row is locked during the operation, coordinating with payment, attendance and reschedule actions. Replaying the request returns the original marker without another audit entry or notification. Audit and notification failures roll back the status change.

## Database update

Apply [reservation-no-show-migration.sql](reservation-no-show-migration.sql) in Supabase after the reservation lifecycle, stay-completion, timed-maintenance, reservation-management and manager-cashier-refund migrations, then deploy the application. The migration is safe to reapply and preserves existing reservation and financial records. The consolidated `updated-schema.sql` includes the same update. It has been tested locally; applying it to a live database is a separate deployment step.

## Verification

The no-show API, SQL and interface tests cover manager-only authorization, forged client values, the scheduled-end cutoff, overnight dates, actual attendance, pending reviews, idempotency, audit rollback, preserved billing/history and closed guest controls. Calendar tests cover the new status color and exclusion from active-arrival/balance flags.
