<!-- page: cover | Overview -->
# MarVille Resort Complex

## User manual

Guest · Cashier · Manager · Administrator

**Edition:** 11 November 2026

A practical guide to accounts, reservations, payments, resort operations and administration.

Use the website address supplied by the resort. Prices, availability, deadlines and the policy shown on your booking take precedence over illustrative examples in this guide.

All schedules, calendar dates, reports and document times use **Philippine time**. Amounts are in **Philippine pesos**.

This manual describes the current application workflows. A manager or cashier sees only the modules and actions granted to the account. Contact the administrator when an expected action is unavailable.

<!-- page: contents | Overview -->
# Find your account guide

CONTENTS_TABLE

## Account responsibilities

| Account | Main responsibilities |
| --- | --- |
| Guest | Register, book, submit GCash evidence, manage own bookings and submit feedback. |
| Cashier | Handle permitted payment tasks, record cash and transfer manager-approved refunds. |
| Manager | Handle permitted resort operations; approve or reject refunds and verify cashier transfers. |
| Administrator | Manage accounts, permissions, catalog and configuration; inspect operational records. |

**Refund sequence:** Manager decision → Cashier transfer → Manager verification → Refund completed.

Approval authorizes payment; verification confirms that the transfer actually occurred. Uploading a transfer screenshot alone does not complete a refund.

## How to use this manual

Follow the numbered steps under your role. Bold text identifies screen labels or required confirmations. Menu availability depends on permissions. Read the success or error message and refresh the record before retrying an uncertain financial action.

<!-- page: guest-account | Guest account -->
# Guest account
## 1. Register, confirm and sign in

1. Open the resort website and choose **Create Account** or open `/auth/register`.
2. Enter your name, email address, Philippine mobile number, address and password. Follow the displayed password requirements and confirm the password.
3. For a mobile number, use the fixed **+63** prefix and enter the ten national digits starting with **9**. The form also normalizes supported pasted Philippine formats.
4. Review the information and select **Create Account**. Correct any highlighted fields.
5. Open the confirmation email and follow its link. After confirmation, sign in through `/auth/login` using your email and password.

**Expected result:** Your email is confirmed and you can access your own bookings and profile. Confirming the email does not replace signing in.

## 2. Recover access and update your profile

1. If you forgot your password, choose the password-recovery link on the guest sign-in page and follow the email instructions.
2. If confirmation mail is missing, check Spam/Junk and use **Resend confirmation email** when available. Follow the displayed waiting period before requesting another message.
3. After signing in, open your user menu and profile. Edit the available personal details, then save and check the result.

If the email is already registered, sign in or reset the password. Do not repeatedly create another account with the same address. A deactivated account requires help from the resort administrator.

Use your own account. Sign out on shared devices and keep passwords and email verification links private.

<!-- page: guest-booking | Guest account -->
# Guest account
## 3. Create a stay reservation

1. Choose **Book Now** and select a stay booking.
2. Select **Day**, **Night** or **Whole Day**, including the exact whole-day variant when offered.
3. Choose an enabled date. The calendar checks the selected package, its start time, existing bookings and maintenance. Changing the package may clear an incompatible date.
4. Sign in when prompted. Enter or confirm the required contact details, adult and child counts, accommodation and optional services.
5. Review service descriptions, quantities and prices. Select a service image to inspect it without changing the service selection.
6. Read the booking summary, package times, total, payment options and current policies. Accept the required policy agreement.
7. Save the booking and wait for the reservation reference before proceeding to payment.

**Expected result:** The system saves a reservation and displays its reference, bill and payment instructions. An unsaved review is not a confirmed reservation.

## Booking reminders

- A new online stay must begin at least **30 minutes in the future**. A package that has already started is unavailable.
- At least one adult is required. The current booking limit is **30 guests**; follow any additional package restrictions shown.
- A new unpaid hold has a displayed payment deadline. Submit valid evidence before that deadline; an expired hold no longer reserves the schedule.
- Availability can change while the page is open. If saving fails because the schedule was taken, refresh and select an available option.

Retain the booking reference. Use **Manage Booking** to check the saved record rather than creating a second reservation after an uncertain response.

<!-- page: guest-payment | Guest account -->
# Guest account
## 4. Pay through GCash

