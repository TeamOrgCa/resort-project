PRICING ADMINISTRATION

The swimming package prices and times below are initial reference values. Current online weekday/weekend package prices, additional-guest charges and package time slots are managed in Admin > Catalog > Package rates. Times use Philippine time and apply to both weekday/weekend prices. Restore defaults resets prices and time slots in the form; Save package rates publishes them for new bookings. Existing reservations retain their booked rate schedule and exact arrival/departure times. See docs/PACKAGE_RATES.md; apply docs/package-times-migration.sql after docs/package-rates-migration.sql for editable time slots.

APP TIMEZONE: Admin and guest date/time displays, emails, calendar dates, report periods and date-based receipt numbers use Asia/Manila (UTC+8), regardless of device/server timezone. App-generated event timestamps include +08:00. Database timestamptz values preserve absolute instants; do not add eight hours to saved timestamps or rewrite historical payments to change their display date. A UTC timestamp such as 2026-10-16T16:30:00Z displays as October 17, 2026, 12:30 AM in Philippine time. See docs/TIMEZONE.md and apply docs/philippine-timezone-migration.sql for existing installations to fix timezone-stripping defaults and legacy SQL report labels.

NOTIFICATION CONFIGURATION: The unused Configuration > Notification settings tab and its email/SMS template and admin channel controls have been removed because delivery logic never read them. Existing stored notifications.* preferences are left in the database but are no longer editable through the settings API. Working guest/staff notifications, account pop-up preferences, and Payment settings > Email receipts remain available. No database migration is required.

GUEST ONLINE PAYMENTS: Active non-cash Business Catalog methods with an active receiving account are available for guest checkout and balance payments. GCash retains OCR checks and conditional automatic approval. Other methods validate the owned receipt image without OCR and save pending evidence only; an authorized cashier must verify actual received funds, amount, recipient and reference before approval credits the balance and creates a receipt. Cash stays staff-only. Receiving accounts are selectable and linked to manual guest payment records. Apply docs/guest-payment-methods-migration.sql after its listed prerequisites before deployment; see docs/GUEST_PAYMENT_METHODS.md.

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

- Guest-initiated cancellation retains the initial 20% deposit and non-refundable reschedule fees; other remaining verified payments may be refunded after prior refunds. Resort-attributable cancellation refunds remaining verified payments including the deposit, but retains reschedule fees. Approved guest-reschedule fees and committed staff-reschedule notice fees accumulate; higher-date-rate adjustments are not treated as fees. Deductions never exceed remaining verified payments. Apply docs/non-refundable-reschedule-fees-migration.sql after the existing cancellation, manager-permission, reservation-edit and guest-auto-reschedule migrations. This applies to new cancellation quotes/requests; historical refund snapshots and completed payouts remain unchanged. Eligible requests are automatic, but review, manager approval, manual payout and staff verification are required.
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

Online bookings and guest payment submissions support active non-cash catalog methods. Non-GCash proofs require cashier verification; eligible consistent GCash receipts retain automatic approval. Authorized staff can receive cash at check-in and record a full or partial balance settlement in Transactions > Transaction Ledger > Record cash / Settle in cash. This credits the actual cash received, updates the bill, issues a printable receipt and records an audit entry atomically. For a newly recorded cash payment on a confirmed reservation, the guest receives a reservation-confirmed notification and confirmation email alongside the cash-payment notice and billing documents. Confirmation checks use the committed reservation status, and replaying the same cash reference does not resend notices. Cash is hidden from the public payment catalog. Apply docs/staff-cash-payments-migration.sql after the existing billing/refund/permission migrations before deploying.

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
- REVIEW ELIGIBILITY (restored): Only active registered guests with at least one own reservation marked completed may submit a review. Paid, checked-in, past-date, cancelled, no-show or ocular records do not qualify. Optional linked reservations must be owned completed stays. Eligibility API, submission API and database guard enforce the same rule before uploads/writes. Existing reviews, photos, moderation, cooldowns, daily quotas and duplicate checks remain. Apply docs/review-completed-stay-required-migration.sql after the previous review/stay migrations; it supersedes review-without-completed-stay-migration.sql. User manuals and PDF describe the restored rule.
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


