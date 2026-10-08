# Staff role permissions

Apply [role-permissions-migration.sql](role-permissions-migration.sql) in Supabase after the maintenance and refund migration and before deploying this change. It creates `public.role_permissions`, enables RLS, seeds the two configurable roles, and updates the refund RPC and proof policies. Existing `staff` accounts display as **Manager**; their stored role is unchanged.

## Defaults

| Role | Initial access |
| --- | --- |
| Cashier | View transactions and approve or reject payments |
| Manager (`staff`) | Reservations, including creation, cancellation and reschedule decisions; transaction work, including payment and refund decisions; records, reports, analytics and audit |
| Admin | Full access, including staff users, role permissions, catalog and resort configuration |

An admin can change manager and cashier permissions in **User Management → Role Permission Matrix**. Save each role separately. Changes take effect on the next request. The admin role always has full access, and the user management, resort configuration and catalog permissions remain admin only. Empty permissions leave a role with no admin modules.

The permission checks cover admin navigation, page requests and `/api/admin` requests. Action permissions are separate from page permissions: access to the transactions page alone does not permit payment approval, manual payment entry, refund review or refund payout. The role permission update endpoint accepts only known permission names and records an audit event. Unknown admin API endpoints are restricted to admins.

## Deployment and verification

1. Apply `docs/role-permissions-migration.sql` to the target database.
2. Deploy the app.
3. Sign in as admin and review the Role Permission Matrix. Confirm that manager and cashier permissions reflect the defaults, then adjust and save as needed.
4. Sign in as each role and verify the navigation and a denied action with a direct API request. A denied action should return HTTP 403.

The existing Supabase table policies and RPC grants still determine whether direct database calls are allowed. Review those policies for tables used by staff pages if database level enforcement of these app permissions is required.
