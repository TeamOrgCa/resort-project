# Service quantities and booking limits

Apply [service-quantity-limits-migration.sql](service-quantity-limits-migration.sql) in Supabase SQL Editor before deploying the quantity controls. It adds `max_quantity` to the existing `services` table and a trigger on `reservation_services`. It creates no table.

In **Business Catalog > Services**, add or edit a service and set **Maximum quantity per booking** to a whole number from 1 to 10,000. New service forms start at 1. Existing services retain the previous 10,000 technical ceiling until an administrator sets their actual limits. This is a per-booking maximum, not shared inventory across overlapping reservations.

In the guest booking form, select a service, then use its quantity field or minus/plus buttons. Each service shows its unit price, maximum and line total. Quantities carry through booking review, saving, payment summaries and billing. Totals use unit price multiplied by quantity. Older drafts without a quantity retain one item.

Guest booking creation, legacy checkout, staff manual creation and guest/staff edits validate the configured limits. The database trigger also protects direct inserts and atomic service-edit RPCs, including changes to limits while a booking is being saved. Invalid quantities roll back their database statement; atomic bill edits preserve the bill, invoices, receipts and audit records on failure.

Lowering a maximum does not change existing bookings or issued receipts. An existing quantity above the new limit can be retained or reduced, but cannot be increased. After a reduction is saved, subsequent changes use that reduced quantity or the current maximum, whichever is greater.