BETA RECEIPT REUSE: `ENABLE_BETA_RECEIPT_REUSE` in `lib/server/gcash-ocr.ts` is currently true for the beta test; set false afterward. With OCR enabled, set it true and restart/redeploy to reuse a readable receipt: entered-reference comparison, duplicate original receipt references and current-date checks are skipped. Amount/minimum, recipient, successful status, readability, ownership and booking/deadline checks remain. Apply `docs/ocr-beta-receipt-reuse-migration.sql` first. The server-only beta RPC retains original reference/date evidence, assigns a unique internal reference without dropping normal indexes, auto-approves through the existing atomic workflow, marks is_beta_test, and audits the beta submission. Customer screens and notifications use the standard payment wording without beta implementation details; internal payment markers/audits remain. Consistent, auto-approved beta payments send the same reservation confirmation, receipt and invoice emails as normal auto-approved payments. OCR-disabled submissions stay pending and do not send approval emails. Restore false after beta testing; existing beta records remain marked. Requests cannot enable the flag themselves.


BOOKING MODE CALENDAR: Guest booking dates are enabled only for the selected Day/Night/Whole Day package and exact Whole Day variant, using package start-time, reservation-overlap and timed-maintenance checks. Clicking a date never silently switches the package. Mode/variant controls remain available; changing one clears an incompatible selected date. Calendar guidance names the selected package. Cancellation, photo-preview and notification dismiss controls use SVG close icons instead of text glyphs.


BILLING EMAIL PDF ATTACHMENTS: Receipt and invoice emails include downloadable PDF copies, with the configured logo, Philippine booking times, itemized charges, payment method/reference and balance. Receipt values use the issued receipt snapshot; invoices use current verified payments. Each new cash or OCR-verified payment sends its receipt and an updated invoice even if an earlier invoice was emailed. Existing delivery flags prevent replaying both documents for an already-emailed payment; failed deliveries remain retryable. Billing email configuration remains respected. Apply docs/billing-pdf-email-migration.sql after billing-document-email-migration.sql so the service-role OCR workflow can read the email setting and record delivery; guests remain unauthorized. The migration also allows recording a failed delivery of an updated invoice previously marked sent. PDF files use pdf-lib, fontkit and the bundled OFL Noto Sans font.


BILLING EMAIL RPC FALLBACK: Authorized payment follow-ups fall back to a service-client read of payments.receipt_settings if billing_email_enabled fails (missing/stale RPC or staff-session permission error). The emailEnabled=false setting remains respected. If recording delivery through the RPC fails, server-only updates save the same email flags. This helper is called only after the payment route's existing permission and verification checks. Cash payment responses and the cashier success message report receipt/invoice email results and actionable failures separately from successful cash recording.

UPDATED BILLING STATEMENTS: Committed staff and guest booking edits email the current statement when services, guest counts, schedule, accommodation or the bill change. Service-charge additions through the older services endpoint also email a statement. Note-only and unchanged saves do not resend it. The email and attached PDF show current itemized charges, verified/net payments, remaining balance and the statement update time. Existing invoice delivery flags do not suppress a revised statement; pending bookings without an invoice use the booking reference without creating an invoice record. Email settings and optional walk-in email addresses remain respected. Delivery failure is reported separately from a successful edit. Existing receipt amounts and balances remain unchanged, and editing a bill does not issue or resend payment receipts. This uses existing tables and requires no new migration.

ABOUT RATES AND ROOM PHOTOS: The About page and Website content configuration no longer display or edit resort brochure images, headings or notes; current Business Catalog package rates, inclusions and reminders remain. Guest booking Room Type uses selectable photo cards with room descriptions, capacity and a native radio group. Selecting a photo or room name updates the same unit ID and booking summary; package pricing is unchanged. Existing draft selections are retained only when the unit is still active in the current catalog. Missing, invalid and failed photos use /images/unit-placeholder.svg. Admin Business Catalog > Units supports uploading, replacing, entering an image URL/path and removing the unit photo, using the existing admin image uploader/storage and units.unit_img column. Save publishes the URL; uploading disables save/close until it completes. No table or migration is added.