1. Open the booking's payment page or use its available payment action in **Manage Booking**.
2. Choose the required **20% down payment** or the full outstanding balance, as offered. Review the amount before transferring money.
3. Use the receiving GCash details or QR code displayed in the website. Complete the transfer in GCash.
4. Enter the required payment information and transaction reference. Upload a readable supported receipt image within the displayed size limit.
5. Read and accept the required agreement, then submit once and wait for the result.
6. Check **Manage Booking**, notifications and email for the resulting payment and reservation status.

The application can screen receipt images and automatically approve eligible consistent submissions when that mode is enabled. Other accepted submissions may await staff verification. A validation error requires correction; do not assume that a failed submission was credited.

**Important:** Sending money, uploading evidence and verifying a payment are different events. Follow the recorded status. A confirmed reservation may still have an unpaid balance.

## 5. Pay a remaining balance

1. Open **Manage Booking**, find the reservation and open its details.
2. Review the current amount breakdown and remaining balance, including approved service or schedule changes.
3. Use the available payment action and follow the GCash instructions again.
4. Retain the receipt and check that the payment is credited after verification.

Online guest submissions use GCash. Cash received at the resort is recorded by authorized personnel. If the receiving account shows a transfer but the website result is uncertain, contact the resort with the booking and transaction references before sending money again.

<!-- page: guest-manage | Guest account -->
# Guest account
## 6. Manage, reschedule or cancel a booking

1. Open **Manage Booking** and select the reservation. Use its details or action menu to inspect the schedule, services, payments and amount breakdown.
2. Use the available edit action to change eligible guest counts or services. Review the new bill before saving. Existing service reductions are restricted after full payment; check-in locks further changes described on screen.
3. To reschedule an eligible confirmed booking before check-in, select an available future date and enter a reason. The package, start time and duration remain fixed.
4. Review the rescheduling fee and any higher-date-rate adjustment. Confirm only after the availability check and charge preview are ready. Eligible new guest reschedules apply immediately.
5. To cancel, inspect the server-calculated refund preview, enter the reason, acknowledge the deduction and confirm. Consider the offered reschedule option if you prefer another date.

Checked-in stays cannot be cancelled or rescheduled. Pending payment reviews or open refund workflows can block changes. Guest cancellation also follows the notice period attached to the booking.

## 7. Track a refund

Eligible cancellation refunds are created automatically. For verified payments above the current bill, open **Refunds** and select **Request excess refund** once. The system calculates the amount; you do not enter a replacement amount.

Guest cancellation retains the initial 20% deposit and non-refundable rescheduling fees. Resort-attributable cancellation refunds the deposit but still retains rescheduling fees. Previous completed refunds are deducted. No remaining eligible amount means no refund request.

Follow the stages: **Awaiting manager approval**, **Approved - awaiting cashier transfer**, **Transfer submitted - awaiting manager verification**, then **Refund completed**. Rejection includes a reason. Money is transferred manually, and the booking's cancelled status remains separate from its refund status.

<!-- page: guest-visits-feedback | Guest account -->
# Guest account
## 8. Schedule an ocular visit

1. Open **Book Now** and select **Ocular Visit**. Use the booking flow if a separate ocular link redirects there.
2. Choose an available date and active time slot, then sign in if requested.
3. Review the visit details and submit once.
4. Open **Manage Booking → Ocular visits** and check the saved result.
5. Use the visit's available actions to view, reschedule or cancel. Confirm the updated schedule after saving.

Available visits confirm automatically after capacity and maintenance checks. They do not require a staff approval decision. If a slot becomes unavailable, select another offered slot. Follow the displayed lead-time rule.

## 9. Submit a review

1. Sign in to your active guest account and open **Reviews**.
2. Choose **Write a Review**, enter the rating, title and review text, and complete the required fields.
3. Add an optional photo in an accepted format within the displayed limit. You may link one of your own reservations when offered.
4. Submit and check the saved result. A completed stay is not required to submit feedback.

Allow **10 minutes** between reviews. The limit is **three reviews per rolling 24 hours**. Repeated review text within 24 hours is blocked, and a reservation can have only one linked review.

## 10. Notifications and assistance

Use the notification bell's **All / Read / Unread** filters. Following a notification marks that item read; **Mark all read** is a separate action. Opening the tray alone does not mark everything read.

