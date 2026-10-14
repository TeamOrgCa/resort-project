# Cancellation and manual refunds

Apply `docs/cancellation-refund-workflow-migration.sql` in Supabase SQL Editor **after** the existing maintenance-refunds, booking-policy-versions, role-permissions, billing-document-email, reservation-edit and overpayment-refunds migrations. If that migration is already installed, apply `docs/admin-refund-verification-migration.sql` to enable administrator self-verification without reinstalling the workflow. Then deploy the application. These migrations have not been run against a live database by the coding agent.

The reservation stays `cancelled`; refund processing has its own status. The guest never needs to request a cancellation refund separately. An excess-payment refund on an active booking remains a separate Manage Booking feature.

| Cancellation | Verified payments | Retained | Automatic refund |
| --- | --- | --- | --- |
| Guest, unpaid | 0 | 0 | None |
| Guest, 20% deposit | 600 on a 3,000 bill | 600 | None |
| Guest, partial payment | 1,500 on a 3,000 bill | 600 | 900 |
| Guest, fully paid | 3,000 | 600 | 2,400 |
| Resort attributable | 600 or 3,000 | 0 | 600 or 3,000 |

Amounts use verified payments minus completed refunds. The initial deposit uses the bill at first payment verification and the same rounding as the required downpayment. Later services do not increase that frozen deposit. For old bookings the migration recovers the first verified payment's immutable receipt bill snapshot when available. Otherwise it freezes the recorded bill at migration time; check the preview and audit history before proceeding. Already completed refunds/payment receipts are preserved.

Guest self-service cancellation retains its booked notice window. An authorized staff member can document a guest request on their behalf; that still uses the guest deduction. Only an active administrator may classify a cancellation as attributable to the resort. A documented reason is mandatory. Pending payment proofs must be reviewed first.

Both screens retrieve a server-calculated preview. Confirmation supplies its quote token; the database locks reservation and bill, recalculates and rejects changed totals. Cancellation, refund creation/conversion, audit entries and in-app notifications commit together. The previous `refund_review_enabled` toggle no longer suppresses mandatory eligible refunds. Configuration retains policy descriptions and guest notice editing.

## Processing

1. **Pending refund review:** Cashier inspects the payment records, prior refunds and deduction, adds notes and explicitly confirms the review.
2. **Awaiting administrator approval:** Only an active administrator approves or rejects. Rejection needs a reason.
3. **Approved - awaiting transfer:** Cashier transfers the fixed approved amount outside the website through GCash or another active method in Business Catalog. The system never calls a payout gateway.
4. **Transfer submitted - awaiting verification:** Cashier uploads image/PDF evidence and the reference. Uploading proof does not reduce recorded net payments or mark a refund complete.
5. **Refunded:** Authorized staff check the provider's transaction records, amount, recipient, reference and proof; enter notes and explicitly confirm verification. An active administrator can verify their own documented payout. Other staff require a different authorized verifier. Only this step deducts the completed refund from net paid billing.

Cashiers receive `refund_review`, `refund_payout` and `refund_verify` permissions in the migration; other configured permissions are preserved. Approval/rejection remains administrator-only even if another role has refund-review permission. Configure additional independent verifiers through Users/role permissions if needed.

Only one open refund may allocate a reservation's funds. A cancellation converts an open excess request and resets its approval for fresh review. A documented transfer awaiting verification blocks cancellation. References cannot be reused. Authenticated clients cannot directly edit refund amounts or cancellation snapshots; the old transition RPC cannot bypass verification. Completed payments/refunds cannot be erased underneath a cancellation.

Older unprocessed cancellation requests require an administrator to classify guest/resort responsibility in Refund Requests and **Recalculate legacy cancellation refund** with notes. This resets approval and records before/after amounts. Requests with no eligible refund are rejected with a no-refund explanation; their history is retained. Completed refunds cannot be recalculated.

## Alerts and records

Guest and finance-staff in-app alerts record cancellation/no-refund, payment review, approval, rejection, transfer submission and verified completion. Alerts link to Manage Booking or Transactions > Refund Requests and carry the amount and applicable explanation. Audit records include actor, reason, calculation, old/new state, reference and proof path. Nodemailer/Gmail SMTP additionally attempts guest email for cancellation and status updates, including staff-entered guests with an email address. An email failure does not undo a saved financial action; the screen reports unconfirmed delivery.

The original bill remains historical and cancelled invoices are void. The generated historical balance is not a collectible booking debt once the reservation is cancelled. Net paid totals change only after verified refunds; new payments on cancelled reservations are blocked.

## Verification

`node --test tests/*.test.mjs` runs isolated tests. `tests/cancellation-refund-workflow.test.mjs` executes the actual migrations in PGlite, exercising deductions, partial payments, prior refunds, stale quotes, role restrictions, legacy re-evaluation, private proof presence, duplicate prevention, native database write restrictions, notifications and net billing. API and React interaction tests cover confirmation and processing controls. No production credentials are needed.
