# Editable Terms and Privacy Policy

## Deployment

Apply [legal-policy-versioning-migration.sql](legal-policy-versioning-migration.sql) in the Supabase SQL Editor **before deploying the updated app**. It assumes the existing catalog, guest-registration and reservation schema is installed. The migration runs in a transaction and can be reapplied without resetting published versions.

It reuses `reservation_policies`; it creates no new table. It adds revision metadata and legal acceptance references to the existing `guests` and `reservations` tables. The current website text is imported as Terms version 1 and Privacy version 1. Existing general catalog policy rows are retained; they are not automatically substituted for either legal document.

If the migration is missing or the documents cannot be loaded, registration and online booking cannot accept policies. There is no silent fallback to older hardcoded text.

## Administrator workflow

1. Open **Business Catalog → Policies**.
2. Choose **Terms and Conditions** or **Privacy Policy**.
3. Edit the document title/text and enter a reason for the revision. Plain text supports `#` headings, blank paragraphs and `-` list items. HTML is displayed as text.
4. Review the preview, click **Publish new version**, and confirm.
5. Expand **Version history** to read earlier versions and their revision reasons.

Each document has its own sequential version number. Publishing changes only the selected document, records the administrator and server publication time, and adds an audit entry. It immediately changes `/terms` or `/privacy` and the registration/new-booking agreement reader. Draft edits remain local until published; they are not saved across page navigation.

Published text and revision metadata cannot be overwritten or deleted. To correct or restore earlier wording, publish it as another new version with a reason. Two administrators cannot silently overwrite one another: a stale editor must reload the latest version before publishing.

## Acceptance records

The shared reader requires guests to scroll to the end before explicitly checking the agreement checkbox. Registration and booking submission validate the displayed pair of document versions on the server. If either changes before submission, the form retains entered details, reloads the reader, and requires review and agreement again.

New registered guests and online reservations store immutable `terms_policy_id`, `privacy_policy_id` and database-generated `legal_accepted_at`. The referenced policy records preserve the exact accepted text. Registration also records the IDs/version numbers in authentication metadata, but the durable guest acceptance is separate from editable metadata.

Existing bookings keep their accepted versions when a new document is published. Their payment reader retrieves those versions. Older bookings without recorded versions show the imported original documents with a notice that the original acceptance version was not recorded. Existing guest/booking records are not backfilled with invented acceptance dates. Staff provisioning and manual bookings may have no online acceptance.

This release does not force every historical account to accept a new document at sign-in. New registrations and new online bookings require the current versions.

## Separate operational booking rules

Cancellation notices and refund rules continue to use **Configuration → Reservation settings** and the existing `booking_policy_versions` mechanism. They appear alongside the legal text in the agreement reader. Editing legal prose does not change operational fees, cancellation windows, rates or refund calculations; keep the two sets of wording consistent when making business changes.
