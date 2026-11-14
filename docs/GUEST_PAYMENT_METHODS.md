# Guest online payment methods

In **Business Catalog > Payment methods**, create and activate the method. Link
an active resort receiving account under **Payment accounts**. Other non-cash
methods can use an account number, a QR image, or both. GCash still requires its
configured QR account. Cash remains available only for staff collection at the resort.

Guest checkout and existing-booking balance payments use this catalog directly.
Guests select the receiving account when a method has multiple accounts, enter
the amount, sender details and provider reference, upload a JPEG/PNG/WebP receipt
image up to 8 MB, and accept the booking agreement.

- **GCash:** existing server OCR checks, code toggles and eligible automatic
  approval remain in place. A failed OCR check does not fall back to another method.
- **Other non-cash methods:** image ownership, size and decoding are checked without
  running OCR. The payment is saved pending, with no invented receipt time or OCR
  result, no automatic approval, no paid-balance credit and no issued receipt.
- **Manual review:** an authorized cashier with `payment_approval` opens the proof,
  checks the method and receiving account, matches the amount, reference and
  recipient against actual funds, acknowledges the check, then approves or rejects.
  Existing manager review permissions also remain supported. Verification updates
  balances, confirms an initial booking and creates its receipt through existing
  database triggers. Rejection requires a reason. Receipt/invoice email preferences
  remain respected.

The service-only `submit_manual_guest_payment` RPC rechecks ownership, active
method/account, the bill, payment minimum, deadline and pending reviews while
locking the reservation. Duplicate references remain protected by the existing
normalized unique index. Cash and GCash are rejected by this RPC. A client cannot
select automatic approval, OCR evidence or the server-only beta workflow.

Apply [guest-payment-methods-migration.sql](guest-payment-methods-migration.sql)
after the prerequisites in its header before deploying. It adds a receiving-account
link and the manual-submission RPC, preserves historical records, and does not
rewrite existing OCR functions. Its definitions are also appended to
`updated-schema.sql` for new installations. This repository update does not apply
the migration to a live Supabase database.
