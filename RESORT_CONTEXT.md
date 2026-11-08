PRICING ADMINISTRATION

The swimming package prices and times below are initial reference values. Current online weekday/weekend package prices, additional-guest charges and package time slots are managed in Admin > Catalog > Package rates. Times use Philippine time and apply to both weekday/weekend prices. Restore defaults resets prices and time slots in the form; Save package rates publishes them for new bookings. Existing reservations retain their booked rate schedule and exact arrival/departure times. See docs/PACKAGE_RATES.md; apply docs/package-times-migration.sql after docs/package-rates-migration.sql for editable time slots.

APP TIMEZONE: Admin and guest date/time displays, emails, calendar dates, report periods and date-based receipt numbers use Asia/Manila (UTC+8), regardless of device/server timezone. App-generated event timestamps include +08:00. Database timestamptz values preserve absolute instants; do not add eight hours to saved timestamps or rewrite historical payments to change their display date. A UTC timestamp such as 2026-10-16T16:30:00Z displays as October 17, 2026, 12:30 AM in Philippine time. See docs/TIMEZONE.md and apply docs/philippine-timezone-migration.sql for existing installations to fix timezone-stripping defaults and legacy SQL report labels.

LOCATION & CONTACT INFO

Guest registration, profiles, online bookings and staff manual entries require a Philippine mobile contact. Forms show a fixed +63 prefix and accept 10 national digits starting with 9; pasted 09..., 639... and +639... formats are normalized and saved as +639XXXXXXXXX. Registration and reservation APIs validate the same format. Online booking saves the validated contact to the authenticated guest profile used by reservation records. This validates the number format, not ownership through SMS.

Marville Resort, Cabrera Road Hapay na Mangga Brgy. 
Dolores, Taytay, Rizal 1920 

3mins away from Tikling Rotonda 
10mins away from SM Taytay 
15mins away from Taytay Market and Tiangge 
Waze: Marville Resort ( Hapay na Mangga Taytay) 

Inquiries/Bookings: 09172796592/82360633 Call from 8am-5pm or message FB Page 

Email: emailmarvilleresort@gmail.com 

Facebook: @marvilleresort 

Instagram: @marvilleresort

TikTok: @marvilleresort

MARVILLE RESORT PRIVATE POOL RATES W/ 


SWIMMING INCLUSIONS 

- Cottage 

-2 Airconditioned Room w/bed and private toilet (ideal for 2) 

- Videoke 

- Griller (charcoal available at the store) 

- Free Parking 

- Consumable Food 

-In-house food service and sari-sari store available inside 

*additional room -regular rate applies 

*free ocular and may pay reservation online or at the cashier 
Ocular time slots created or edited in Business Catalog must start and end within 8:00 AM–5:00 PM Philippine time. End time must be later than start time; overnight slots are not allowed.

*200 corkage fee for food and drinks 

*electronic appliances are allowed subject to electricity charge 

*swimming extention 500 per hr per 20pax 

*extra mattress foam rent 300 

*cooking will be charged minimum of 150 

*Catering Service for arrangement available 

REMINDERS 

-Guests choose a 20% down payment or the full outstanding balance; proof stays pending until staff verifies the actual transaction.

- remaining balance must be paid upon arrival before swimming 

- do not leave your things unattended we will not be liable for damage or missing personal items 

- kids are advised to be accompanied by adults at resort premises especially at pool area 

- we are not liable of any accidents like alcohol intoxication or drowning but we have lifeguard to guide you, remind you of your actions and save you in case of drowning, doing fake or prank drowning will be asked to leave the pool or resort -Rescue officers or baranggay officials will be called in case of emergency or chaos for safety of everyone inside the resort 

- Guest-initiated cancellation retains the initial 20% deposit; other remaining verified payments may be refunded after prior refunds. Resort-attributable cancellation refunds all remaining verified payments, including the deposit. Eligible requests are automatic, but review, manager approval, manual payout and staff verification are required.
- Guest reschedules no longer need staff approval. A confirmed reservation that has not checked in can be moved immediately to an available future date, including with short notice or after the original swimming date. The new start must be at least 30 minutes ahead; the booked package, start time and duration stay fixed. Completed/cancelled or checked-in reservations cannot be rescheduled. The guest reviews the notice fee and any higher-date-rate adjustment before saving; the date, bill, current invoice, approved history and audit update atomically while existing payments and receipt history are preserved. Pending payment reviews, open refunds and legacy pending reschedule requests must be resolved first. Apply docs/guest-auto-reschedule-migration.sql after the guest-reschedule-requests migration before deploying. Historical pending requests remain available in the legacy staff review queue.
- Change-of-schedule fees use Philippine calendar days before the original date: PHP 50 for 6 or more days, PHP 100 for 3-5 days, PHP 300 for 1-2 days, and PHP 500 on or after the original date. On-time changes still carry PHP 50. Add any higher-date-rate difference using the booked package rates; a cheaper date does not automatically reduce billing. Show the fee before saving, preserve existing payments and charges, and audit the change. Service-only edits have no reschedule fee.
- Guest rescheduling and cancellation require a reason of 5-2,000 characters. Reschedule reasons are saved with approved schedule history and its audit entry; cancellation reasons are saved on the reservation, included in its audit record and passed to the cancellation email. Rerun docs/guest-auto-reschedule-migration.sql to add reason storage and the updated RPC when upgrading an existing automatic-reschedule installation.

