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
- Rescheduling requires at least 14 Philippine calendar days' notice before the original swimming date in peak months (March-May summer and September-December Ber months), or at least 7 days in other months. Guest Manage Booking enforces this deadline. Shorter notice requires an authorized, documented staff exception for a confirmed reservation, including a still-confirmed past-date reservation. Completed/cancelled reservations cannot be reopened. The booked package, start time and duration stay fixed, and the new date must be available.
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
