PRICING ADMINISTRATION

The swimming package prices below are initial reference values. Current online weekday/weekend package prices and additional-guest charges are managed in Admin > Catalog > Package rates. Package times remain fixed. Existing reservations retain their booked rate schedule. See docs/PACKAGE_RATES.md and docs/package-rates-migration.sql.

LOCATION & CONTACT INFO

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

- Guest-initiated cancellation retains the initial 20% deposit; other remaining verified payments may be refunded after prior refunds. Resort-attributable cancellation refunds all remaining verified payments, including the deposit. Eligible requests are automatic, but review, administrator approval, manual payout and staff verification are required.
- Standard reschedule notice is 14 Philippine calendar days before the original swimming date in peak months (March-May summer and September-December Ber months), or 7 days in other months. Guests with confirmed reservations may submit requests through Manage Booking even with shorter notice, on the original date or after it, provided they have not checked in. Every request remains pending until staff with reschedule approval permission approves or rejects it; approval documents the short-notice exception and applies its quoted charges. The original schedule and bill stay unchanged while pending. Completed/cancelled or checked-in reservations cannot be rescheduled. The booked package, start time and duration stay fixed, and the new date must be available. Apply docs/guest-reschedule-requests-migration.sql after reschedule-policy and stay-completion migrations.
- Change-of-schedule fees use Philippine calendar days before the original date: PHP 50 for 6 or more days, PHP 100 for 3-5 days, PHP 300 for 1-2 days, and PHP 500 on or after the original date. On-time changes still carry PHP 50. Add any higher-date-rate difference using the booked package rates; a cheaper date does not automatically reduce billing. Show the fee before saving, preserve existing payments and charges, and audit the change. Service-only edits have no reschedule fee.

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
- Calendar filters identify submitted payments, pending reschedules, open refunds, unpaid balances and confirmed arrivals today without recorded check-in. Dates and arrival flags use Philippine time. Cancelled reservations can still need refund processing.
- Authorized staff with Edit reservations permission record actual arrival for a confirmed reservation arriving today, after acknowledging that the guest is present. Check-in records server time, staff identity and an audit entry; it does not settle the bill or change reservation status.
- Manual entry is only for guests without an account who book through phone, Messenger or walk-in. Existing guest accounts must book through their own account. The server rejects existing-account payloads and registered email addresses supplied as walk-in guests.
- Guest cancellation first offers rescheduling instead, retaining all notice, availability, fixed-package and approval rules. Availability loading allows choosing a candidate date but cannot enable submission until the date is checked.


PAYMENT REVIEW AND REPORT ACCESS

- A manager or other active staff member with payment_approval permission can inspect and approve or reject submitted payments directly in a selected calendar reservation. Reservations access is sufficient for this entry point; Transactions remains available to roles with that module permission.
- Rejection requires a meaningful 5-to-2,000-character reason. The server and database enforce it, preserve the reviewer and audit details, and include the reason in the guest notification. Staff cannot change an already recorded rejection reason. Verified receipts and net balances continue to account for completed refunds.
- Guest Report is in the Reports module alongside Sales Report and Staff Report, and requires Reports permission. Financial Report remains removed. Printed charts use SVG graphics and divide long line/bar series into readable sections.
- Guest booking calendar maintenance closures use a distinct purple colour and Closed for maintenance label, rather than Fully booked. Refund verification notifications and email subjects say Refund completed.


### Arrival, departure and guest reviews

- Authorized staff records check-in for confirmed arrivals. Checked-in reservations cannot be cancelled or rescheduled by guests or staff; billing and additional services remain manageable during the stay.
- Checkout requires actual check-in and full settlement using verified payments less completed refunds. Staff confirms departure; the system records checkout and marks the reservation completed. Scheduled end time alone does not complete a stay.
- A guest must have a completed stay before submitting a review. Optional linked reservations must be that guest's completed stays. Existing repeat-review rate limits remain in force.
- Calendar ocular approval/rejection requires the ocular-approval permission and a documented reason. Decisions are audited and notify the guest.
- Business Catalog exposes swimming prices in Package rates and accommodation prices in Units; legacy Unit rates and Guest rates tabs are hidden. The permission matrix saves both editable roles with one Save permissions action.
- Apply docs/stay-completion-migration.sql and docs/ocular-review-migration.sql after the prerequisites in each file before deploying these workflows.
