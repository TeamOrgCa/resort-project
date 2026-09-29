# Booking payments and GCash OCR

## Guest flow

1. The booking form calculates a price estimate. Saving on `/booking/details` creates the reservation and returns the server's total.
2. `/booking/payment` offers exactly two choices: 20% of the reservation total, rounded up to the next cent, or the full outstanding balance. The 20% choice is available only before any payment is verified.
3. A guest can return through `/manage` to pay the balance. The manage page passes the selected reservation to the payment page; it does not collect a second set of proof fields.
4. A submitted payment remains `pending` until staff checks the real transaction and approves it. A pending payment blocks another submission for that reservation.

`lib/booking/payment-policy.ts` owns the 20% down-payment calculation. Both guest payment APIs check the submitted amount against a server-calculated price or balance. The old `reservation.downpayment_percentage` setting is retired; it does not override the 20% or full choice.

## GCash receipt screening

The guest uploads a PNG, JPEG, or WebP receipt of at most 8 MB to their own folder in the private `payment-proofs` bucket. The API downloads that file using the authenticated guest session. For GCash methods, Tesseract reads the image on the server and compares the GCash label, success status, amount, reference, and configured resort recipient. Results are stored on `payments` as `ocr_status`, `ocr_notes`, and `ocr_checked_at`:

- `consistent`: readable fields agree with the submission;
- `mismatch`: a readable amount, reference, or transaction status conflicts;
- `unreadable`: fields or OCR runtime could not establish a match;
- `not_applicable`: another payment method was used.

OCR checks what a screenshot says. It **does not prove that funds arrived**, and a screenshot can be edited. Cashier or admin staff must compare the reference, amount, recipient, and date against the actual GCash merchant transaction record before clicking Approve. GCash's [merchant guidance](https://help.gcash.com/hc/en-us/articles/59390640942745-What-is-Digital-QR) describes using the merchant transaction history for this check. The payment queue shows the OCR result and notes beside the proof.

The English Tesseract model is bundled in `assets/ocr/eng.traineddata` and included in the two payment API routes by `next.config.ts`. To smoke test the packaged OCR model from the project root:

The API uses `SUPABASE_SERVICE_ROLE_KEY` only for the final pending-payment insert. Guests upload and read their own proof files; active staff can read those files to review them. Keep the service key on the server.

```powershell
node -e "const {recognize}=require('tesseract.js'); const p=require('path'); recognize('public/website_logo_transparent.png','eng',{langPath:p.join(process.cwd(),'assets','ocr'),gzip:false,cacheMethod:'none'}).then(r=>console.log(r.data.text.slice(0,80)))"
```

Run the parser and rounding tests with `node --experimental-strip-types --test tests/payment-flow.test.mjs`. Apply `docs/account-access-migration.sql` to an existing database before deploying the API and admin queue changes.
