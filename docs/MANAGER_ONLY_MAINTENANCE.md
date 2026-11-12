# Manager-only maintenance blocks

Only an active Manager (database role `staff`) with `edit_reservation` permission
can create or release maintenance blocks. Admins and Cashiers can inspect blocks
through their granted reservation view, but cannot manage them.

The calendar hides both maintenance actions for other roles. The API checks the
Manager role and grant; the Admin request guard denies maintenance writes. The
database RPCs independently check the same requirements to prevent direct calls
from bypassing application authorization. Existing blocks and audit records are
preserved. New Managers still need the reservation-edit grant assigned by Admin.

For an existing Supabase database, apply
[manager-only-maintenance-migration.sql](manager-only-maintenance-migration.sql)
after `timed-maintenance-auto-ocular-migration.sql`. This is a prepared migration;
editing this repository does not apply it to a live database. Fresh installations
include the same final definitions in `updated-schema.sql`.

The [combined flowchart PDF](flowcharts/MARVILLE_ROLE_FLOWCHARTS.pdf) and separate
role PDFs now show Admin referring maintenance changes to Manager flow
`M3-BLOCK`; only the Manager diagram contains creation and release steps.

Regression coverage checks denied Admin/Cashier writes, Manager grant and active
status, maintenance conflicts, whole-day/PHT periods, calendar controls, Admin
read-only permissions and repeated migration application.