WEEKEND & HOLIDAY RATES 

Friday to Sunday 

Day Swimming 

8:00am-4:00pm 

8,000 20 pax 

Add per head 150 

Overnight Swimming 

6:00pm-6:00am 

10,000 20pax 

Add per head 200 

Wholeday Swimming 

8:00am-6:00am 

6:00pm-4:00pm 

15,000 20pax 

Add per head 250 

15,000 20pax 

Add per head 250


ROOM RATES 

Airconditioned Room with Bed and Toilet 

(Ideal for 2pax) 

12hrs-850 

3hrs-300 

Extension-70/hr


WEEKDAY RATES


Monday to Thursday 

Day Swimming 

8:00am-4:00pm 

7,500 20pax 

Add per head 125.


Overnight Swimming 

6:00pm-6:00am 

9,500 20pax 

Add per head 175


Wholeday Swimming 

8:00am-6:00am 

14,500 20pax 

Add per head 225 

FOOD ORDERS 

Call or message 

Archer's Asian Cusine 

09172796592/ 

09163339655 or 

FB Page: 

Archer's Asian Cuisune 

PAYMENT 

Gcash
Franklin O.
09282245826


## Guest account access

Administrators can search registered guests and deactivate/reactivate access under Users > Guest Accounts. Staff-generated guest profiles are excluded; walk-in profiles remain separate. Deactivation clears the website session, blocks guest sign-in and protected actions, and records the actor/status/reason in the audit log. It does not cancel reservations or change payments/refunds. Reactivation requires a new sign-in. Apply docs/guest-account-status-migration.sql before deploying this feature.


## Cash received at the resort

Online bookings and guest payment submissions remain GCash only. Authorized staff can receive cash at check-in and record a full or partial balance settlement in Transactions > Transaction Ledger > Record cash / Settle in cash. This credits the actual cash received, updates the bill, issues a printable receipt and records an audit entry atomically. Cash is hidden from the public payment catalog. Apply docs/staff-cash-payments-migration.sql after the existing billing/refund/permission migrations before deploying.

## Guest booking edits

Guests can update adult and child counts before check-in (at least one adult, maximum 30 guests). While a balance remains and before check-in, they can also reduce or remove optional services; existing services cannot be reduced after full payment. Service additions remain available during an active stay. The editor keeps the booked package and schedule, shows a bill preview, uses historical package/service prices, and preserves payments and receipts. Open payment, reschedule or refund reviews block editing. Saved changes update the bill/current invoice and audit history atomically. Excess payments remain available through the manual excess-refund workflow. Apply docs/guest-booking-edit-migration.sql before deploying these guest edit controls.


ADMIN RESERVATION CALENDAR AND ARRIVAL RECORDS

- Booking requests (pending/payment submitted), confirmed reservations and closed bookings have separate calendar labels. Attention flags do not replace their reservation status.
- Records > Reservation Records includes a View action for every reservation status. Its read-only dialog shows the linked registered or walk-in guest, original schedule, attendance, accommodation/services, recorded bill and notes. Records permission is sufficient; viewing does not grant reservation editing or payment approval. Walk-in names also appear on related reschedule records, using the reservation owner when there is no registered requester.
- Calendar filters identify submitted payments, pending reschedules, open refunds, unpaid balances and confirmed arrivals today without recorded check-in. Dates and arrival flags use Philippine time. Cancelled reservations can still need refund processing.
- Authorized staff with Edit reservations permission record actual arrival for a confirmed reservation arriving today, after acknowledging that the guest is present. Check-in records server time, staff identity and an audit entry; it does not settle the bill or change reservation status.
- Manual entry is only for guests without an account who book through phone, Messenger or walk-in. Existing guest accounts must book through their own account. The server rejects existing-account payloads and registered email addresses supplied as walk-in guests.
- Staff can create a manual booking only before the saved package starts, using Philippine time. Staff entry has no 30-minute lead requirement; packages that have already started and past arrival dates are rejected. Package times/prices, availability, payment verification and actual check-in remain separate. Guest online bookings still require a start at least 30 minutes ahead.
- Guest cancellation first offers rescheduling instead, retaining availability, future-date, fixed-package and fee rules. Valid guest reschedules are approved automatically. Availability loading allows choosing a candidate date but cannot enable submission until availability and the charge preview are ready.


