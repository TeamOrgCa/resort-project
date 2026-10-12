# Editable swimming package prices

Apply [package-rates-migration.sql](package-rates-migration.sql) in the Supabase SQL editor before deploying this change. It requires the existing `staff_users`, `audit_logs` and `reservations` tables. The same migration is included at the end of `updated-schema.sql` for new installations.

Open **Admin → Catalog → Package rates**. An active administrator can edit the package price and additional-guest charge for day, night and whole-day swimming, separately for Monday–Thursday and Friday–Sunday. Save the form to publish the new prices. Prices support two decimal places; additional-guest charges can be zero.

For testing, select **Restore defaults**, then **Save package rates**. Restore defaults fills all six package prices and their additional-guest charges from the original seeded schedule. Saving publishes those prices through the usual version and audit checks. Create a new booking to test OCR with the restored amounts; existing reservations retain their booked rates. No additional migration is required for the restore button.

Package times remain fixed:

- Day: 8 AM–4 PM.
- Night: 6 PM–6 AM the following day.
- Whole day: 8 AM–6 AM or 6 PM–4 PM the following day.

Packages still include 20 guests, with a maximum of 30. The start date in Manila determines the weekday/weekend tier. Automatic holiday overrides are not part of the current booking rules.

The migration seeds the prices previously documented in `RESORT_CONTEXT.md`. After that, guest booking previews, manual bookings, server billing and chatbot quotes read the saved prices instead of using hardcoded defaults. If the migration is missing, paid bookings show an error rather than silently quoting an outdated price. Free ocular requests remain available.

Each published schedule is retained, and each reservation records its booked schedule. New prices apply to new bookings. Existing transaction totals, payments, invoices and receipts are not repriced by a Catalog change. Reservation edits and reschedules calculate package differences using the reservation's booked schedule; service additions retain the existing service billing rules.

Saving rates records the administrator and before/after prices in the audit log. A concurrent administrator save requires reloading the form. If rates change between a guest's preview and reservation creation, creation is rejected and the guest must return to the booking form to review the current total. An insert-time database check also protects against changes that occur immediately after the server reads a quote.

Verify on Supabase after applying the migration: edit each weekday/weekend package; check a new online and manual booking with extra guests; edit/reschedule a pre-existing booking; confirm its original rate schedule and paid amounts remain intact; and try saving a booking preview opened before a rate change. Automated tests cover calculations, input validation, stale schedules and administrator access, using mocked database boundaries.