Use the chatbot's approved questions or request human support through the displayed resort contact link. Provide a booking reference when relevant. Share passwords and verification codes with nobody, including support contacts.

<!-- page: cashier-start | Cashier account -->
# Cashier account
## 1. Sign in and prepare your shift

1. Open `/staff/login` or `/admin/login` using the resort's website address.
2. Enter your assigned staff email and password. Complete email-code verification or the temporary-password change when prompted.
3. Open the modules granted to your account. Ask the administrator if a required module or action is missing.
4. Check **Transactions** for pending payment evidence, balances and manager-approved refunds awaiting transfer.
5. Check the receiving payment account and any approved shift records before recording collections or payouts.

One active session is used per account. Signing in on another device can end the earlier session. Use an individual account and sign out at the end of the shift.

## 2. Find a bill or payment

1. Open **Transactions → Transaction Ledger**.
2. Search by guest name or reservation reference and apply the available filters.
3. Open the record details to inspect the bill, verified payments, completed refunds and outstanding balance.
4. Use page controls to move through the records. A filter or search change returns to the first page.
5. Check **Generated Invoices**, **Issued Receipts** or **Refund Requests** for the corresponding document or workflow.

Use the named guest linked to the reservation. The payment sender's account name may differ from the booked guest and should not replace it.

**Cashier boundaries:** A cashier with the appropriate permissions can verify guest payments, record received cash and document an approved refund payout. Cashiers cannot approve or reject refund requests and cannot verify refund transfers. No preliminary cashier review is required for refunds.

<!-- page: cashier-payments | Cashier account -->
# Cashier account
## 3. Review a pending guest payment

1. Open **Transactions → Payment Verification Queue**, or a reservation's payment-review action when granted access.
2. Select the pending payment and inspect its receipt image, amount, reference, receiving account and reservation.
3. Compare the evidence with the actual transaction in the resort's receiving account. A screenshot alone does not establish receipt of funds.
4. Complete the required acknowledgement and approve only the verified transfer. If rejecting, enter the required meaningful reason.
5. Check the saved payment status, reservation status, balance and issued receipt. An already processed payment cannot be approved again.

If an initial payment is rejected, read the resulting reservation status. Rejecting a later balance payment does not itself cancel an otherwise confirmed reservation.

## 4. Record cash received at the resort

1. In **Transaction Ledger**, choose **Record cash** or **Settle in cash** for the correct reservation.
2. Check the balance. Use the full balance or enter an allowed partial amount.
3. Count the money received and give any change separately. Record only the amount applied to the bill; cash credit cannot exceed the outstanding bill.
4. Tick the received-cash acknowledgement and choose **Record payment and issue receipt**.
5. Check the saved amount, updated balance and receipt number. Read any separate email-delivery result.

Recording cash credits a verified payment because you confirm receiving it physically. It does not electronically collect money. Cancelled/completed reservations and unresolved review or refund conditions can block entry.

If a save times out, retain the generated reference, refresh the records and retry in the same dialog when appropriate. Do not collect the cash again or create a new payment reference merely because email delivery failed.

<!-- page: cashier-refunds | Cashier account -->
# Cashier account
## 5. Transfer a manager-approved refund

1. Open **Transactions → Refund Requests** and select the request.
2. Confirm its status is **Approved - awaiting cashier transfer**. Requests awaiting manager approval cannot be paid through this workflow.
3. Check the approved fixed amount, booking reference and intended recipient details against the authorized records.
4. Transfer that amount manually through GCash or another active approved payment method shown in the form.
5. Select the actual payout method, enter the real transaction reference and upload its evidence. Accepted evidence is JPEG, PNG, WebP or PDF, up to **8 MB**.
6. Select **Submit transfer for verification** once. Check for **Transfer submitted - awaiting manager verification**.

**Stop after submission.** The manager verifies the transfer. Cashiers cannot complete the refund, and uploading evidence does not reduce the recorded net paid amount. Do not send a second transfer because the request still awaits verification.

If the transfer result is uncertain, inspect the provider records and contact the manager before retrying. Transfer references cannot be reused for different payouts.

## 6. View billing documents and close the shift

