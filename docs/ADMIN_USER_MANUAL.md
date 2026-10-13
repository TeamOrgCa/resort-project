# MarVille Resort Complex — Admin and Staff User Manual

**Audience:** Administrators, managers and cashiers using the staff portal.  
**Updated:** 13 October 2026.  
**Companion guide:** [Client User Manual](CLIENT_USER_MANUAL.md).  
**Manual overview and printing:** [User Manuals](USER_MANUAL.md).

This guide explains daily booking, billing and management tasks. Use the resort website address supplied by the owner; add the page paths below to that address. Buttons and modules depend on your account's permissions. Follow success/error messages before considering an action complete.

## Contents

- [1. Access the staff portal](#1-access-the-staff-portal)
- [2. Understand roles and navigation](#2-understand-roles-and-navigation)
- [3. Daily operating checklist](#3-daily-operating-checklist)
- [4. Find a reservation in the calendar](#4-find-a-reservation-in-the-calendar)
- [5. Enter a phone, Messenger or walk-in reservation](#5-enter-a-phone-messenger-or-walk-in-reservation)
- [6. Edit reservation details and add services](#6-edit-reservation-details-and-add-services)
- [7. Review a reschedule request](#7-review-a-reschedule-request)
- [8. Approve an ocular visit](#8-approve-an-ocular-visit)
- [9. Create or release a maintenance block](#9-create-or-release-a-maintenance-block)
- [10. Use the transaction ledger](#10-use-the-transaction-ledger)
- [11. Verify a guest GCash payment](#11-verify-a-guest-gcash-payment)
- [12. Record a cash payment](#12-record-a-cash-payment)
- [13. Review and pay a refund](#13-review-and-pay-a-refund)
- [14. View invoices and print receipts](#14-view-invoices-and-print-receipts)
- [15. Run sales, staff and guest reports](#15-run-sales-staff-and-guest-reports)
- [16. Understand analytics](#16-understand-analytics)
- [17. Manage catalog items and payment QR codes](#17-manage-catalog-items-and-payment-qr-codes)
- [18. Change weekday and weekend package rates](#18-change-weekday-and-weekend-package-rates)
- [19. Change website content and booking policies](#19-change-website-content-and-booking-policies)
- [20. Manage staff accounts and permissions](#20-manage-staff-accounts-and-permissions)
- [21. Inspect the audit log](#21-inspect-the-audit-log)
- [22. Troubleshooting and current screen limitations](#22-troubleshooting-and-current-screen-limitations)

## 1. Access the staff portal

1. Open `/staff/login` or `/admin/login`.
2. Enter your **Staff Email** and password.
3. Select **Sign In to Staff Portal**.
4. If prompted, open your staff email, enter the **Verification Code** and select **Verify Code**.
5. If prompted to change a temporary password, enter and confirm a personal password and submit. The staff password form requires at least eight characters.
6. Open the required module from the sidebar.

**Expected result:** You enter the portal with the modules allowed for your role. Use **Forgot your password?** for email recovery, or ask an administrator to reset your password if you cannot recover access.

One session is active per account. Signing in on another device ends the previous session. Use individual staff accounts so actions are attributed to the correct person, and sign out at the end of your shift.

## 2. Understand roles and navigation

| Role | Access |
| --- | --- |
| Admin | Full portal access, including Users, Configuration and Business Catalog |
| Manager | Operational modules and actions granted in the Role Permission Matrix |
| Cashier | Transaction modules and actions granted in the Role Permission Matrix |

Managers are displayed as Manager in the permission editor; some older role controls may show **Staff** for the same role. Manager and cashier access can be customized. Opening a module does not automatically grant permission to approve payments, edit reservations or pay refunds.

| Sidebar module | Main use | Path |
| --- | --- | --- |
| Dashboard | Landing page and reservation listing; see current limitations before using its summary cards | `/admin` |
| Reservations | Calendar, manual reservations, reservation editor and maintenance blocks | `/admin/reservations` |
| Records | Reservation records, reschedule requests and ocular approvals | `/admin/records` |
| Transactions | Ledger, payment verification, refunds, invoices, receipts and guest reports | `/admin/transactions` |
| Reports | Sales Report and Staff Report | `/admin/reports` |
| Analytics | Booking activity, collection estimates, operational tasks and guest feedback | `/admin/analytics` |
| Users | Staff accounts and role permissions; admin only | `/admin/users` |
| Configuration | Website content, resort information and policy settings; admin only | `/admin/configuration` |
| Business Catalog | Services, units, rates, payment accounts and ocular slots; admin only | `/admin/catalog` |
| Audit Log | Recorded actions and account access activity | `/admin/audit` |

In tables, use search, available dropdown filters and sortable column headings to find records. Paging controls appear where provided. Use each module's own export/refresh controls; not every screen has the same actions.

## 3. Daily operating checklist

At the start of a shift:

1. Open **Reservations** and review the current calendar period, arrivals and maintenance blocks.
2. Open **Transactions → Payment Verification Queue** and reconcile pending proofs with the resort's receiving account.
3. Open **Records → Reschedule Requests** and **Ocular Visit Records** for pending decisions.
4. Open **Transactions → Refund Requests** for requests awaiting review or payout.
5. Check balances for arriving guests and record money received through the correct payment workflow.

During a stay, record added services through the reservation editor and check the resulting payable amount. Before leaving, use **Reports** for date-based collection/activity totals, inspect unresolved items and sign out.

## 4. Find a reservation in the calendar

1. Open **Reservations**.
2. Navigate to the required month using the calendar controls.
3. Use the search icon and **Search calendar** to look up a reference or guest name within the loaded calendar period.
4. Select the booking event or its date marker to open the reservation dialog.
5. Read its schedule, guest details, services, bill and any read-only explanation.
6. Select **Close** when finished, or follow the editing steps below.

Calendar indicators distinguish reservations, items needing attention, ocular visits and maintenance. A date selected in the calendar is not proof that a bill is paid; check the verified payments and transaction balance.

## 5. Enter a phone, Messenger or walk-in reservation

**Required permission:** Add reservation.

1. Open **Reservations** and select **+ New Reservation**.
2. In **New Manual Reservation**, select **Guest type**:
   - **Existing account:** Select the correct registered guest.
   - **Walk-in guest:** Enter the first name, last name, email, phone and address required by the form. This option also supports people booking by phone or Messenger without a website account.
3. Choose the **Booking date**, **Booking package** and, if applicable, **Whole-day variant**.
4. Select the **Unit**, and enter the adults and children counts.
5. Add special requests. Include the booking channel or relevant guest instructions when helpful.
6. Review the current package-price preview.
7. Select **Create Manual Reservation** and wait for the calendar to reload.
8. Find the new reference in the calendar and Transactions. Record any money actually received through the appropriate payment workflow promptly.

**Expected result:** A reservation, guest association and initial bill are recorded. The entry starts unpaid/pending; creating a manual booking does not itself record money or issue a payment receipt. Observe its payment hold/deadline and current status.

The creation dialog does not offer service selection. Open the saved reservation editor to add services. A walk-in profile is separate from a registered website account, so its reservation may not appear in a guest's personal Manage Booking page.

If a save reports that a booking was created but a follow-up action failed, look up the reference before retrying. Avoid duplicating the booking.

## 6. Edit reservation details and add services

**Required permission:** Edit reservations and services.

### Before arrival

1. Select the reservation in **Reservations**.
2. Review the original schedule and **Updated bill** preview.
3. Change the allowed package, arrival, guest counts, accommodation or services. Fixed packages calculate departure from their duration; custom schedules expose the relevant departure fields.
4. Adjust service selections/quantities and special requests as required.
5. Review **Previous total**, **Package adjustment**, **Services total**, **New total**, **Already paid**, **Amount payable** and any **Overpayment**.
6. Enter a specific **Reason for change**, such as “Guest requested a date change through Messenger.”
7. Select **Save reservation**.
8. Check the success result, refreshed calendar and saved bill. Open **View transactions and receipts** if you need billing records.

### During a stay

1. Open the active reservation in the same way.
2. Add available services or increase existing quantities. Update notes/special requests as needed.
3. Review the additional charge and amount payable.
4. Enter the reason and select **Save reservation**.
5. Collect and record additional payment through Transactions when required.

**Expected result:** Reservation details and the current bill/invoice update together, with a recorded reason. Existing payments and issued receipts keep their original amounts.

Once the stay starts, schedule/details changes are restricted and previously booked services cannot be removed or reduced. Ended, closed or expired bookings and bookings awaiting payment/reschedule review can be read-only. An unavailable date or a concurrent change can also stop saving; reload and inspect the current record before trying again.

Existing reservations use their booked package-rate schedule for package differences. Existing services retain their booked prices; newly added services use their available catalog prices. A later Catalog price change does not reprice all existing bookings. Changing accommodation still follows package-based billing; inspect the preview rather than assuming a unit rate replaces the package bill.

Reservation editing does not automatically pay a refund or send a new billing email. Handle an exposed overpayment in **Refund Requests**, and check the revised invoice separately.

## 7. Review a reschedule request

**Required permissions:** Records access and reschedule approval.

1. Open **Records → Reschedule Requests**.
2. Find a **Pending** request by reference, guest or status.
3. Review the old/new dates and the displayed additional charge.
4. To accept, select **Approve**, read the confirmation and confirm the charge/date change.
5. To decline, select **Reject** and enter the requested rejection reason.
6. Read the result and check the refreshed request status.
7. For an approval, verify the new dates in Reservations and the additional payable amount in Transactions.

**Expected result:** Approval updates the schedule and adds the notice fee plus any higher-date-rate adjustment to billing. A rejection leaves the original reservation schedule in place. The original booking remains occupied while the request is pending.

Approval can fail if another booking/maintenance block conflicts or the requested start is too near/past. A lower-date rate does not automatically create a refund. Explain any additional balance to the guest; they can pay through Manage Booking when eligible.

## 8. Approve an ocular visit

**Required permissions:** Records access and ocular approval.

1. Open **Records → Ocular Visit Records**.
2. Find the **Pending** visit and review its reference, guest, date and slot.
3. Confirm that the visit can be accommodated and has not started.
4. Select **Approve**, confirm, then check the updated status.

**Expected result:** The visit is confirmed and the existing guest notification/email workflow is attempted. A viewing is free and does not create a paid stay reservation.

The current Records screen offers ocular approval, not an ocular rejection button. Guests can change or cancel eligible visits through their own Manage Booking screen. Contact the guest if other arrangements are needed.

## 9. Create or release a maintenance block

**Required role:** Admin.

1. Open **Reservations** and select **+ Maintenance Block**.
2. Enter **Name**, **Reason / guest announcement**, **Start date** and **End date**.
3. Review the affected dates. Existing active reservations prevent creating a conflicting block.
4. Select **Block dates and alert guests**.
5. Check the result and calendar indicator. Registered guests receive an in-app alert through the existing notification workflow.

To reopen the dates, select the maintenance event, choose **Release block** and check the result. The released block no longer blocks new bookings. Do not use maintenance as a substitute for reviewing existing guest cancellations/refunds.

## 10. Use the transaction ledger

1. Open **Transactions → Transaction Ledger**.
2. Search/filter for the booking reference.
3. Select **View** to inspect the transaction.
4. Check total amount, paid amount, balance and any excess amount.
5. Use **Refresh ledger** to reload or **Export Ledger** to download the table's matching rows.

| Billing term | Meaning |
| --- | --- |
| Total amount | Current reservation bill, including saved services/adjustments |
| Paid amount | Verified payments, reduced by completed refunds |
| Balance | Amount still payable; an unverified proof does not settle it |
| Excess / overpaid amount | Verified net payments above the current bill |
| Invoice | A billing document showing the reservation charges |
| Receipt | A record of a particular payment received |

The transaction summary and ledger use the latest **200 loaded ledger records**, not all historical transactions. The receipt list also has a recent-record limit. Use date-based Reports for full-period collection totals. Ledger/document CSV exports include the matching rows loaded in that module and follow its table filters.

## 11. Verify a guest GCash payment

**Required permissions:** Transactions access and payment approval.

1. Open **Transactions → Payment Verification Queue**.
2. Filter to **Pending** and select **Review** for the correct payment.
3. Read the reservation reference, payment reference, amount, sender, payment type, receipt time and receipt-screening notes.
4. Open the proof at full size. Check that it is a clear, complete original GCash screenshot.
5. Independently check the resort's receiving GCash account. Match the actual transaction's **amount, reference, recipient and date/time** with the proof.
6. For new guest receipts, select the required original-screenshot acknowledgement only after the image loads and you have checked it.
7. Select **Approve** and then **Confirm approval**, or **Reject** and then **Confirm rejection**.
8. Check the review result, reservation status, ledger balance and generated receipt.

**Expected result:** Approval credits the actual submitted payment and confirms an eligible initial reservation. Rejection of an initial payment can reject the reservation and release its dates. Rejection of a later balance payment leaves an already confirmed reservation active.

The receipt-reading check is not proof that money arrived. Reject photographed screens, altered receipts or inconsistencies rather than approving solely because the text was recognized. New guest receipts must use the current Philippine payment date; older/manual records can have no extracted receipt time and use their existing review workflow.

If a payment decision succeeds but an email/notification follow-up fails, refresh and inspect its saved status before retrying. Do not approve the same payment twice. If money arrived but a proof was rejected, reconcile the transfer with the guest before requesting another transfer.

## 12. Record a cash payment

**Required permissions:** Transactions access and manual payment entry.

This is the staff cash workflow. Online guest payment submission remains GCash only.

1. Open **Transaction Ledger** and find the reservation.
2. Select **Settle** on its row, or use **Post Payment** and then select the correct reservation in the dialog.
3. Check the reservation reference and balance in **Record cash payment**.
4. Enter the actual **Amount received** and required **Cash reference**.
5. Select **Record payment and issue receipt**.
6. Verify the updated balance and corresponding receipt.

**Expected result:** The received cash is recorded and a separate receipt is issued for that payment. The form caps the amount at the current outstanding balance. Record money already received; this button does not collect money from the guest.

## 13. Review and pay a refund

**Required permissions:** Transactions access, refund review for decisions, and refund payout for completion. These are separate permissions.

### Review a request

1. Open **Transactions → Refund Requests**.
2. Check whether the row is an **Excess payment** or **Cancellation** request.
3. Select **Review** and inspect its amount, status, policy and existing review notes.
4. Check the current bill, verified payments and prior refunds before deciding.
5. Enter review notes as needed and select **Approve**, or enter the required reason and select **Reject**.
6. Check the saved status.

**Expected result:** An approved request awaits payout. Approval alone does not transfer money. Cancellation decisions follow the policy attached to that reservation; excess refunds apply to verified payments above the current bill and do not cancel the reservation.

### Record the payout

1. Open the **Approved** request and recheck the available refund amount.
2. Confirm the guest's payout details through the resort's normal process.
3. Complete the GCash transfer outside the website.
4. Enter the real **GCash transfer reference** and upload **Transfer proof**.
5. Select **Mark refunded** after the transfer has succeeded.
6. Check the recorded reference, proof and **Refunded** status.

**Expected result:** The completed refund reduces net paid billing; original payments and receipts retain their historical amounts. **View transfer proof** opens the stored payout evidence.

The system recalculates eligibility before approval/payout. Added services or another billing change can remove an excess; read the error and review the current bill instead of forcing an outdated amount. References cannot be reused. Only one open pending/approved refund is allowed per reservation.

## 14. View invoices and print receipts

### Invoices

1. Open **Transactions → Generated Invoices**.
2. Select **Refresh invoices** to load the latest available documents.
3. Search/filter for a reservation and select **View**.
4. Review charges, services and totals in the invoice dialog.
5. Use **Export invoices CSV** for the table's matching rows.

Invoices are generated from reservation billing; there is no manual Generate Invoice action on this screen.

### Receipts

1. Open **Transactions → Issued Receipts**.
2. Select **Refresh receipts** and find the payment/reservation receipt.
3. Use **View** to inspect it, or **Print** on the row to open the printable receipt.
4. Use the browser's print dialog to choose a printer or **Save as PDF**. Allow the print window if your browser blocks it.
5. Use **Export receipts CSV** for the matching loaded receipt rows when needed.

Receipts are issued by payment workflows. Each payment can have its own receipt; it does not replace earlier receipts. Original receipt amounts remain unchanged when a reservation is edited or an excess is refunded. An invoice is not proof of payment.

## 15. Run sales, staff and guest reports

| Report | Where to open it | What it measures |
| --- | --- | --- |
| Sales Report | Reports | Gross verified collections and reservations created during the selected dates |
| Staff Report | Reports | Logged actions and identified staff activity during the selected dates |
| Guest Report | Transactions → Guest Report | Reservations created, guest contacts, group sizes, sources and booking history |

There is no separate Financial Report tab in Reports. Guest reporting belongs to Transactions.

### Select dates and read the summary

1. Open the report and choose its tab if provided.
2. Select a **Period**:
   - **Last 7 days · daily:** Seven Philippine calendar days, including today.
   - **Last 4 weeks · weekly:** Twenty-eight days in four seven-day groups.
   - **Last 6 months · monthly:** Six calendar months, including the current month to date.
   - **Custom date range:** Choose From and Through, then select **Apply dates**. Both dates are included; the maximum range is five years.
3. Read the date range, update time, summary-card explanations and calculation note.
4. Use **Refresh report** to reload or retry an error. **Reset period** returns to the seven-day view.

### Change chart styles

1. Find **View** above either chart.
2. Choose **Line graph**, **Bar chart**, **Pie chart** or **Progress bars**.
3. Read the exact values below the chart. Graph point numbers match the numbered dates/categories in that list.

Trends initially use a line graph; breakdowns initially use a pie. Switching chart styles keeps the same totals and dates. Pie percentages show each category's share of that chart's total. Your selections remain while changing tabs/dates until the page is reloaded.

### Filter, export and print

1. Search the report table or apply its available filters. Guest filters include booking source, status and booking history.
2. Sort using a column heading. Use **First**, **Previous**, **Next** and **Last** for 25-row pages.
3. Use **Clear table filters** to reset search, filters and sorting.
4. Select **Export CSV** to download every matching table row across all pages.
5. Select **Print report** to print or save a PDF containing the selected charts, full-period summary and every matching table row.

**How to interpret the numbers**

- Sales counts money by payment verification date; older records without that date use submission date. Collections are **before refunds**, so they can differ from the ledger's net paid amount.
- Guest reporting uses reservation creation dates, not arrival dates or guest registration dates. The table separately shows scheduled arrival. Headcount is booked adults plus children, including all reservation statuses.
- First-time bookers have no reservation before the selected period; returning bookers have an earlier reservation. Each guest profile is counted once in those summary cards. These labels do not prove actual attendance.
- Staff totals come from audit records, including separately described guest/system activity. Logged-action counts do not measure staff productivity.
- Summary cards and charts cover the full date range. Table search/filters narrow the table, CSV and printed table; they do not change the summary totals.

## 16. Understand analytics

1. Open **Analytics**.
2. Choose **Bookings**, **Collection forecast**, **Operations** or **Guest feedback**.
3. Select the period or apply custom dates as in Reports.
4. Read the summary explanations and calculation note before interpreting a chart.
5. Use chart **View** selectors, **Export CSV**, **Print report**, **Refresh analytics** and **Reset period** as needed.

| Tab | Meaning |
| --- | --- |
| Bookings | Reservations created and their sources; includes all statuses, not occupancy or arrivals |
| Collection forecast | Actual verified collections plus a separately labelled estimate from historical averages |
| Operations | Payment submissions/pending reviews within the selected dates and logged activity |
| Guest feedback | An on-demand AI summary of up to 100 latest approved reviews created within the dates |

### Collection forecast

The formula is **actual gross collections ÷ selected calendar days × forecast days**. Days with no payments are included. Forecast length is one day for Daily/Custom, seven days for Weekly and 30 days for Monthly. The forecast starts after the selected end date; a past range produces a historical estimate.

For example, PHP 28,000 collected across 28 selected days averages PHP 1,000 per day and estimates PHP 7,000 for the next seven days. The estimate is not money received, does not adjust for seasonality/holidays and has no statistical confidence score. Today's incomplete payments and limited history can affect it. Estimated new reservations use the same daily-average approach and include all statuses.

Collection charts contain actual amounts by date/payment type; estimates are not mixed into their pie total. Approval dates and gross/refund treatment match Sales Report.

### Operations

Pending submissions count only payments submitted within the selected dates, not all outstanding payments. The payment-status pie compares payments with payments; the activity graph counts audit entries separately. Follow the task explanation to open Transactions or Audit Log for details.

### Guest feedback

1. Select **Guest feedback**, then **Analyze feedback**.
2. Wait for the analysis and read the review sample size, sentiment percentages, summary and themes.
3. Change chart style or export/print the result if needed.
4. Use **Analyze again** to refresh the analysis.

These are AI-generated interpretations of the sampled reviews, not a survey of every guest. No approved reviews produces a no-data result. If analysis is unavailable, ask the administrator to check the service. Changing dates or refreshing analytics clears the previous analysis so results are not reused for the wrong period.

## 17. Manage catalog items and payment QR codes

**Required role:** Admin.

### Add or edit an item

1. Open **Business Catalog** and select the required category: services, units, unit rates, guest rates, payment methods, payment accounts, general policies or ocular slots.
2. Search/filter to find the item, or select the category's Add button.
3. Select **Edit** for an existing item.
4. Fill in the required name, description, price, capacity, schedule or linked item fields offered for that category.
5. Use valid whole numbers for quantities/capacities and valid amounts for prices. Clear an optional field when you intend to remove its value.
6. Save through the dialog and check the result/list.

### Archive or restore

1. Select **Archive** on an active item.
2. Review the confirmation and select **Archive item**.
3. Use the **Archived** or **All** filter to find it later.
4. Select **Restore**, then **Restore item**, when it should be offered again.

**Expected result:** Archiving removes an item from new active selections while retaining historical records. Editing an archived item does not automatically restore it. Restoring linked rates/accounts requires their parent unit/payment method to be active. Only one guest-rate record can be active; activating another replaces the previously active record.

### Set up a GCash QR account

1. Make sure the relevant GCash payment method is active.
2. Open **Payment accounts** and add/edit the resort's account.
3. Enter the account name and number accurately. Preserve leading zeros.
4. Attach the correct QR image: PNG, JPEG or WebP, up to 5 MB. A QR image is required, including when editing an older account without one.
5. Save and check that the list shows a QR attached.
6. Open the guest payment screen to check the displayed account name, number and QR.

Replacing a QR and saving the account publishes them together. Upload/save failures do not mean the new QR was published. Archiving a payment method also hides its linked accounts from guest selection. The current online flow accepts GCash only; adding a non-GCash method does not enable a different checkout flow.

## 18. Change weekday and weekend package rates

**Required role:** Admin.

1. Open **Business Catalog → Package rates**.
2. For **Weekday · Monday–Thursday**, edit the package price and additional-guest charge for Day, Night and Whole Day.
3. Do the same for **Weekend · Friday–Sunday**.
4. Review all six package prices and six additional-guest charges.
5. Select **Save package rates** and wait for success.
6. Start a new booking preview to verify the current amounts.

Package prices must be positive; additional-guest charges may be zero. Amounts support cents. Times remain fixed, packages include 20 guests and the maximum is 30. The booking start date determines the weekday/weekend tier; automatic holiday overrides are not implemented.

**Expected result:** New bookings use the published prices. Existing bookings retain their booked rate schedule, totals and payment history. If another administrator changes rates while you are editing, use **Reload rates**, check the current schedule and save again.

### Restore original rates for testing

1. Select **Restore defaults**.
2. Review the filled-in original rates.
3. Select **Save package rates** to publish them.
4. Create a new test booking for payment/receipt testing.

Restore defaults changes the form first; it is not published until saved. It does not undo past bookings or their payments. On a production site, saving defaults also changes prices for new real bookings, so coordinate the change with the owner.

## 19. Change website content and booking policies

**Required role:** Admin.

### Change the logo, landing page or About page

1. Open **Configuration → Website content**.
2. Select **Branding**, **Home page** or **About page**.
3. Edit the relevant logo/image and text fields.
4. Upload PNG, JPEG or WebP up to 5 MB, or use the supported image URL/path field. Wait for an upload to finish.
5. Select **Save branding**, **Save home page** or **Save about page** for the section you edited.
6. Select **Open guest page** to inspect the published result. Reload/focus the guest page if needed.

**Expected result:** Saving publishes that section. Uploading an image alone does not publish it. Save each section separately; unsaved edits elsewhere are not published with it.

Use **Resort information** for the resort name, address, phone/email and social links, then save that category's settings. Keep text readable and check logo/image visibility on a phone. If a rates image contains prices, update the image separately when required; changing live package rates does not rewrite text inside an uploaded picture.

### Publish cancellation and refund rules

1. Open **Configuration → Reservation settings**.
2. In **Cancellation and refund policy**, review the current version.
3. Edit the guest cancellation notice hours, cancellation text and refund text.
4. Choose whether cancellation of a paid booking creates a refund review request. Staff still decide whether a refund is approved.
5. Select **Publish new version** and check the confirmation.
6. Use **Previous versions** to inspect retained policies.

**Expected result:** New reservations use the new policy. Existing reservations retain the policy attached when booked. Policy text should clearly explain the resort's actual process; publishing text does not automatically implement a new payment method, package time or reschedule algorithm.

Other Configuration categories include ocular, payment and notification settings. Use their field descriptions and save buttons, but see the current limitations below: some general settings are stored preferences and are not wired into every workflow.

## 20. Manage staff accounts and permissions

**Required role:** Admin.

### Create an account

1. Open **Users** and select **Add Staff User**.
2. Enter **Full Name**, **Email**, **Role** and a **Temporary Password**.
3. Choose whether the staff member is active.
4. Select **Create Staff User** and confirm the account appears.
5. Give the staff member the login instructions and temporary credentials privately. They must complete any email/code/password-change prompts.

### Update, deactivate or reset access

1. Find the staff account in **Staff Accounts**.
2. Use **Edit** to change the offered name, email, role or active fields, then **Save Changes**.
3. Use **Toggle Status** when enabling/disabling account access, and check the resulting status.
4. Use **Reset Password** to set a temporary password when needed. The staff member changes it on next access when prompted.

Your own admin role cannot be removed through this workflow. Check that the staff member has the appropriate role before sharing access.

### Change role permissions

1. Open **Role Permission Matrix** on Users.
2. Select the required Manager or Cashier permissions.
3. Grant module access and the specific action permissions needed for the work. For example, refund review and refund payout are separate.
4. Select **Save manager** or **Save cashier** for the role you changed. Save each role separately.
5. Ask the staff member to refresh/reopen the relevant module and confirm the permitted actions.

**Expected result:** Permissions apply to the role on subsequent requests. Admin keeps full access; Users, Configuration and Business Catalog remain admin-only. Removing all module access can leave a role with no portal pages.

## 21. Inspect the audit log

1. Open **Audit Log**.
2. Search for the reference, action or actor.
3. Use **Module** and **Actor / Email** filters to narrow activity.
4. Select **View Details** on an entry.
5. Read the actor, affected record, time and change summary. Expand **Technical details** only if needed for support.

**Expected result:** You can review recorded guest, staff and system actions, including relevant reservation changes and access attempts. Audit records document actions; they are not payment receipts.

The visible **Export Log** control currently has no connected download action. Do not rely on it for an export; see the limitations below.

## 22. Troubleshooting and current screen limitations

### Troubleshooting

| Problem | What to do |
| --- | --- |
| Module or action missing/forbidden | Check active account status and Role Permission Matrix; module access and action rights are separate |
| Verification email/code not received | Check Spam/Junk and the staff email; ask the administrator to check email delivery if it persists |
| Session replaced | Sign in on the device to be used; another device accessed the same account |
| Reservation is read-only | Read its lock message; check status, payment/reschedule review, stay end and edit permission |
| Reservation changed while editing | Select Reload reservation and review the current details/bill before saving again |
| Date change/save conflicts | Check other active reservations and maintenance; choose an available schedule |
| Approve payment is disabled | Check payment permission, pending status, loaded proof and the required screenshot acknowledgement |
| A payment changed status but email failed | Refresh status and billing first; do not duplicate the payment decision |
| Cash amount is rejected | Check that it is positive and does not exceed the current outstanding balance |
| Refund amount is no longer available | Inspect the latest bill, payments and completed refunds; review/reject the outdated request as appropriate |
| Receipt print window is blocked | Allow the site's print window, then retry Print |
| Report/analytics fails to load | Use Refresh report / Refresh analytics; check access and the displayed error |
| Reports differ from ledger summaries | Check full-date-range vs recent-record scope, gross collections vs net paid amounts, and verification vs submission dates |
| Package rates changed while saving | Reload rates or the booking price preview, review all amounts and save again |
| Catalog restore fails | Restore its required parent item first and check the validation message |
| QR or content image upload fails | Use the supported format/size and retry; contact the administrator if uploads remain unavailable |

For technical help, record the module, affected booking/payment reference, action, exact error and approximate time. Include a screenshot when useful. Ask the system administrator to investigate configuration, database or email errors; do not expose passwords, keys or verification codes in a report.

### Current screen limitations

These notes describe the current application and prevent users from treating demonstration controls or stored preferences as completed operational actions.

| Screen or feature | Current behavior and working alternative |
| --- | --- |
| Dashboard metrics/charts | Summary values/charts are still illustrative. Its reservation table reads records but is limited and should not be treated as a complete future-arrivals list. Use Reservations, Transactions, Reports and Analytics for operational decisions |
| Dashboard Export, Refresh and View | These displayed controls have no connected handlers. Use the corresponding working module controls |
| Audit Log → Export Log | Displayed without a download handler; View Details, search and filters work |
| Separate guest `/ocular` page | Demonstration success is not a saved visit. Direct guests to Book Now → Ocular Visit and confirm it appears in Manage Booking/Records |
| Staff cancellation/completion | The current calendar/Records UI does not expose dedicated staff Cancel or Complete buttons. Do not infer that editing a reservation changes its lifecycle status; eligible guests have cancellation in Manage Booking. Escalate other cases to the administrator's approved operating process |
| Some general Configuration settings | Saving a stored preference does not necessarily change all booking/payment/notification workflows. Use the dedicated package-rate and policy editors for implemented pricing/policy changes; online guest payment remains GCash and package times remain fixed |
| Review moderation | The current portal has no dedicated review-moderation screen. Review submission currently publishes automatically; do not look for an admin review approval button in Records |
| Older records | Historical/manual entries may lack fields found on newer bookings or receipts. Inspect the displayed record and supporting history before acting |

Application updates can change these limitations. Recheck this manual when new screens or workflows are deployed.
