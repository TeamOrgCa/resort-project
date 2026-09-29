# Booking payments and GCash OCR

## Guest flow

1. The booking form calculates a price estimate. Saving on `/booking/details` creates the reservation and returns the server's total.
2. `/booking/payment` offers exactly two choices: 20% of the reservation total, rounded up to the next cent, or the full outstanding balance. The 20% choice is available only before any payment is verified.
3. A guest can return through `/manage` to pay the balance. The manage page passes the selected reservation to the payment page; it does not collect a second set of proof fields.
4. A submitted payment remains `pending` until staff checks the real transaction and approves it. A pending payment blocks another submission for that reservation.

`lib/booking/payment-policy.ts` owns the 20% down-payment calculation. Both guest payment APIs check the submitted amount against a server-calculated price or balance. The old `reservation.downpayment_percentage` setting is retired; it does not override the 20% or full choice.

## GCash receipt screening

The guest uploads a PNG, JPEG, or WebP receipt of at most 8 MB to their own folder in the private `payment-proofs` bucket. The API downloads that file using the authenticated guest session. For GCash methods, Tesseract reads the image on the server and compares the GCash label, success status, amount, reference, and configured resort recipient. Results are stored on `payments` as `ocr_status`, `ocr_notes`, and `ocr_checked_at`:

Before any payment record is saved, the server OCR-screens both GCash and other payment-method images for basic transaction evidence. It returns `422 INVALID_PAYMENT_PROOF` for an unrelated image, an image with no recognizable receipt details, or a transaction explicitly marked failed/reversed. It returns `503 PROOF_SCREENING_UNAVAILABLE` if OCR cannot run; a payment is not silently accepted without screening. A partial but plausible receipt is accepted as pending for staff investigation. This is a text-based filter, so a fabricated image with convincing text can still pass and a very blurry genuine receipt may need a clearer upload.

- `consistent`: readable fields agree with the submission;
- `mismatch`: a readable amount, reference, or transaction status conflicts;
- `unreadable`: fields or OCR runtime could not establish a match;
- `not_applicable`: another payment method was used.

OCR checks what a screenshot says. It **does not prove that funds arrived**, and a screenshot can be edited. Cashier or admin staff must compare the reference, amount, recipient, and date against the actual GCash merchant transaction record before clicking Approve. GCash's [merchant guidance](https://help.gcash.com/hc/en-us/articles/59390640942745-What-is-Digital-QR) describes using the merchant transaction history for this check. The payment queue shows the OCR result and notes beside the proof.

## Review triage

The Payment Verification Queue turns OCR results into review lanes. `consistent` receipts appear as **Ready to reconcile**: staff can quickly match the reference and amount in the receiving account's transaction history. `mismatch` and `unreadable` receipts appear as **Investigate**: staff should inspect the proof and resolve the discrepancy before approval. `not_applicable` appears as **Other method** and follows the receiving account's normal reconciliation process. Staff can filter by lane; all submissions remain pending until the receiving account record is checked and approval is recorded.

OCR is a fast filter, not a guarantee of authenticity or a substitute for settlement data. The suggested 80% clear / 20% investigation split is an illustrative goal, not a measured accuracy or automation rate for this system. Automatically approving payments would require a trusted GCash transaction feed or another source of actual settlement data.

The API uses `SUPABASE_SERVICE_ROLE_KEY` only for the final pending-payment insert. Guests upload and read their own proof files; active staff can read those files to review them. Keep the service key on the server.

The English Tesseract model is bundled in `assets/ocr/eng.traineddata`. The API passes an explicit worker file path because Next.js bundles Tesseract's default worker path incorrectly. `next.config.ts` traces the worker and model into both payment routes. To smoke test those paths from the project root:

```powershell
node -e "const {recognize}=require('tesseract.js'); const p=require('path'); recognize('public/website_logo_transparent.png','eng',{workerPath:p.join(process.cwd(),'node_modules','tesseract.js','src','worker-script','node','index.js'),langPath:p.join(process.cwd(),'assets','ocr'),gzip:false,cacheMethod:'none'}).then(r=>console.log(r.data.text.slice(0,80)))"
```

Run the parser and rounding tests with `node --experimental-strip-types --test tests/payment-flow.test.mjs`. Apply `docs/account-access-migration.sql` to an existing database before deploying the API and admin queue changes.

If `/api/reservations/payment` reports `PAYMENT_SCHEMA_MIGRATION_REQUIRED` or Supabase reports `PGRST204` for `payments.ocr_checked_at`, the running database lacks the OCR columns. Apply `docs/payment-ocr-hotfix.sql` in the Supabase SQL Editor to repair the columns and reload PostgREST's schema cache, then retry the payment. Apply `docs/account-access-migration.sql` as well for the complete payment and storage policies. The API must retain the OCR result for staff review, so it does not save a payment without these columns.