1. Open **Issued Receipts** or **Generated Invoices** and find the reservation or guest.
2. Open the document and use its available print action. Allow the website's print window if the browser blocks it.
3. Use the browser's **Save as PDF** option when an electronic copy is needed. Guests may also receive billing PDFs by email when delivery is enabled.
4. Before signing out, reconcile received payments and recorded payouts with the ledger. Report unresolved items to the manager.

An invoice shows the bill; a receipt records a payment. Historical receipt amounts remain unchanged after later edits or refunds. Financial processing and document email delivery have separate outcomes.

<!-- page: manager-calendar | Manager account -->
# Manager account
## 1. Open the operational portal

1. Sign in at the staff login page using your assigned account and complete any verification prompt.
2. Open **Dashboard** to review arrivals, verified collections and unresolved tasks. Its displayed financial totals have their own date and refund basis.
3. Open **Reservations** to inspect the calendar and actual reservation details.
4. Use the granted operational modules. Account management, general configuration and catalog management remain administrator functions.

Manager access is configurable. Viewing a module does not automatically authorize editing, cancellation, payment approval or refund processing.

## 2. Find a reservation and record arrival

1. In **Reservations**, choose the required calendar period and use guest/reference search or the available status filters.
2. Open the booking. Read the guest, package, schedule, attendance, services, balance and attention labels.
3. For an eligible confirmed arrival today, confirm the guest is physically present and use the check-in action.
4. Read the success result and recorded arrival time. Check-in does not settle the balance or change the booking's payment history.

Calendar maintenance closures are distinct from full booking schedules. Attention labels identify unresolved tasks without replacing the booking's reservation status.

## 3. Complete a stay

1. Open a reservation with an actual recorded check-in.
2. Confirm additional services are recorded and the current bill is fully settled using verified payments less completed refunds.
3. Acknowledge that the guest is departing, then select **Check out and complete stay**.
4. Verify the departure record and **Completed** status. Scheduled departure time alone does not complete a stay.

## Record a no-show

After the scheduled end time, open an unchecked-in confirmed reservation. Enter the **No-show reason**, confirm non-arrival and select **Mark as No show**. Only managers with reservation-edit permission can do this. Resolve pending payment, reschedule or refund reviews first. The booking closes with its history retained; no cancellation refund is created automatically.

<!-- page: manager-reservations | Manager account -->
# Manager account
## 4. Enter an offline reservation

1. With the required permissions, choose **New reservation** in the calendar or open manual booking.
2. Use this flow for a guest without a registered account booking by phone, Messenger or walk-in. Existing registered guests must book through their own accounts.
3. Enter the guest's name, validated Philippine mobile number and other required details. Offline email is optional; a supplied email must be valid.
4. Select the package, future schedule, guest counts, accommodation and services. A package that has already started cannot be used.
5. Review the computed bill and save. Confirm the new booking reference and calendar entry.

Saving a manual reservation does not itself establish that money was received or that the guest arrived. Record payments and check-in through their separate actions.

## 5. Edit a reservation or handle a schedule change

1. Open the calendar record and choose the available edit action.
2. Check the permitted fields, make the change and enter the required reason.
3. Review the before/after charge preview, then save and inspect the updated record.

Authorized staff can change guest counts during an active checked-in stay before checkout, subject to the current rules. Check-in locks the schedule, package, accommodation and existing service reductions. Closed records and unresolved reviews can block editing. Historical payments and issued receipts are preserved.

New eligible guest reschedules apply automatically. Use **Records → Reschedule Requests** for remaining legacy requests. Before approving one, inspect availability, the proposed date and the displayed fee/rate adjustment; reject with a reason when appropriate.

For a permitted staff schedule change, review all notice fees and date-rate adjustments before saving. Do not move a checked-in stay. If another user changed the record, reload it and review the current bill before trying again.

<!-- page: manager-refunds | Manager account -->
# Manager account
## 6. Cancel a booking and inspect eligibility

1. Open an eligible reservation and select its cancellation action.
2. Identify whether the cancellation is **Guest request** or an authorized **Resort-attributable reason**.
3. Enter the documented reason and review the server-calculated verified payments, previous refunds, deposit and rescheduling-fee deductions.
4. Acknowledge the preview and confirm. A positive eligible amount creates a request directly for manager approval; otherwise the result is **Cancelled - No Refund**.

Guest cancellations retain the initial 20% deposit and non-refundable rescheduling fees. Resort-attributable cancellations refund the deposit while retaining those fees. Resolve pending payments first. Checked-in stays cannot be cancelled.

