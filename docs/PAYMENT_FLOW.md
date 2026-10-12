# Booking payments, GCash OCR and excess refunds

## Guest payments

1. Saving `/booking/details` creates a reservation with the server-calculated bill.
2. `/booking/payment` accepts GCash only. Before any verified payment, guests choose the **minimum 20% down payment** (rounded up to a cent) or the **full outstanding balance**. After a verified payment, only the outstanding balance is offered.
3. **Amount sent** must equal the amount printed on the receipt and meet the selected minimum. A receipt for less than the minimum is rejected. A larger payment is saved at its actual amount, including payments above the entire bill.
4. After staff approval, the actual payment reduces the remaining balance. For example, a PHP 1,500 receipt against a PHP 1,000 minimum and PHP 3,000 bill leaves PHP 1,500 owing. A PHP 3,500 payment against a PHP 3,000 bill produces PHP 500 of refundable excess.
5. Guests return through `/manage` to pay a remaining balance or request a refund of verified excess. Pending payments block another submission and a refund request until staff finishes reviewing them.

The minimum remains 20%; the illustrative PHP 1,000 example does not change that policy. `lib/booking/payment-policy.ts` owns rounding and money validation. Both guest APIs check server totals; a database insert guard rechecks the current bill after OCR, holding reservation and transaction locks. Existing staff/manual payment entry retains its separate workflow.

## Required receipt checks

Upload the **original screenshot taken directly in GCash**, as a clear, complete PNG, JPEG or WebP up to 8 MB, to the guest's folder in the private `payment-proofs` bucket. Photos of another phone, scans, blurred images and edited receipts are not accepted. Select the original screenshot from the gallery rather than photographing a screen. The server runs image checks and the bundled Tesseract worker and English model. All these checks must pass before either guest API inserts a pending payment:

- A valid single-frame image, at least 320 pixels on its shorter side and 480 on its longer side. Camera-specific EXIF tags, substantial photo-like pixel texture and heavy compression are rejected. Ordinary screenshot software/orientation metadata is allowed. Native-resolution sampling does not resize away camera noise.
- Readable text: overall OCR confidence at least 75, every recognized numeric word at least 80 with a height of at least 12 native pixels, and no multiple tilted long text lines. Missing numeric fields or OCR geometry fail closed.
- GCash label and successful payment status, with no failed/reversed status.
- Readable **Amount Sent / Amount Paid / Amount**, exactly matching Amount sent and meeting the selected minimum. A matching fee or Total Amount cannot substitute for a missing or smaller sent amount. Conflicting amount fields block submission.
- Complete numeric reference in a labelled reference field. It must match the entered number exactly after removing spaces/hyphens. References in unrelated phone/account fields and substrings do not match. Supported reference lengths are 8–20 digits; leading zeroes are preserved. The database rejects reuse across payments, including rejected payments and alternative spacing/hyphens.
- Resort recipient matching the active account whose QR was displayed. If a phone is printed, all visible digits must match the configured phone, including masked-phone prefixes. Otherwise the full printed recipient name must match the configured account name.
- Receipt **date and time today in Asia/Manila**. Old days, future days, future times beyond a one-minute clock/resolution allowance, invalid or conflicting timestamps, and missing timestamps block submission. This applies equally to first payments and later balance payments, regardless of booking date.

Dates support English abbreviated/full months, month-first and day-first named dates, ISO dates, numeric MM/DD/YYYY, 12/24-hour clocks, and a date followed by a separate Time line. All unzoned timestamps are explicitly interpreted as Philippine time, independently of the server timezone.

Failed receipt checks return `422 RECEIPT_VALIDATION_FAILED` (or `INVALID_PAYMENT_PROOF` for unrelated/failed images). OCR failure returns `503 PROOF_SCREENING_UNAVAILABLE`. No mismatched or unreadable new guest receipt is silently saved for manual review. Guests can correct the entered amount/reference or upload a clearer complete receipt and retry.

Accepted receipts store `ocr_status = consistent`, notes, screening time and `receipt_paid_at`. The staff payment review modal displays the extracted receipt time in Philippine time. Older/manual payments can have no extracted receipt time and retain their existing review lanes.

Image checks are best-effort: a photo can lose camera metadata, noise and perspective when cropped or edited. PNG alone does not prove screenshot origin, and these heuristics cannot certify provenance. Staff must visually check the full-size proof and reject photographed screens even if OCR reads the text. For new guest receipts, both the review UI and approval API require an explicit **clear original GCash screenshot** acknowledgement before approval; the checkbox resets between payments. Legacy/manual payments keep their existing review workflow.

