# Cancellation and manual refunds

For an existing installation, apply [manager-cashier-refund-workflow-migration.sql](manager-cashier-refund-workflow-migration.sql) **after** the existing cancellation-refund-workflow, admin-read-only-manager-refunds and non-refundable-reschedule-fees migrations, and after any older refund migrations. Deploy the application with this migration. The latest workflow is **manager approval or rejection -> cashier transfer -> manager verification**. No initial cashier review is required. The migration is safe to reapply and preserves existing refund amounts, calculation snapshots, historical review notes and completed payouts. The local consolidated schema includes the same update; live deployment must be performed separately.

The reservation stays `cancelled`; refund processing has its own status. The guest never needs to request a cancellation refund separately. An excess-payment refund on an active booking remains a separate Manage Booking feature.

Apply `docs/non-refundable-reschedule-fees-migration.sql` after the manager-permission, reservation-edit, stay-completion and guest-auto-reschedule migrations. New cancellation calculations retain approved guest-reschedule fees and committed staff-reschedule notice fees for both guest and resort cancellations. Guest cancellations additionally retain the frozen initial deposit. Date-rate adjustments are not classified as reschedule fees. The total retained cannot exceed remaining verified payments. Previews show the fee and deposit deductions separately; historical refund snapshots and completed payouts remain unchanged. The examples below assume no reschedule fees.

| Cancellation | Verified payments | Retained | Automatic refund |
| --- | --- | --- | --- |
| Guest, unpaid | 0 | 0 | None |
| Guest, 20% deposit | 600 on a 3,000 bill | 600 | None |
| Guest, partial payment | 1,500 on a 3,000 bill | 600 | 900 |
| Guest, fully paid | 3,000 | 600 | 2,400 |
| Resort attributable | 600 or 3,000 | 0 | 600 or 3,000 |

Amounts use verified payments minus completed refunds. The initial deposit uses the bill at first payment verification and the same rounding as the required downpayment. Later services do not increase that frozen deposit. For old bookings the migration recovers the first verified payment's immutable receipt bill snapshot when available. Otherwise it freezes the recorded bill at migration time; check the preview and audit history before proceeding. Already completed refunds/payment receipts are preserved.

Guest self-service cancellation retains its booked notice window. An authorized staff member can document a guest request on their behalf; that still uses the guest deduction. Only an authorized active manager may classify a cancellation as attributable to the resort. A documented reason is mandatory. Pending payment proofs must be reviewed first.

Both screens retrieve a server-calculated preview. Confirmation supplies its quote token; the database locks reservation and bill, recalculates and rejects changed totals. Cancellation, refund creation/conversion, audit entries and in-app notifications commit together. The previous `refund_review_enabled` toggle no longer suppresses mandatory eligible refunds. Configuration retains policy descriptions and guest notice editing.

## Processing

1. **Awaiting manager approval:** New requests are `pending` and go directly to a manager with `refund_approval`. The manager checks the verified payments, prior refunds, deduction and fixed refund amount, then approves or rejects. Rejection needs a reason. An existing `reviewed` request can also be approved directly; its earlier review notes remain historical.
2. **Approved - awaiting cashier transfer:** A cashier with `refund_payout` transfers the approved amount outside the website through GCash or another active method in Business Catalog. Managers cannot record payouts. The system never calls a payout gateway.
3. **Transfer submitted - awaiting manager verification:** The cashier uploads image/PDF evidence and a unique transfer reference. Uploading proof does not reduce recorded net payments or mark a refund complete.
4. **Refund completed:** A manager with `refund_verify` checks the provider transaction records, amount, recipient, reference and proof; enters notes and explicitly confirms verification. The payout submitter cannot verify the same payout, including on historical records. Only this step deducts the completed refund from net paid billing.

Admins have view-only refund access. Cashiers cannot approve, reject or verify refunds, even if incompatible grants are supplied. Managers cannot submit payouts. The permission matrix exposes manager approval and verification, and cashier payout; the retired `refund_review` action is removed. The migration preserves unrelated grants, gives managers approval/verification and cashiers payout access, and removes incompatible refund grants. Module access alone grants no financial actions.

Only one open refund may allocate a reservation's funds. A cancellation converts an open excess request and resets its approval for a new manager decision. A documented transfer awaiting verification blocks cancellation. References cannot be reused. Authenticated clients cannot directly edit refund amounts or cancellation snapshots; the old transition RPC cannot bypass verification. Completed payments/refunds cannot be erased underneath a cancellation.

Older unprocessed cancellation requests require an authorized manager to classify guest/resort responsibility in Refund Requests and **Recalculate legacy cancellation refund** with notes. This resets approval and records before/after amounts. Requests with no eligible refund are rejected with a no-refund explanation; their history is retained. Completed refunds cannot be recalculated.

## Alerts and records

Guest and finance-staff in-app alerts record cancellation/no-refund, approval, rejection, transfer submission and verified completion. Alerts link to Manage Booking or Transactions > Refund Requests and carry the amount and applicable explanation. Audit records include actor, reason, calculation, old/new state, reference and proof path. Nodemailer/Gmail SMTP additionally attempts guest email for cancellation and status updates, including staff-entered guests with an email address. An email failure does not undo a saved financial action; the screen reports unconfirmed delivery.

The original bill remains historical and cancelled invoices are void. The generated historical balance is not a collectible booking debt once the reservation is cancelled. Net paid totals change only after verified refunds; new payments on cancelled reservations are blocked.

## Verification

`node --test tests/*.test.mjs` runs isolated tests. `tests/manager-cashier-refund-workflow-db.test.mjs` exercises the latest SQL workflow in PGlite; older migration tests preserve historical workflow coverage. Together these tests cover deductions, partial payments, prior refunds, stale quotes, role restrictions, legacy re-evaluation, private proof presence, duplicate prevention, native database write restrictions, notifications and net billing. API and React interaction tests cover confirmation and processing controls. No production credentials are needed.