## 7. Approve or reject a refund

1. Open **Transactions → Refund Requests** and select an **Awaiting manager approval** request.
2. Inspect the verified payment records, prior refunds, calculation snapshot and fixed amount. No cashier review is required first.
3. Select **Approve refund**, or enter a meaningful reason and choose **Reject with reason**.
4. For an unprocessed legacy cancellation, use the displayed classification/recalculation action first when required. Earlier reviewed requests can otherwise be decided directly.

## 8. Verify the cashier's transfer

1. Open the **Transfer submitted - awaiting manager verification** request and its evidence.
2. Match the actual provider transaction, amount, recipient and reference with the approved refund.
3. Enter verification notes and tick the explicit verification acknowledgement.
4. Select **Verify transfer and complete refund**. Only this step completes the refund and reduces net paid totals.

Managers cannot record refund payouts. Do not verify a payout you submitted under an earlier workflow. A rejection or email failure must never be treated as authorization to send another transfer.

<!-- page: manager-visits-maintenance | Manager account -->
# Manager account
## 9. Manage ocular attendance

1. Open **Records → Ocular Visit Records** or the visit on the calendar.
2. Find the guest and inspect the saved date, slot and status.
3. Available ocular visits confirm automatically. Do not look for a new approval/rejection step.
4. After the scheduled start, record a confirmed guest as visited through the available attendance action.
5. To cancel an eligible visit as a manager, enter the required reason and confirm. Check the resulting status and notification result.

A visit is an inspection of the resort, not a paid stay. Attendance recording and cancellation have their own permissions and audit records.

## 10. Create or release timed maintenance

1. With reservation-edit permission, open **Reservations** and choose **Add maintenance block**.
2. Enter the name and reason, and select exact Philippine start/end dates and times or an inclusive whole-day period.
3. Review the period and save. The closure cannot displace an active reservation or ocular visit; resolve conflicting records through their proper workflows first.
4. Confirm the new block appears on the calendar. Guests see a generic maintenance closure rather than private staff notes.
5. When the period should reopen, open the block, select its release action and check the result.

If saving fails, retain the entered details, read the conflict message and correct the period. A calendar closure does not itself cancel an existing booking or issue a refund.

## Daily handover

Before leaving, review unprocessed payments, unpaid arrivals, refund decisions and submitted transfers awaiting verification. Record unresolved concerns with their booking references and pass them to the next authorized operator. Sign out when finished.

<!-- page: manager-reports | Manager account -->
# Manager account
## 11. Use reports and analytics

1. Open **Reports** when your account has access.
2. Select **Sales Report**, **Guest Report** or **Staff Report** and choose the offered period or custom date range.
3. Refresh and inspect the displayed dates, totals, charts and record details.
4. Use the available CSV or print/PDF action. Exports use the matching dataset rather than only the visible table page.

Sales collections represent **verified gross payments** by verification date; older payments may use their creation date. They are before refunds and can differ from the ledger's net paid figures. Report totals should be compared using the same date range and measurement basis.

In **Analytics**, review the selected period, booking activity, collections and operational indicators. Treat projections as estimates rather than guaranteed future income. Use the available refresh and export controls.

## 12. Read and manage guest feedback

1. Open **Analytics → Guest feedback**.
2. Search the list and use the date range and active/archived filters. Open photos and details where offered.
3. If granted the separate feedback-archive permission, choose the archive or restore action, enter a reason and confirm.
4. Check the saved result. Archived feedback is retained for records but hidden from public review displays.
5. Use the optional analysis action when granted access and the service is available. Refresh the analysis after the underlying feedback changes.

The feedback list remains useful even if AI analysis is unavailable. Archiving does not authorize changing a guest's rating or review text.

## 13. Inspect records and activity

Use **Records** for reservation history and attendance, and **Audit Log** when permitted to trace actions. Search by the available guest, booking, actor or date filters. Review the stored details before approving a financial or scheduling correction.

<!-- page: admin-accounts | Administrator account -->
# Administrator account
## 1. Sign in and manage users

