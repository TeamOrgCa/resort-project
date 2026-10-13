# MarVille Resort Complex — User Manuals

**Updated:** 13 October 2026.

These manuals cover the current guest website and staff portal, including the chart/report updates. They describe the implemented screens rather than proposed features. Current prices, contact details and booked policies should be read from the system; example amounts in the guides are illustrative.

| Manual | Audience | Contents |
| --- | --- | --- |
| [Client User Manual](CLIENT_USER_MANUAL.md) | Guests | Registration/confirmation, booking, GCash proof, balances, services, rescheduling, cancellation, refunds, ocular visits, reviews/photos and troubleshooting |
| [Admin and Staff User Manual](ADMIN_USER_MANUAL.md) | Admins, managers and cashiers | Permissions, manual bookings, reservation edits, payment review, cash entry, refunds, billing documents, reports/charts, analytics, catalog/rates, website content, users and audit |
| [Printable Complete Manual](USER_MANUAL.html) | Both audiences | Both guides in one browser-readable document with navigation and printing |

## Read or print

Open either Markdown guide in your editor's preview. For a combined printed copy, open `USER_MANUAL.html` in a browser, select **Print / Save as PDF**, and choose a printer or the browser's Save as PDF destination. The HTML copy works offline and does not require signing in.

The admin guide includes current screen limitations so staff and testers can distinguish working tasks from older demonstration screens. No production website address, account credentials or secret configuration values are included.

## Keeping the guides current

Update the relevant Markdown guide when a screen, button, role permission or booking/payment rule changes. Then regenerate the combined HTML using:

```powershell
python docs/build-user-manual.py
```

The generator uses Python's standard library and adds no application dependency. Website/database setup instructions remain in the existing technical documents; these guides are for everyday users.