OCR cannot establish that money arrived or detect every edited screenshot. Accepted payments remain **pending** until staff matches the amount, reference, recipient and timestamp against the receiving account. GCash's [merchant guidance](https://help.gcash.com/hc/en-us/articles/59390640942745-What-is-Digital-QR) explains checking transaction history for the timestamp, reference and amount.

## Excess refunds

Manage Booking shows **Request excess refund** when verified payments, less completed refunds, exceed the current bill. The authenticated database function verifies ownership and calculates the amount itself; the browser cannot choose an amount or another guest. Open refunds, pending payments and pending reschedules block a new request. The request does not cancel the reservation.

Staff reviews requests in **Transactions → Refund Requests**, where excess-payment and cancellation requests are labelled separately. Configured `refund_review` and `refund_payout` permissions apply. Approved requests await a GCash payout with reference and proof. The amount is checked again before approval and payout against the latest bill and payments. If it is no longer available, staff can reject the request with a reason and the guest can request a fresh review.

Completed refunds reduce `transactions.paid_amount` to net verified payments. Original payments and issued receipts retain their historical amounts. This prevents refunded excess from paying for services added later. Payout references cannot be reused, and only one pending/approved refund can exist per reservation; completed/rejected requests remain in the history.

Cancellation retains the booked policy and notice window. Pending payments must be reviewed before cancellation so their proof remains reviewable. If cancellation refunds are enabled, an open excess request becomes a pending cancellation review and its prior approval is reset. Completed payouts are deducted before creating a later cancellation request. Disabling cancellation refund reviews does not remove an otherwise eligible excess refund. An obsolete pending reschedule cannot block refunding a cancelled booking.

## Apply before deployment

Existing booking, billing, account-access/OCR, maintenance-refunds, booking-policy-versions, role-permissions and reservation-edit migrations must already be installed. In Supabase SQL Editor, run in order:

1. `docs/gcash-payment-validation-migration.sql`
2. `docs/overpayment-refunds-migration.sql`

Both reload PostgREST's schema cache. They do not rewrite historical receipts. The refund migration recalculates net billing for reservations with completed refunds. `updated-schema.sql` includes the new payment timestamp column; use these feature migrations after installing its prerequisite tables and policies.

The screenshot quality checks and staff acknowledgement require no additional migration. `sharp` is a production dependency, and both guest OCR routes trace its runtime/native packages for deployment alongside the existing bundled worker/model.

If a unique index fails, inspect existing normalized reference duplicates before retrying. Do not delete payment/refund history. These queries identify affected records:

```sql
select regexp_replace(upper(reference_number), '[^A-Z0-9]', '', 'g') as normalized_reference,
       array_agg(payment_id) as payments
from public.payments
where reference_number is not null and regexp_replace(upper(reference_number), '[^A-Z0-9]', '', 'g') <> ''
group by 1 having count(*) > 1;

select regexp_replace(upper(gcash_reference), '[^A-Z0-9]', '', 'g') as normalized_reference,
       array_agg(refund_id) as refunds
from public.refund_requests where status = 'refunded' and gcash_reference is not null
group by 1 having count(*) > 1;
```

`PAYMENT_SCHEMA_MIGRATION_REQUIRED` or `PGRST204` for `receipt_paid_at` means the GCash validation migration is missing. Missing older OCR columns requires `docs/account-access-migration.sql` (or `docs/payment-ocr-hotfix.sql` for those columns) as well. Missing refund RPCs requires the refund migration and its prerequisites. Do not bypass these checks to submit payments.

## Verification

Run the complete suite with `node --experimental-strip-types --test tests/*.test.mjs`.

The payment tests cover underpayments, larger down/full payments, exact receipt amount/reference matching, recipients and Manila dates, both guest API paths and saved-payment notification failures. Image tests exercise supported screenshot formats, benign and camera EXIF, metadata-free texture, unreadable/tiny numbers, tilted text, damaged images and rejection before OCR starts. Approval tests require screenshot acknowledgement for new guest receipts while preserving staff permission checks, reservation eligibility, concurrent-review handling and legacy/manual approval. The OCR integration test renders an isolated sample receipt and runs the actual bundled worker/model. The refund database tests execute both actual migrations in [PGlite's in-memory PostgreSQL](https://pglite.dev/docs/), using isolated fixtures without Supabase credentials or writes. They exercise refund ownership/permissions, approvals, payouts, changing bills, cancellation interactions, net billing, duplicate references, history and repeated migration execution. PGlite is a development dependency only.