1. Sign in through the staff portal using your administrator account. Complete the verification or password-change prompt when shown.
2. Open **Users** and select the staff account list.
3. Use the create action to enter the required name, email and role. Follow the form's initial-password or account-setup process.
4. Use an account's available edit action to update its permitted details or role. Use the reset-password action when an operator needs a reset.
5. Set staff access to **Active** or **Deactivated** as appropriate, then inspect the saved result. Do not remove records merely to revoke access.

Use individual accounts. Protect your own administrator access and retain the authorized recovery process. Existing records and audit history identify who performed each operation.

## 2. Configure manager and cashier permissions

1. Open **Users → Role Permission Matrix**.
2. Grant only the modules and actions required for each role.
3. Give a manager the applicable **Approve or reject refunds** and **Verify refund payout** permissions; give a cashier **Record refund payout** when required.
4. Select **Save permissions** once to save both role columns and check the success message.

Refund approval and verification are manager-only; payout recording is cashier-only. The matrix prevents incompatible assignments. There is no initial cashier-refund-review permission. Administrators have fixed management and viewing access rather than operational refund powers.

## 3. Manage guest access

Open **Users → Guest Accounts**, search for a registered guest, and inspect the account and reservation history. Deactivate or reactivate access through the offered action and enter the required reason. Deactivation blocks account use but does not cancel reservations or refund payments. Reactivation requires a new guest sign-in.

<!-- page: admin-catalog | Administrator account -->
# Administrator account
## 4. Maintain the business catalog

1. Open **Business Catalog** and select the relevant category, such as services, units, package rates, payment accounts or ocular slots.
2. Create a new item or open an existing one. Complete the required fields, price and active status, then save.
3. For a service photo, use a supported PNG, JPEG or WebP file up to **5 MB**, and save the service to publish the change. Removing the photo also requires saving.
4. Archive an item when it should no longer be offered. Use its restore action when appropriate; inspect any parent-item requirement.
5. Check the public display or booking form after publishing changes.

## 5. Change package rates and time slots

1. Open **Business Catalog → Package rates**.
2. Review weekday/weekend package values, included-guest pricing and additional-guest charges.
3. Update the allowed package start and end times. Check overnight and whole-day end dates carefully.
4. Select **Save package rates** to publish the changes for new bookings.
5. Use **Restore defaults** only when intended; review the form before saving.

Existing reservations retain their booked rates and exact saved times. A new rate does not silently rewrite historical receipts or prior reservation charges.

## 6. Maintain receiving accounts and visit slots

Use the catalog's payment-account and QR controls to publish correct receiving details. Check the displayed QR image and account information together. Guest online payment remains GCash; cash is a staff collection method.

Ocular slots must start and end within **8:00 AM–5:00 PM Philippine time**, with the end later than the start. Review capacity and active status before saving. Slot changes do not replace attendance management.

<!-- page: admin-configuration | Administrator account -->
# Administrator account
## 7. Publish website information

1. Open **Configuration** and select the website-content or resort-information editor.
2. Update the permitted text, contacts, images and section settings.
3. Inspect previews where offered and save the intended changes.
4. Reload the public page and check the published result.

Use **Restore defaults** only after reading its confirmation. Uploaded price graphics must be updated separately from structured package prices; editing one does not rewrite the other.

## 8. Maintain booking policies

1. Open the reservation settings and cancellation/refund policy editor.
2. Inspect the current policy version, notice hours and policy wording.
3. Make the permitted changes, then select **Publish new version**.
4. Check the new version and retain the previous-version history.

Eligible cancellation refunds are created automatically according to the enforced calculation. Refund decisions go to managers, payouts to cashiers and transfer verification to managers. Publishing policy text does not grant administrators operational refund powers or rewrite completed financial history.

## 9. Maintain chatbot and billing settings

Under **Configuration → Chatbot**, maintain approved FAQ question/answer pairs and the optional Facebook Messenger support URL. Save and test a matching guest question and the human-support link. The editor supports up to **40 approved FAQ pairs**.

Use the relevant receipt/billing settings to control available branding and document email preferences. Review a sample invoice or receipt after changing branding. An email-delivery setting does not create a payment or complete a refund.

General settings can have different effects. Use the dedicated package-rate, policy and content editors for the corresponding workflows, and check the actual saved screen result.

<!-- page: admin-oversight | Administrator account -->
# Administrator account
## 10. Inspect operations and exports

