# Editable swimming package prices and time slots

Apply [package-rates-migration.sql](package-rates-migration.sql) in the Supabase SQL editor before deploying this change. It requires the existing `staff_users`, `audit_logs` and `reservations` tables. The same migration is included at the end of `updated-schema.sql` for new installations.

For editable time slots, also apply [package-times-migration.sql](package-times-migration.sql) **after** the package-rates migration and before deploying the updated app. It adds time slots to each saved rate version, preserves the original times on historical versions, and validates new reservations against their quoted slot. Reapplying it preserves edited schedules. Both migrations are included in `updated-schema.sql` for new installations.

Open **Admin → Catalog → Package rates**. An active administrator can edit the package price and additional-guest charge for day, night and whole-day swimming, separately for Monday–Thursday and Friday–Sunday. The **Package time slots** section edits the start time, end time and departure day for day, night, whole-day Variant A and whole-day Variant B. Times use Asia/Manila and apply to both weekday/weekend prices. Choose Same day or Next day for departure. Each slot must last more than zero and at most 24 hours. Save the form to publish prices and times together. Prices support two decimal places; additional-guest charges can be zero.

For testing, select **Restore defaults**, then **Save package rates**. Restore defaults fills all six package prices and their additional-guest charges from the original seeded schedule, and resets all four slots to the original times below. It fills the form without publishing until you save. Saving publishes prices and times through the usual version and audit checks. Create a new booking to test OCR with the restored amounts; existing reservations retain their booked rates and exact times.

Default time slots:

- Day: 8 AM–4 PM.
- Night: 6 PM–6 AM the following day.
- Whole day: 8 AM–6 AM or 6 PM–4 PM the following day.

Packages still include 20 guests, with a maximum of 30. The start date in Manila determines the weekday/weekend tier. Automatic holiday overrides are not part of the current booking rules.

The migrations seed the prices and times previously documented in `RESORT_CONTEXT.md`. Guest booking previews, manual bookings, calendar availability, server validation, public rate cards and chatbot quotes read the saved schedule. A guest continuing with an outdated schedule must return to the calendar to review it. Free ocular requests remain available.

Each published schedule is retained, and each reservation records its booked schedule. New prices and times apply to new bookings. Existing transaction totals, payments, invoices, receipts and arrival/departure times are not changed by a Catalog update. Reservation edits and reschedules use the reservation's booked schedule and preserve its original time and duration; service additions retain the existing service billing rules. Changing catalog times is not an extension of an existing stay.

Saving records the administrator and before/after prices and times in the audit log. A concurrent administrator save requires reloading the form. If prices or times change between a guest's preview and reservation creation, creation is rejected and the guest must return to the booking form to review the current schedule. An insert-time database check also protects against changes that occur immediately after the server reads a quote, and rejects submitted timestamps that do not match the saved package.

Verify on Supabase after applying the migration: edit each weekday/weekend package; check a new online and manual booking with extra guests; edit/reschedule a pre-existing booking; confirm its original rate schedule and paid amounts remain intact; and try saving a booking preview opened before a rate change. Automated tests cover calculations, input validation, stale schedules and administrator access, using mocked database boundaries.
