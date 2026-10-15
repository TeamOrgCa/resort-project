# Staff cash payments

Cash is available to authorized staff under Transactions. Online booking and guest balance-payment forms remain GCash only. Cash methods and their accounts are excluded from the public catalog, and online submission endpoints reject Cash.

## Installation

Run `docs/staff-cash-payments-migration.sql` in the Supabase SQL editor after the reservation lifecycle, additional services billing, role permissions, overpayment refunds and cancellation refund workflow migrations. Apply it before deploying this code. Fresh installs using `updated-schema.sql` must also apply/reapply this standalone migration after those prerequisite migrations so their older functions do not replace these definitions.

The migration creates an active Cash payment method if none exists. An existing archived Cash method stays archived: enable it in Business Catalog > Payment methods when required. Cash needs no QR code, receiving account or uploaded proof.

Administrators can record cash. Other active staff need Transactions module access and the Record payments (`payment_entry`) permission. The database checks the current staff session and permission; guest accounts cannot record Cash, including through a direct payment insert.

## At check-in

1. Open Transactions > Transaction Ledger and find the booking.
2. Choose Settle in cash, or Record cash and select the reservation.
3. Check the displayed balance. The full remaining balance is filled in automatically. Reduce the applied amount for a partial payment.
4. Count the received cash and give any change separately. Record only the amount credited to the bill.
5. Tick the received-cash acknowledgement and choose Record payment and issue receipt.
6. Check the success message, remaining balance and receipt number. Use Issued Receipts to view or print the receipt.

Cash is recorded as verified because authorized staff confirms physically receiving it. It bypasses GCash screenshot/OCR checks. It does not send a payment instruction or move money electronically.

## Financial and retry behavior

- Existing verified GCash payments and completed refunds determine the current net balance. Additional service charges already included in the bill are settled by the same cash flow.
- Payment, balance, invoice status, receipt and audit entry commit together. A failure rolls them back together.
- Initial pending bookings still need at least the required 20% downpayment and an unexpired payment hold. Confirmed bookings can receive partial or full balance payments.
- New cash cannot exceed the bill, be added to cancelled/completed reservations, or bypass pending payment/reschedule reviews or open refunds.
- Keep the generated cash reference when retrying a failed save. The same reservation, reference and amount returns the existing payment and receipt without duplicate credit or notifications.
- If the balance changed, refresh and inspect recorded payments before opening a new entry. Never create a new reference simply because a request timed out.
- Existing historical payments and receipts are preserved. Future receipt balance snapshots account for completed refunds.
- Guest notifications and receipt/invoice emails are attempted after the durable save. Delivery failure does not undo physically received cash.

## Validation

Database tests cover settlement, partial payments, prior refunds, receipt/invoice creation, staff permissions, duplicate retries and rollback. API tests cover authorization, validation, conflicts and email failures. UI tests exercise cash acknowledgement, retry, refreshed balance and receipt visibility. Public catalog tests check Cash is hidden and cannot be treated as GCash.

## Troubleshooting a failed cash entry

The old generic migration warning was used for every unexpected database error, including trigger failures. Its appearance did not establish that the migration was missing. New responses include a database error code; server logs retain the actual database message, details and hint.

If the API cannot find `record_staff_cash_payment` (`PGRST202`, or `42883` naming that function) even after installing the migration, refresh PostgREST in the **same Supabase project configured in the running website**:

```sql
notify pgrst, 'reload schema';
```

The updated migration also sends this notification automatically. A missing table, column or nested function (`42P01`, `42703`, or a different `42883`) requires checking the exact server log and applying the relevant prerequisite migration. Receipt setup errors (`55000`) and database constraint errors (`23514`) now show their specific messages.

For **Receipt creation is not configured. Cash was not recorded (55000)**, the verified payment did not produce a receipt, so the entire cash entry was rolled back. The original migration replaced the receipt function but relied on a pre-existing trigger. Run the complete updated `docs/staff-cash-payments-migration.sql` again: it now installs an enabled `trigger_create_receipt` on payment verification, repairing missing, disabled or incorrectly configured copies of that trigger. Existing payments and receipts are preserved. Retry with the same cash reference after the migration succeeds; no second physical cash collection is needed.

After deploying the error-reporting update, retry in the existing cash dialog with the same generated reference. If it fails, provide the new error code and matching server log entry, without secrets or guest details. A timeout is not a reason to generate another payment reference.