Administrators can inspect operational records, use search, filters, sorting, pagination and refresh, and open available record details. Operational access is generally read-only: administrators do not create guest bookings, approve payments, record cash or process refunds through those modules.

1. Open **Reservations**, **Records** or **Transactions** and find the required record.
2. Review its schedule, recorded attendance, financial details and history.
3. Refer operational corrections to an authorized manager or cashier. A visible record is not permission to change it.
4. Open **Reports** or **Analytics** to inspect results and use their permitted CSV or print/PDF exports.
5. Open **Audit Log** to inspect recorded actions, apply filters and export the available CSV.

Administrators cannot start operational feedback analysis or archive/restore guest feedback through the read-only analytics view.

## 11. Maintain closures under the administrator exception

Timed maintenance is an explicit exception to general read-only operational access. In **Reservations**, use the maintenance-block action to enter an exact Philippine period or inclusive whole days, document the reason, save and confirm the calendar result. Release a block through its offered action when the closure ends.

A closure cannot displace an existing active reservation or ocular visit. Coordinate the required cancellation with an authorized manager before trying again. Guests see generic maintenance availability, while staff-only details remain private.

## 12. Support staff and review account use

When an operator reports a missing action, check the role and its saved permissions first. Review account status, relevant records and audit entries before escalating a technical issue. Give the support contact the affected module, reference and exact error; keep passwords, verification codes and secret configuration values out of messages.

<!-- page: status-reference | Shared reference -->
# Status reference
## Reservation and attendance

| Status or record | Meaning |
| --- | --- |
| Pending / awaiting payment | A saved unpaid hold; follow the payment deadline. |
| Payment submitted | Accepted evidence awaits verification; it is not yet verified money. |
| Confirmed | A payment was verified; a remaining balance may still exist. |
| Check-in recorded | Staff recorded actual arrival; the bill can still require settlement. |
| Reschedule requested | A remaining legacy request awaits a decision; inspect the recorded schedule. |
| Completed | Staff recorded departure after check-in and required settlement. |
| Cancelled | The booking is closed; an eligible refund progresses separately. |
| No Show | A manager recorded non-arrival after the scheduled end. Booking changes and new payments are closed. |
| Expired / rejected | The hold or initial payment failed its conditions; inspect the recorded result. |

## Refund stages

| Stage | Responsible account and next step |
| --- | --- |
| Awaiting manager approval | Manager checks the calculated request and approves or rejects. |
| Approved - awaiting cashier transfer | Cashier transfers the fixed approved amount and records evidence. |
| Transfer submitted - awaiting manager verification | Manager checks the actual transfer and confirms verification. |
| Refund completed | Verified payout is recorded and net paid totals are updated. |
| Refund rejected | No payout is authorized by that request; read the documented reason. |

**Billing distinction:** An invoice shows charges; a receipt records a payment; a completed refund reduces net paid amounts. Sales reports can show gross collections before refunds. Compare like-for-like figures and dates.

<!-- page: help | Shared reference -->
# Troubleshooting and support

| Problem | Action |
| --- | --- |
| Confirmation email is missing | Check Spam/Junk, verify the address and use the offered resend action after its waiting period. |
| Cannot access a staff action | Check the account role, module access and specific permission with the administrator. |
| A date becomes unavailable | Refresh availability and choose an offered date/package. Do not repeatedly submit the same conflict. |
| Payment transfer exists but the website result is uncertain | Check the saved payment and provider records; contact the resort before paying again. |
| Cash save or document email fails | Refresh the bill and retain the same payment reference. Confirm whether cash recording succeeded separately from email delivery. |
| Refund remains awaiting verification | The manager must check the recorded transfer; the cashier must not resend it simply to change its status. |
| Refund or booking action is blocked | Resolve the indicated payment, refund, attendance, availability or status condition with the authorized operator. |
| Print window is blocked | Permit the website's print window and retry the document's print action. |
| Internet access is interrupted | Avoid duplicate financial submissions. Reconcile temporary notes and provider transactions once access returns. |

## Report an issue clearly

Record the account role, module, booking or payment reference, action taken, exact error and approximate Philippine time. Add an appropriate screenshot if it helps, with private information concealed. Contact the resort's designated administrator or technical support through the approved channel.

Sign out on shared devices. Keep passwords, verification codes and personal recovery links private. This manual contains no live account credentials; staff accounts are issued by the resort administrator.