PAYMENT REVIEW AND REPORT ACCESS

- A manager or other active staff member with payment_approval permission can inspect and approve or reject submitted payments directly in a selected calendar reservation. Reservations access is sufficient for this entry point; Transactions remains available to roles with that module permission.
- Rejection requires a meaningful 5-to-2,000-character reason. The server and database enforce it, preserve the reviewer and audit details, and include the reason in the guest notification. Staff cannot change an already recorded rejection reason. Verified receipts and net balances continue to account for completed refunds.
- Guest Report is in the Reports module alongside Sales Report and Staff Report, and requires Reports permission. Financial Report remains removed. Printed charts use SVG graphics and divide long line/bar series into readable sections.
- Guest booking calendar maintenance closures use a distinct purple colour and Closed for maintenance label, rather than Fully booked. Refund verification notifications and email subjects say Refund completed.


### Arrival, departure and guest reviews

- Authorized staff records check-in for confirmed arrivals. Checked-in reservations cannot be cancelled or rescheduled by guests or staff; billing and additional services remain manageable during the stay.
- Checkout requires actual check-in and full settlement using verified payments less completed refunds. Staff confirms departure; the system records checkout and marks the reservation completed. Scheduled end time alone does not complete a stay.
- Any active registered guest may submit a review without a reservation or completed stay. Optional linked reservations must belong to that guest, regardless of status. Existing repeat-review rate limits remain in force. Apply docs/review-without-completed-stay-migration.sql after stay-completion and review-feedback-management migrations.
- Ocular visits confirm automatically when capacity and maintenance availability permit. The existing ocular_approval permission now controls attendance management; managers may cancel with a reason. There is no approval/rejection workflow.
- Business Catalog exposes swimming prices in Package rates and accommodation prices in Units; legacy Unit rates and Guest rates tabs are hidden. The permission matrix saves both editable roles with one Save permissions action.
- Apply docs/stay-completion-migration.sql and docs/ocular-review-migration.sql after the prerequisites in each file before deploying these workflows.

STAFF ROLE BOUNDARIES: Admin has full Users, Configuration and Business Catalog access only. Other modules permit viewing, searching, filtering, sorting, pagination and refresh; operational changes and export/print actions are unavailable. Managers (stored role staff) approve/reject refunds with refund_approval permission. Cashiers cannot approve refunds. Refund review, payout and verification remain separate configurable permissions; another authorized staff member verifies a payout. Authorized managers handle maintenance with edit_reservation and resort-attributable cancellations with cancel_reservation. Apply docs/admin-read-only-manager-refunds-migration.sql before deploying; it preserves existing manager grants and adds Transactions/refund approval, protects operational database writes, and preserves existing requests and amounts.

ADMIN TABLES: Record tables paginate by default (25 rows unless a module sets another size). Search/filter changes reset to the first page; exports use all matching rows. Multiple row actions use a three-dot dropdown with keyboard controls; single actions remain visible. Staff/transaction/receipt sources collect all database pages instead of truncating the available records. Refund requests and their payment evidence paginate independently.

OCR TESTING APPROVAL: New GCash payment submissions whose server OCR result is consistent (complete amount, reference, recipient and current Manila receipt time) are approved immediately through the service-role-only submit_consistent_gcash_payment RPC. Approval, booking confirmation, net paid totals, receipt creation and an audit entry with automatic_approval=true commit together. Existing pending payments retain manual review. Apply docs/ocr-auto-approve-payments-migration.sql before deploying. Overpayments are tracked as verified excess but DO NOT create refund requests automatically; guests use Request excess refund in Manage Booking, after which manager approval and manual payout verification remain required.

GCash iPhone masked recipients: accept a complete phone pattern with four clear trailing digits and require every visible digit to match the configured receiving account. Read visible prefix/suffix pixels separately from privacy dots before the readability gate; retain native digit size and OCR confidence checks. Account/form values are never supplied to OCR.

