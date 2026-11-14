# Recording received payments

In **Transactions → Transaction Ledger**, use a private reservation's
**Settle payment** action. An active operational staff account needs `payment_entry`.
**New payment** is now exclusively cashier public-access entry for swimming,
cottage or room usage; see [Public access collections](PUBLIC_ACCESS_SALES.md).
Admin operational access remains read-only. The form records funds already
received; it does not charge an account or initiate a transfer.

Cash retains its existing acknowledged collection workflow. Other methods come
from the active **Business Catalog → Payment methods** list, using the selected
method's exact ID. This supports GCash, bank transfers and other configured
methods without guessing a method from its name or payment-type spelling.

For non-cash entries, enter the real provider reference, sender name and sender
account number, attach JPEG/PNG/WebP/PDF proof up to 8 MB, and acknowledge that
the amount, recipient and reference match actual received funds. The proof is
uploaded to the current staff account's private `payment-proofs` folder. Both
the server and database validate the entry; the server checks file signatures.

The database locks the reservation/bill, rechecks its current balance, enforces
the initial downpayment and open-review restrictions, and saves the payment,
receipt, totals and audit in one transaction. Existing completed refunds remain
included in net balances. Receipt or audit failure rolls the transaction back.
Retries preserve the real normalized reference and uploaded proof; a conflicting
reuse cannot credit a second payment. Billing email delivery is independent of
the saved financial result.

`payment_entry` permits verification only of the new payment being entered.
It does not grant general approval of guest-submitted payment evidence.
Managers with that same entry grant can also use the form, as with cash.

For an existing Supabase database, apply
[staff-payment-methods-migration.sql](staff-payment-methods-migration.sql) after
the cash, payment-review and booking/billing prerequisites listed in its header.
This repository change does not apply the migration to a live database. The same
definitions are appended to `updated-schema.sql` for new installations.

The [Cashier PDF](flowcharts/CASHIER_FLOWCHART.pdf) contains updated C0/C4 diagrams
and the new C5 non-cash flow. The combined PDF and preview images are regenerated
from the same flow definitions.

Guest online checkout also supports configured non-cash methods. These guest
submissions are pending until authorized manual approval, unlike staff entry of
already-verified funds. See [GUEST_PAYMENT_METHODS.md](GUEST_PAYMENT_METHODS.md).
