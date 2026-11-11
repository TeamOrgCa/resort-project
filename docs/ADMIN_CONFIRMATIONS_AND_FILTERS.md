# Administrative confirmations and transaction dates

Manual reservation creation and maintenance creation show a final confirmation after form validation. The reservation review includes the guest, package, Philippine schedule, guest counts, accommodation and total; payments are recorded separately. Maintenance review includes its name, period and reason and explains that conflicting reservations or visits prevent creation. Canceling keeps the form values. The server still validates availability and permissions when the confirmed request arrives.

Users confirms staff creation, profile/access edits, activation changes and password resets. Password values never appear in the confirmation text. Guest activation changes retain their existing confirmation dialog. The role permission matrix reviews permissions being added and removed for Managers and Cashiers before saving both roles together. Failed saves retain edits.

Confirmation dialogs open above the parent form, focus the cancel action, contain keyboard navigation and return focus on dismissal. Escape cancels the confirmation without closing the underlying form.

Calendar color pickers have circular native swatches in Chromium/WebKit and Firefox. Their saved colors and account preferences use the existing storage.

Transactions offers Today, This week, This month, Overall and Custom date directly above the active table, below the transaction tabs. Overall is the default. All ranges use Asia/Manila; weeks run Monday–Sunday and custom ranges include both end dates. Invalid or incomplete custom ranges show an error and no matching records.

| Tab | Date used |
| --- | --- |
| Transaction Ledger | Last update |
| Payment Verification Queue | Payment date |
| Refund Requests | Request date |
| Generated Invoices | Creation date |
| Issued Receipts | Issue date |

CSV exports combine the selected range with table search and status filters. Date changes reset pagination while preserving search. Bill cards sum the current totals and balances of ledger entries updated in the range, rather than presenting cash-flow totals. Pending verifications count matching payment dates. Range filtering does not change the underlying records or the available payment/review actions.

No database migration is required.
