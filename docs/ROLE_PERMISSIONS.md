# Staff role permissions

Existing `staff` accounts display as **Manager**; their stored role is unchanged.

| Role | Access |
| --- | --- |
| Admin | Full Users, Configuration and Business Catalog access. Other modules allow viewing, search, filters, sorting, pagination, refresh and record details. Reports and Analytics allow CSV export and printing/PDF; Audit allows CSV export. Operational changes and starting feedback analysis remain unavailable. |
| Manager (`staff`) | Configurable operational permissions, including refund approval/rejection and transfer verification. Refund payout recording is unavailable. Users, Configuration and Business Catalog remain admin-only. |
| Cashier | Configurable operational permissions. Can record approved refund payouts when granted permission. Cannot approve/reject refunds or verify transfers, even if incompatible grants are supplied. |

Admins manage operational grants in **Users > Role Permission Matrix**. The admin role's fixed access cannot be expanded with action grants. Refunds go directly to manager approval; no cashier review is required. Approval/rejection and transfer verification require the Manager role and the corresponding permission. Recording the transfer requires the Cashier role and payout permission. A manager cannot verify a payout they submitted historically. The retired cashier-review permission is removed from the matrix.

Authorized managers with reservation-edit permission handle maintenance blocks. Authorized managers with reservation-cancellation permission may choose resort-attributable cancellation.

Managers with reservation-edit permission can also mark an unchecked-in confirmed reservation **No show**, only after its scheduled end time, with a reason and non-arrival acknowledgement. Administrators and cashiers cannot mark no-shows. See [No-show workflow](NO_SHOW.md); apply its migration before deploying the action.

## Deployment

1. Apply the existing role-permissions, cancellation-refund-workflow, admin-refund-verification, maintenance-refunds and stay-completion migrations.
2. Apply [admin-read-only-manager-refunds-migration.sql](admin-read-only-manager-refunds-migration.sql) before deploying the app. Existing manager grants are preserved; Transactions and refund approval are added. Existing requests and financial amounts are preserved.
3. After all older refund migrations and the non-refundable-reschedule-fees migration, apply [manager-cashier-refund-workflow-migration.sql](manager-cashier-refund-workflow-migration.sql). It removes the initial cashier review and enforces manager approval, cashier payout and manager verification while preserving existing requests and payouts.
4. Deploy and verify each role. Denied operational API actions return HTTP 403.

The app enforces access in navigation, controls, API handlers and middleware. Database triggers reject admin writes to operational tables and payment/refund/review proof assets, including writes attempted by legacy security-definer RPCs with an admin identity. Users, catalog, configuration and their assets remain editable. System service-role jobs continue to work.
