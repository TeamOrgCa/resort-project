# Public access collections

Apply [public-access-sales-migration.sql](public-access-sales-migration.sql) in the Supabase SQL Editor before deploying this feature. It adds `public_access_sales` and the atomic `record_public_access_sale` function. The migration has not been applied automatically.

## Cashier workflow

1. Open **Transactions → Transaction Ledger → New payment**. No private reservation is required.
2. Enter the guest's name and Philippine mobile contact number.
3. Choose **Public swimming**, **Cottage usage**, **Room usage** or **Mixed public access**. In **Payment for**, note the actual items and quantities covered, such as “Swimming for 4 adults and cottage 2.”
4. Enter the amount already received and select an active Business Catalog payment method. Cash needs no uploaded evidence. Other methods require the real transaction reference and JPEG, PNG, WebP or PDF proof up to 8 MB.
5. Check the actual money received, acknowledge receipt and select **Record admission and issue receipt**.
6. Check the automatically opened receipt. Print it or save it as PDF; reopen it from the ledger or **Issued Receipts**.

Only an active cashier with **Transactions** and **Record payments** permissions can record public collections. The database checks the current session as well. Admins remain view-only; managers retain their separately permitted private-reservation settlement workflow.

For a private reservation, use its ledger-row **Settle payment** action. This keeps existing private balance checks, invoice/receipt generation and billing email results. **New payment** is exclusively for public access.

## Filtering and reports

The ledger and **Issued Receipts** provide **All collections**, **Public access** and **Private booking** source filters. Date filters and table search work with the selected source, including exports. Public receipts contain the guest/contact, usage, cashier's payment description, amount, method, reference and paid-at date/time.

In **Reports → Sales Report**, choose the collection source and period. The filter changes summary cards, trends, breakdowns, table rows, CSV and printed reports. Public/private collection totals appear separately. Sales count collection records, not individual swimmers. Public collections use server-recorded `paid_at`; private payments use verification dates with their existing legacy fallback. All date boundaries use Philippine time. Sales, dashboard and analytics collection figures are gross before refunds; private ledger balances retain their existing net/refund basis.

## Recording guarantees and boundaries

- One transaction creates the sale, permanent receipt identity and audit record. A failed audit rolls back the sale.
- The same admission form reuses its request ID after a failure, preventing duplicate collections and receipts. Check the ledger before abandoning a timed-out form; do not collect money twice.
- Guest/contact, description, method name and paid-at snapshots preserve the receipt even after catalog edits. Authenticated users have no direct insert/update/delete grant on public sales.
- Public transfer references are unique per method within public sales. Staff must also check the actual provider transaction and existing private payments before entry; cross-module reuse is not automatically reconciled.
- This records money already received. It does not charge a provider, run OCR, send public receipt emails, manage public inventory, block a room/calendar or create a private reservation. Public-sale refunds/voids are not provided by the private-reservation refund workflow.

## Verification

Database tests exercise authorization, session/grants, receipt/audit atomicity, retries, transfer ownership, duplicate public references and RLS. API/UI tests cover normalized inputs, proof validation, separate public entry/private settlement, receipts and filters. Reporting tests reconcile both sources, Philippine date boundaries and pagination.