REGISTRATION POLICY AGREEMENT: Guest registration reuses the checkout Terms and Privacy Policy reader, including current booking policy details and links to /terms and /privacy. The agreement checkbox stays disabled until the policy loads and the guest scrolls to the end of the combined Terms and Conditions and Privacy Policy documents. Scrolling unlocks the checkbox without checking it; the guest must explicitly accept, and Create Account remains disabled until acceptance. A failed policy load can be retried without clearing the form. Both registration API paths require policyAccepted=true and the current LEGAL_POLICY_VERSION before creating an account or sending mail. SMTP and Supabase signup store legal_consent (terms_accepted, privacy_acknowledged, policy_version and server-generated accepted_at) in existing account user metadata. No new table or migration is required; existing accounts and the email-confirmation requirement remain unchanged.

SERVICE QUANTITIES: Guest booking services have quantity inputs and minus/plus controls, per-booking maxima and line totals. Quantities persist through draft, review, saving and payment summaries; totals multiply historical/catalog unit price by quantity. Legacy draft services default to one. Admin Business Catalog > Services exposes required max_quantity (1-10000), defaulting new forms to one. Apply docs/service-quantity-limits-migration.sql before deployment: it adds a column to existing services, preserves the old 10000 ceiling for existing catalog rows until configured, and installs a database trigger enforcing limits on reservation_services inserts/updates and RPC edits. Guest/staff creation and edits validate caps before writes; partial/invalid/duplicate service selections are rejected. Staff and guest editors/manual creation use the same maxima. Lowering a cap preserves booked quantities and receipts; above-cap historical quantities can be retained or reduced, never increased. Limits apply per booking, not shared stock. No new table is created. See docs/SERVICE_QUANTITIES.md.

RECEIPT PAYMENT DETAILS: Receipt email text, HTML and attached PDFs show payment method, payment reference and paid-at date/time in Asia/Manila. Use the provider's receipt_paid_at when available, otherwise the existing payments.paid_at; missing historical metadata is labeled Not recorded, never replaced with receipt issuance time. Beta receipt references use the original provider reference rather than the internal uniqueness reference. These details apply to newly delivered emails; previously delivered emails are unchanged.

Manage Booking details display an owner-authorized amount breakdown: package/guest charges, historical service quantities and prices, approved guest and committed staff reschedule fees, and higher-date-rate adjustments. Lines reconcile to the recorded transaction total without adding fees twice; reschedule fees are labeled non-refundable. The private no-store billing-breakdown endpoint returns billed amounts only, with no staff reasons or identities. Breakdown refreshes when the displayed booking total changes.


REFUND WORKFLOW (latest): New cancellation and excess-payment refund requests go directly to manager approval or rejection, without a cashier payment-review step. Managers (stored role staff) need refund_approval to decide; only cashiers with refund_payout record the approved manual transfer and upload its reference/proof. Only managers with refund_verify verify the provider transaction, with notes and explicit acknowledgement, before completion reduces net paid totals. Cashiers cannot approve/reject or verify; managers cannot record payouts; administrators remain view-only. Incompatible grants cannot bypass these role boundaries. Legacy reviewed requests remain directly approvable, and historical review notes, calculation snapshots and completed payouts are preserved. The payout submitter cannot self-verify, including legacy manager-submitted transfers. Apply docs/manager-cashier-refund-workflow-migration.sql after all older refund migrations and non-refundable-reschedule-fees-migration.sql before deploying these controls.

MOBILE NOTIFICATION POP-UPS: Guest and staff accounts share one compact banner on screens narrower than 640px or at most 500px tall. It appears below navigation with safe-area spacing, clamps long titles, shows the waiting count, and retains View details, close and Dismiss all controls. Full messages remain in the notification tray; only the visible popup starts its five-second dismissal timer. Desktop keeps the three-card stack. Resizing and dismissal preserve saved notifications and read status. No database migration is required. See docs/MOBILE_UI_AUDIT.md and scripts/check-notification-layout.mjs.

AUTHENTICATION SCREEN NOTIFICATIONS: `/auth/*`, `/staff/*` and `/admin/login` suppress the entire account notification feed, including subscriptions, polling and pop-up timers, even if another tab is signed in with shared browser cookies. Their notification context exposes no account or notifications. Navigation to these routes retires in-flight requests immediately; returning to an ordinary page verifies the current account and loads a fresh feed. Saved notifications and read status are preserved. No database migration is required.

