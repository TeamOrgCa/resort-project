# Guest account access management

Apply [guest-account-status-migration.sql](guest-account-status-migration.sql) in the Supabase SQL editor **after the existing account-access, reservation and refund migrations, before deploying the application changes**. Existing guest accounts default to active. The migration requires the existing guest/staff tables, account-session migration and audit tables, and is safe to reapply. For a fresh database, run this migration again after the remaining reservation/refund migrations so the write guards include those tables.

Administrators use **Users > Guest Accounts** to filter by name/email/phone as they type, filter status, and confirm deactivation or reactivation with an optional reason. Staff accounts are excluded even when the authentication trigger created a matching guest profile; walk-in profiles have no website account and remain separate.

The database records status and the audit entry in one transaction. It clears `active_session_id` on a status change. An inactive guest is denied at login, protected pages/APIs and the session watcher; the sign-in page explains that the guest should contact the resort. Reactivation permits a new sign-in and does not restore an old website session. Database triggers prevent guests changing their own active flag/session identifier and block inactive guest writes, including writes inside guest RPCs. Trusted service jobs and authorized staff retain their existing workflows.

Deactivation preserves the profile, reservations, payments and refund records. Staff can continue handling those records. It does not cancel bookings, move dates or transfer money. Public resort pages remain public.

Use **Reactivate** to reverse a deactivation. Inspect **Audit Log** for `Guest deactivated` / `Guest reactivated`, including the administrator, old/new status and optional reason.

The list is paginated on the server with 10 guests per page. Both list and mutation RPCs enforce active administrator/current session access, and the API validates filters, identifiers and boolean status values. No Supabase Auth password or confirmation setting is changed. The legacy own-staff-profile update policy is also guarded against staff changing their own role, active status or session identifier; existing trusted server staff-management routes retain access.

Validation:

```powershell
node --test tests/guest-account-status-db.test.mjs tests/guest-account-status-api.test.mjs tests/guest-account-status-ui.test.mjs tests/guest-login-confirmation.test.mjs
npx.cmd tsc --noEmit
```
