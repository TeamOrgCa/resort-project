# Booking, payment, and manage booking validation report

Date: 2026-09-30

## Scope and result

Reviewed the customer stay booking flow (`/booking`, `/booking/form`, `/booking/details`), payment submission (`/booking/payment`), manage booking (`/manage`), and their relevant API routes. Code paths and validation were checked. A live transaction was not performed because this workspace does not include a signed-in test account or a payment sandbox.

## Changes made

| Area | Finding | Resolution |
| --- | --- | --- |
| Guest details Continue | A link navigated to the review page even when its click handler returned early. Disabled child buttons also did not reliably block a parent link. | Continue is now a button that validates before navigating. Missing dates or room, invalid names, email, phone, and guest counts show an error. |
| Guest phone | Free text was accepted. | Input now keeps digits only, up to 15 digits; submission requires 7–15 digits. |
| Review page | Payment and manage links could be followed before a reservation was saved. | Links now block navigation until the reservation ID exists. |
| Payment account number | The wallet account field allowed letters, and the API accepted them. | Input strips non-digits; client and API require 6–20 digits for wallet methods. Bank reference numbers remain free text because bank references can contain letters. |
| Manage ocular Edit | Save Changes only updated local state; a refresh lost the edit. | Added authenticated `/api/ocular-visits/reschedule` endpoint. It checks owner, editable status, future date, active slot, slot capacity, and another visit on the same day before saving. UI updates after API success. |
| Manage stay reschedule | Date strings were derived from UTC, which can shift the calendar day in Manila. | Date strings are derived from the local booking date. |
| Manage stay cancellation | The dialog stated a two-day rule, but the API enforcement had been commented out. | API and UI now enforce a 48-hour lead time and disallow completed bookings. |

## Action review

| Screen | Action | Status |
| --- | --- | --- |
| Booking | Stay/ocular selection, dates, mode, time selection, Continue | Existing handlers inspected; Continue validates a booking window before routing. |
| Guest form | Back, service selection, Review Full Details | Back routes to booking. Service selection updates draft pricing. Review now validates and routes only on success. |
| Review | Back to Edit, Save Booking, Continue to Payment, Manage Booking | Save calls the create API and stores the returned reservation ID. Continue and Manage require that ID. |
| Payment | Method selection, down payment/full payment, proof upload/remove, Back, Confirm Payment | Confirm checks terms, payment state, method, proof type/size, reservation details, and wallet account number. The API validates the account number and reservation/payment rules. |
| Manage stay | View, Edit services, Resched, Pay Balance, Cancel | View displays record. Edit calls services API. Resched calls reschedule API. Pay Balance loads the reservation into payment. Cancel opens confirmation and calls cancel API. |
| Manage ocular | View, Edit, Cancel | View displays record. Edit now persists through a new API. Cancel opens confirmation and calls cancel API. |

## Verification and limits

- `npx.cmd tsc --noEmit`: passed.
- Targeted ESLint on changed booking, payment, manage, and API files: passed.
- Full `npm.cmd run lint`: passed.
- Production `npm.cmd run build`: passed (network access was needed to fetch the configured Montserrat font).
- Browser and database integration, payment proof upload, payment approval, email delivery, and concurrent slot reservation were not exercised. These require a configured Supabase instance and test users. Slot capacity uses a read then update, so simultaneous requests still need a database constraint or transaction for strict protection.

## Reschedule overlap follow-up (2026-09-30)

The guest reschedule API rejects a requested Manila calendar date that overlaps another active reservation for the same guest, excluding the reservation being moved. Staff approval checks again because the guest may book another date while the request is pending. Pending reschedule requests continue to occupy their original booking window. The booking creation and checkout paths use the same per-guest check. Different guests may book the same date, as specified in `SYSTEM_IMPROVEMENT_CONTEXT.md`.

The previous global overlap migration has been superseded. Existing databases need [the reservation lifecycle migration](reservation-lifecycle-migration.sql) for the per-guest date constraint, payment deadline, and state guards. It has not been run from this workspace.

## Manual acceptance checklist

1. Sign in as a guest; create a stay and try invalid name, email, phone, guest counts, and missing room before review. Confirm the page stays on the form and shows an error.
2. Save once on review, then use Continue to Payment. Confirm an unsaved review cannot navigate to payment or manage.
3. On a wallet payment, paste `abc09-123` into Your Account Number. Confirm only `09123` remains and submission rejects it as too short. Enter a valid 6–20 digit account number, upload an image, accept terms, and submit. Confirm one pending payment appears.
4. In Manage Booking, exercise View, Edit services, Resched, Pay Balance, and Cancel on eligible test reservations. Confirm disabled actions for completed/cancelled records and the 48-hour cancel rule.
5. Create an ocular visit. Edit its date/slot, refresh Manage Booking, and confirm the change persists. Try a full slot, duplicate same-day visit, and cancelled visit to confirm rejection. Test ocular cancellation separately.
