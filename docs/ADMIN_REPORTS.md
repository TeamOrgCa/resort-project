# Reports and guest reservations

Open **Admin → Reports** for Sales Report and Staff Report. Open **Transactions → Guest Report** for guest reservation activity. Existing `reports` and `transactions` permissions apply to their respective endpoints; the guest endpoint cannot request sales or staff data. No database migration is required.

## Dates and totals

- Daily shows the last seven Philippine calendar days, including today.
- Weekly shows the last 28 days in four consecutive seven-day groups.
- Monthly shows six actual calendar months, including the current month to date.
- Custom dates include both the From and Through dates, with a maximum range of five years. Apply dates validates the range before requesting a report.

The selected start/end dates, update time, calculation notes and summary cards appear on each report. Times use `Asia/Manila`, including labels and printed documents. Paginated server reads collect all matching report records, rather than stopping at the first PostgREST page.

Sales collections include verified payments by approval date (`verified_at`); legacy verified payments with no approval date use `created_at`. Pending and rejected payments are excluded. Amounts are gross collections before refunds, and can include an excess payment. Down, full/balance and additional payments have separate breakdowns. Reservation counts use reservation creation dates and include all statuses.

Guest dates filter reservation creation, while the table separately shows scheduled arrival. Names, phone numbers, email, references, sources, statuses and group sizes include registered guests and walk-in profiles. Headcount is adults plus children on all included reservations. First-time bookers have no reservation before the selected period; returning bookers have an earlier reservation. Each guest profile is counted once in those summaries. These labels describe booking history rather than registration date or confirmed attendance.

Staff counts come from audit entries. Staff accounts with the same name stay separate. Staff events recorded through `auth_user_id` are attributed when the account can be identified; remaining guest/system events are grouped separately. Module breakdowns and the most recent action are shown.

## Buttons and table controls

- Reports update when changing a preset period, changing report type or applying custom dates. Refresh report fetches again and remains available after a failed request. Reset period returns to the seven-day view.
- Search, column sorting and guest source/status/history filters narrow the table. Clear table filters resets search, dropdowns and sorting. First, Previous, Next and Last navigate 25-row pages.
- Export CSV exports **every matching row across all pages**, in the current sort order. The filename includes the report and dates. Cells preserve quotes/line breaks and prevent spreadsheet formulas from guest-provided text.
- Print report opens the browser's print dialog with an isolated report document, including dates, notes, summary, trends, breakdowns and every matching table row. Save as PDF is available through the browser. The surrounding admin interface is excluded.
- Summaries and charts always describe the full selected period; table filters affect the table, CSV and printed table. Exports and printing are disabled while a request is unresolved, after load failures or when there are no matching table rows. Switching reports aborts the previous request and cannot export its stale data.

Transactions also has working ledger/invoice/receipt CSV exports that respect table filters, plus refresh buttons. Invoice generation and receipt issuance remain automatic; their former inactive generation buttons are replaced with refresh/export controls. Invoice View and receipt View/Print remain available. Transaction lists retain their existing recent-record limits; their scope is explained on the page. A failed transaction load disables exports and row actions while keeping refresh available.

## Chart views

Reports, Transactions → Guest Report and Analytics share a **View** selector on each chart: Line graph, Bar chart, Pie chart or Progress bars. Trends start as line graphs; breakdowns start as pies. Switching the view keeps the same dates and totals and does not fetch different data. Your selections remain while changing tabs/dates until the page is reloaded. Exact values appear below each chart. Graph numbers map to numbered dates/categories in that list; pie slices show their share of the total. Empty periods show an explanation instead of an invalid or misleading pie.

Printed reports and browser PDF output include the selected chart styles and full-period values, followed by all matching table rows. Printed charts omit their interactive selectors. CSV output remains tabular.

## Analytics

The tabs are **Bookings**, **Collection forecast**, **Operations** and **Guest feedback**. Summary cards explain each metric; the selected dates, Philippine update time and calculation notes appear on the page. Refresh analytics retries a failed request; Reset period returns to seven days. Changing dates aborts old requests and invalidates previous feedback analysis and exports.

- Bookings counts reservations by creation date, including all statuses. This is not occupancy or actual arrivals. Booking sources separate online, staff entry (walk-in, phone, Messenger) and unspecified records.
- Collection forecast uses the same verified-payment approval dates as Sales Reports, with a creation-date fallback for legacy records. Charts contain **actual gross collections**, before refunds, separated by payment type. Estimated collections are shown separately: `gross collections / selected calendar days * forecast days`. Forecast lengths are 1 day for Daily/Custom, 7 days for Weekly and 30 days for Monthly. The forecast begins after the selected end date; a historical window produces a historical estimate. Calendar days with no payments are included, and today's incomplete activity can still change. There is no invented confidence rating, seasonality model or holiday adjustment. Estimated new reservations use the same daily-average method and include all booking statuses.
- Operations shows pending submissions **from the selected dates**, payment submission counts and audit activity. Payment status charts combine only payment counts; activity graphs combine only audit counts. Older pending submissions are outside this view. There are no arbitrary severity thresholds or claims that action counts measure staff productivity. Instructions direct staff to Transactions or Audit Logs for follow-up.
- Guest feedback is analyzed on demand using the latest 100 approved reviews created within the selected dates. The sample size, AI summary, themes and sentiment percentages are explicit. Empty samples do not require an AI call. Invalid AI output produces a retryable error; a missing service configuration shows a clear unavailable message. Feedback analysis remains an estimate and may not represent all guests.

Analytics CSV and Print report use every matching table row and the current chart styles. Export controls remain unavailable until the current report is loaded (or feedback is analyzed). Both analytics API methods enforce the existing `analytics` permission and return `Cache-Control: no-store`.

## Verification

`tests/reports-data.test.mjs` covers Manila date boundaries, real calendar months, gross verified collections, old verified payment dates, walk-ins and returning bookers, record pagination, staff attribution and invalid/error responses. Existing access tests verify module permissions. `tests/reports-ui.test.mjs` uses real React interactions with jsdom to exercise date selection/apply/reset, table filters, numeric sorting, pagination, CSV contents, print preparation, retries and request cancellation. jsdom is a development dependency only.

`tests/analytics-data.test.mjs` checks verification-date consistency, correct weekly/monthly forecasts (including leap-year month lengths), pagination, empty estimates, API permissions and feedback validation. The UI tests also exercise chart switching, proper currency/count/percentage units, chart printing, analytics filters/exports, feedback actions and cancellation of stale results.