GCash footer OCR: split geometrically separated reference/date columns before retrying uncertain digits. Retain confidence and native-size requirements. Readability errors identify the uncertain fields instead of declaring that a screenshot is blurred.

ADMIN EXPORT PERMISSIONS (supersedes the earlier export restriction): Admin may export CSV and print/save PDF in Reports and Analytics, and export CSV in Audit. Other operational modules remain view-only with search/filter/refresh; creating or changing operational records and starting feedback analysis remain restricted. No database migration is required for these client-side exports.

NOTIFICATION TRAYS: Staff and guest trays have All / Read / Unread filters with an active-button highlight. Unread items use blue backgrounds and a blue left border; read items use neutral backgrounds, with visible status labels. Opening a tray does not mark its contents read. Following a notification marks only that item read; Mark all read remains explicit. Apply docs/notification-customer-names-migration.sql to enrich existing and future booking notices as Customer Name (Reference Number), including walk-ins, payment and refund notices. Recipient access and existing read flags are preserved.

CALENDAR VISIBILITY: Desktop and mobile use distinct, customizable status colors with a shared legend. Needs-attention entries always use red and descriptive labels instead of exclamation badges. Search/filter changes debounce before scrolling to the full calendar and briefly highlighting matches; mobile Week moves to the first matching day. Reduced-motion preferences disable animation. Calendar colors and viewed-reservation IDs persist per staff account in local browser storage; a glowing dot marks unviewed bookings and disappears from all date entries once details are opened. Colors can reset independently of viewed history. New manual bookings navigate to their booking date and clear search/filter restrictions. No SQL migration is needed.

Calendar color controls open in a modal using the palette icon beside Refresh calendar. Changes save automatically; Escape/close restores focus to the icon.

MODULE NAVIGATION: Admin/staff module tabs use visible borders and a primary-tinted hover background; sidebar modules use bordered cards with an amber hover highlight. Notification filter buttons share the stronger hover treatment. Staff, managers and cashiers share guest-style All/Read/Unread filters, status colors, explicit read actions and an account-saved popup-notification toggle with save-error feedback.

TRANSACTION GUEST NAMES: Ledger, Payment Verification Queue, Generated Invoices, Issued Receipts and Refund Requests display a Guest name column. Registered and walk-in names are loaded in batches from the reservation owner, including middle names when present; payment sender/account names are not used as the guest. Table searches match guest names. Refund search combines guest/reference matching with status filters and resets pagination. Receipt billed-to snapshots remain authoritative with a reservation-name fallback. No SQL migration is needed.

CHATBOT ADMINISTRATION: Configuration > Chatbot manages up to 40 approved FAQ question/answer pairs and an optional Facebook Messenger URL. Guest FAQ buttons use saved configuration; exact questions return the approved answer directly. General AI replies use approved FAQs/current contacts as their reference instead of the static context file, while live rates and authenticated own-booking data remain authoritative. Human support requests return a clickable MarVille Resort Facebook Messenger link and notify active admins with the saved customer name, reason and an owned booking reference when supplied; anonymous visitors are identified, sensitive details omitted, and delivery failures do not hide the direct link. See docs/CHATBOT_ADMINISTRATION.md. Apply docs/manager-ocular-cancellation-migration.sql to enable authorized manager cancellation of pending/confirmed ocular visits with a required 5–2000 character reason, actor/time and atomic audit. The calendar and Records provide cancellation controls; guest notifications and cancellation emails include the reason.

PRINTED RECEIPTS: Receipt documents contain receipt number/issue time, guest name, reservation reference, Payment for (reservation down payment/payment/additional payment plus package), resolved payment method name, payment reference/time, amount paid, booking total at payment and balance after payment. Reservation/receipt/payment status, booking source, duplicate payment amounts and internal account/proof fields are omitted. Saved billed-to names and receipt amount/balance snapshots are preserved; missing names fall back to the registered or walk-in guest's full name. Method IDs are never printed; missing method names show Unavailable or Not recorded. No migration is required.


### Additional service photos
Administrators can upload, replace, or remove each service photo in Business Catalog. PNG, JPEG, and WebP uploads up to 5 MB use the admin-only content image uploader. Save the service to publish the photo or removal. Booking service cards show the photo, description, and price, with a default placeholder for missing or unavailable images. Guests can click a service photo to open a full-image preview; the close button, Escape, or backdrop closes it without changing the service selection. Apply `docs/service-images-migration.sql` before deploying. Staff account status labels use Active / Deactivated; stored activation flags are unchanged.


