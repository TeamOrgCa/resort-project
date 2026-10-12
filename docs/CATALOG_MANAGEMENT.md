# Admin catalog

The catalog opens with active items. Use the category buttons to switch between
services, units, unit rates, guest rates, payment methods, payment accounts,
general policies, and ocular slots. Active, Archived, and All filters include
matching counts. Named items support search; unit rates can be filtered by unit.

Add and Edit open a focused dialog. Descriptions, instructions, and policy text
support multiple lines. Prices accept cents, capacities accept whole numbers,
and dated rates use calendar inputs. Clearing an optional field persists `null`,
including an end date. Account numbers remain text to preserve leading zeros.

Archive requires confirmation and sets `is_active = false`; units also receive
an archive timestamp. Existing reservations and historical links are retained.
Restore is available in Archived and All views and clears a unit's timestamp.
Editing an archived item preserves its status. Only one guest rate can be active:
the existing database trigger deactivates the previous rate when a rate is added
or restored.

Admin reference lookups include archived units and payment methods so historical
records retain their names. New references must point to active parents. Restoring
a unit rate or payment account requires its parent to be active. Archiving a
payment method hides its linked accounts from the guest catalog without deleting
those accounts. Guest catalog and ocular-slot responses are not browser-cached.

Payment accounts require a QR image, including existing accounts that do not yet
have one. Existing images are retained unless a replacement is selected. Details
and QR are submitted together; upload failures do not create accounts or modify
existing details. Failed database saves remove the newly uploaded image. Uploads
validate PNG, JPEG, or WebP signatures and a 5 MB limit.

QR images use the private `payment-qr-codes` bucket. Uploads provision it if it is
missing; `docs/payment-qr-migration.sql` also creates it for older deployments.
Guest payment pages show signed QR images with scan instructions and an image
link, offer reload on failures, refresh signed URLs before expiry, and exclude
methods without a usable QR. Admin uploads and guest signing use the server's
Supabase service role; browser storage policies are not needed for QR access.

All catalog endpoints require an active admin session. The API accepts only known
resources and editable fields, validates complete merged records on edit, returns
404 for missing records, and writes success audit events after successful mutations.
Existing account rows are retained; edit accounts without QR images to upload one.

Validation: `node --experimental-strip-types --test tests/catalog*.test.mjs`.
These tests exercise real route handlers with in-memory PostgREST/storage substitutes;
they do not mutate live Supabase data. They cover all eight resource lifecycles,
validation, nullable updates, missing/failed writes, permissions, status/search/
pagination, archived references, guest visibility, QR failure handling, and form
field rendering. The existing database's guest-rate activation trigger is not
executed by the substitutes.