RESERVATION NO SHOW: Only an active manager (stored role staff) with edit_reservation can mark a confirmed reservation No show after its scheduled END timestamp has strictly passed, including overnight stays. A recorded check-in/checkout, pending payment/reschedule review or open refund blocks marking. The manager supplies a 5–2,000-character reason and explicitly confirms non-arrival. The service-only RPC locks the reservation and atomically records status no_show, manager, server timestamp, reason, audit and registered-guest notification; retries return the original result without duplicate notices. No show is closed and cannot be reopened, edited, checked in/out, rescheduled, cancelled or receive new payments. Bills, invoices, payments, receipts and refund history are preserved; no cancellation refund or write-off is created automatically. The calendar has a separate status color, Records shows its timestamp/reason, and guest Manage Booking treats it as closed. Administrators and cashiers cannot mark no-shows. Apply docs/reservation-no-show-migration.sql after its listed prerequisites before deploying. See docs/NO_SHOW.md.


LEGAL POLICY VERSIONING: Apply docs/legal-policy-versioning-migration.sql before deploying. Business Catalog > Policies now edits Terms and Conditions and Privacy Policy with independent sequential versions, required revision reasons, publication confirmation, history and atomic audit. Published text cannot be changed or deleted. Current text powers /terms, /privacy and the shared read-before-agree registration/booking reader. Server checks reject stale version tokens and require review again without clearing the form. Existing reservation_policies stores the revisions (no new table); old general catalog rows remain. New guests and online reservations store immutable legal document IDs and a database acceptance timestamp. Existing bookings retain their accepted versions; legacy bookings show baseline documents with an explicit unknown-acceptance notice. No historical acceptance dates are fabricated or blanket sign-in reconsent imposed. Operational cancellation/refund settings remain separately versioned under Configuration > Reservation settings; legal prose does not change business-rule calculations. See docs/LEGAL_POLICY_VERSIONING.md.


AUDIT LOG READABILITY AND PERIODS: Audit defaults to Today and offers Today, This week (current Monday-Sunday), This month and Custom date range. Presets use Philippine calendar days and apply immediately; custom inclusive dates require Apply dates, with Reset to today. Server date filtering precedes the 300-entry cap; refresh reevaluates presets. Human-readable areas/actions and summaries show recorded before/after values, named catalog items/booking references, peso amounts, Philippine timestamps, role/access labels and distinct refund stages. Missing patch fields are not treated as deletions; missing history is not invented. Original actions, IDs and JSON remain in collapsed Technical details. Table details preview is searchable; CSV contains full readable summaries for the loaded rows matching the period/table filters. Timestamp sorting retains original ISO values. Existing permissions and legacy API date queries remain; no migration or saved-audit rewrite is required. See docs/AUDIT_LOG.md.

PUBLIC ACCESS COLLECTIONS (14 November 2026): New payment in Transactions now opens cashier-only public swimming/cottage/room/mixed usage entry with guest name, PH mobile, Payment for notes, amount and active method. Both transactions and payment_entry grants and current session are required in API/RPC. Cash needs acknowledgement; noncash needs real reference, owned proof (JPEG/PNG/WebP/PDF up to 8 MB) and manual received-funds acknowledgement. Private ledger rows retain Settle payment and existing balance/payment/email workflow. public_access_sales stores immutable guest/contact/method/amount/reference/paid-at receipt snapshots, with atomic audit and idempotent request IDs; no authenticated direct writes. Apply docs/public-access-sales-migration.sql before deployment (also appended to updated-schema.sql). Ledger and Issued Receipts filter All/Public/Private and public receipts open/print in existing receipt modal. Sales Report source selection filters metrics/charts/rows/CSV/print, shows separate public/private totals and uses PHT paid-at dates for public, verification/legacy dates for private. Dashboard/analytics collections include both sources. Public sales do not create reservations, inventory holds, guest receipts by email, or booking refunds; sales totals are gross before refunds. See docs/PUBLIC_ACCESS_SALES.md.