### Reservation management rules
New online and staff-entered reservations must begin in the future using Philippine package clocks. Staff entry cannot use an ongoing package; online bookings retain the 30-minute lead requirement. Offline guest email is optional (stored as null when blank); a supplied email must be valid. Registered guest email requirements remain unchanged.
Authorized operational staff may edit adult/child counts before checkout, including after check-in and after scheduled departure while a checked-in stay remains active. The stored package rate version prices the guest-count difference; existing payments, historical receipt snapshots, negotiated charges and earlier fees are preserved, the current invoice follows the bill, and a reasoned before/after audit records the count change. Check-in continues to lock the schedule, package, accommodation and existing service reductions. Completed, cancelled and pending-review records remain locked. Admin operational access remains read-only.
New manual bookings navigate to their date and scroll to the full calendar, briefly pulse only the created reservation, and show a success toast. Reservation dialogs close through X, ignoring Escape and outside clicks; changed forms ask Continue Editing / Discard Changes, including customer booking forms and cancellation dialogs. Reverted or saved forms stay clean; browser unload uses its native unsaved-change prompt. Apply `docs/reservation-management-improvements-migration.sql` before deploying these rules.


TIMED MAINTENANCE AND RECORD INTERACTIONS (latest): Apply `docs/timed-maintenance-auto-ocular-migration.sql` after its listed prerequisites before deploying. Administrators and managers with reservation-edit permission can create/release maintenance periods; this is an explicit admin exception to operational read-only access. Choose exact PHT start/end dates and times or inclusive whole days. Existing date blocks migrate to whole PHT days. Maintenance, reservation creation/edits/reschedules and ocular visits share day locks and use half-open timestamp overlap checks. Maintenance cannot displace active reservations or ocular visits; cancel a conflicting visit first. Names/reasons remain staff-only; public APIs and guest notifications provide generic availability, and old maintenance notifications are sanitized. Creation gives success/error feedback, preserves failed form input and scrolls/pulses the created calendar block.

Ocular visits automatically confirm under an atomic capacity/maintenance check independent of guest row visibility, including rescheduling. Eligible future legacy pending visits are confirmed; historical or conflicting requests are retained for follow-up. Staff can mark a confirmed visitor as visited after its scheduled start, with an audit entry; managers retain cancellation with a reason. The old approval endpoints are retired. `/ocular` redirects to the actual booking flow. Public ocular availability returns aggregate unavailable slots, without guest identities or maintenance details.

Shared record table rows support click and Enter/Space to open details; Catalog and Refund rows also open their details. Actions are available inside details and in menus. Checkbox labels have larger click areas, selected rows are highlighted, and menus/checkboxes do not trigger row navigation.


OCR CODE TOGGLE: `ENABLE_RECEIPT_OCR` in `lib/server/gcash-ocr.ts` defaults to true. Set false and restart/redeploy to skip text recognition for both checkout and subsequent payments. Upload ownership, actual image format/size, GCash method, reference, amount/minimum, duplicate submissions and deadlines remain validated. Disabled OCR uses `submit_unscreened_gcash_payment` to save pending/not_applicable receipts with no extracted time or automatic approval; verified balances and receipts remain unchanged until staff verification. Apply `docs/ocr-toggle-manual-review-migration.sql` after OCR auto-approval prerequisites before turning it off. The toggle is server code only; guests cannot select it in a request.


BETA RECEIPT REUSE: `ENABLE_BETA_RECEIPT_REUSE` in `lib/server/gcash-ocr.ts` is currently true for the beta test; set false afterward. With OCR enabled, set it true and restart/redeploy to reuse a readable receipt: entered-reference comparison, duplicate original receipt references and current-date checks are skipped. Amount/minimum, recipient, successful status, readability, ownership and booking/deadline checks remain. Apply `docs/ocr-beta-receipt-reuse-migration.sql` first. The server-only beta RPC retains original reference/date evidence, assigns a unique internal reference without dropping normal indexes, auto-approves through the existing atomic workflow, marks is_beta_test, and audits the beta submission. Customer screens and notifications use the standard payment wording without beta implementation details; internal payment markers/audits remain and normal approval emails are skipped. Restore false after beta testing; existing beta records remain marked. Requests cannot enable the flag themselves.


BOOKING MODE CALENDAR: Guest booking dates are enabled only for the selected Day/Night/Whole Day package and exact Whole Day variant, using package start-time, reservation-overlap and timed-maintenance checks. Clicking a date never silently switches the package. Mode/variant controls remain available; changing one clears an incompatible selected date. Calendar guidance names the selected package. Cancellation, photo-preview and notification dismiss controls use SVG close icons instead of text glyphs.
