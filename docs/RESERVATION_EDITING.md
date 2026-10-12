# Staff reservation editing

Apply `docs/reservation-edit-migration.sql` in the Supabase SQL editor before using the new calendar editor. Its prerequisites are listed at the top of the migration; use the existing role permissions, maintenance/refunds, additional services billing, billing document email and reschedule charges migrations first.

Open **Admin → Reservations** and select a booking in the calendar. The dialog loads the reservation, its existing service prices, payments and bill. An administrator has edit access automatically. The migration grants **Edit reservations and services** to roles that already have **Add reservation**; further changes use **Users → Role Permission Matrix**.

- Before arrival: edit the booking package, arrival time, guest counts, accommodation, services and requests. Departure follows the package duration; custom schedules allow a separate departure time.
- During the stay: add services or increase existing quantities, and update requests/notes. Previously booked services cannot be removed or reduced.
- Review the total and amount payable, enter a reason, then select **Save reservation**. The calendar refreshes and the dialog reloads the saved bill.
- Expired holds, ended or closed bookings and bookings awaiting payment/reschedule review remain read-only.

The bill uses the recorded total plus the package-price difference and service-price difference. This retains historical package adjustments and reschedule charges. Existing service rates remain at their booked prices; new services use catalog rates. Selecting a different accommodation retains package-based billing, matching manual and online booking creation. Reservations with multiple accommodations retain those selections and require separate review to change them.

The server saves through one restricted database function. It locks the reservation and transaction, checks the expected reservation/bill/service/unit snapshot, updates the current invoice and records the staff member, reason, previous details and new charges in the audit log. Date exclusion and maintenance triggers still enforce availability. Any failure rolls back the entire save.

Existing payment amounts and receipts are preserved. A reduced total may expose an overpayment, shown in the preview and available for review in Transactions. Editing does not automatically issue refunds or send billing emails. Existing invoice-email tracking marks changed totals for a new document email.

Validation: `node --test tests/reservation-edit.test.mjs`, `npx tsc --noEmit`, targeted ESLint and a production build. The unit/route tests use mocked database boundaries; the SQL migration must also be applied and verified against your Supabase project. Check a future booking edit, an in-stay service addition, a stale concurrent edit, an unavailable date and a partially paid bill. Confirm the current invoice matches the new total and previously issued receipts remain unchanged.
