# Staff role permissions

Existing `staff` accounts display as **Manager**; their stored role is unchanged.

| Role | Access |
| --- | --- |
| Admin | Full Users, Configuration and Business Catalog access. Other modules allow viewing, search, filters, sorting, pagination, refresh and record details. Reports and Analytics allow CSV export and printing/PDF; Audit allows CSV export. Operational changes and starting feedback analysis remain unavailable. |
| Manager (`staff`) | Configurable operational permissions, including refund approval/rejection. Users, Configuration and Business Catalog remain admin-only. |
| Cashier | Configurable operational permissions. Cannot approve/reject refunds, even if a refund approval grant is supplied. |

Admins manage operational grants in **Users > Role Permission Matrix**. The admin role's fixed access cannot be expanded with action grants. Refund review, approval, payout and verification are separate permissions. Refund approval requires both the Manager role and **Approve or reject refunds**. A payout must be verified by another authorized staff member.

Authorized managers with reservation-edit permission handle maintenance blocks. Authorized managers with reservation-cancellation permission may choose resort-attributable cancellation.

## Deployment

1. Apply the existing role-permissions, cancellation-refund-workflow, admin-refund-verification, maintenance-refunds and stay-completion migrations.
2. Apply [admin-read-only-manager-refunds-migration.sql](admin-read-only-manager-refunds-migration.sql) before deploying the app. Existing manager grants are preserved; Transactions and refund approval are added. Existing requests and financial amounts are preserved.
3. Deploy and verify each role. Denied operational API actions return HTTP 403.

The app enforces access in navigation, controls, API handlers and middleware. Database triggers reject admin writes to operational tables and payment/refund/review proof assets, including writes attempted by legacy security-definer RPCs with an admin identity. Users, catalog, configuration and their assets remain editable. System service-role jobs continue to work.
