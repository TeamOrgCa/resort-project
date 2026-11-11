# MarVille Resort Complex — User Manuals

**Updated:** 11 November 2026.

The role-based PDF is the primary user guide for guest, cashier, manager and administrator accounts. It includes the current manager approval → cashier transfer → manager verification refund process, automatic ocular confirmation, attendance and role boundaries. Current prices, contact details and booked policies should be read from the system.

| Manual | Audience | Contents |
| --- | --- | --- |
| [User Manual PDF](USER_MANUAL.pdf) | Guests, cashiers, managers and administrators | 21 A4 pages with a cover, linked contents, a separate guide for each role, status reference and troubleshooting |
| [Role-based editable source](USER_MANUAL_ALL_ROLES.md) | Manual maintainers | Markdown source for the current PDF |
| [Role-based HTML](USER_MANUAL_ALL_ROLES.html) | All four account types | Self-contained browser edition of the PDF content |
| [Client User Manual](CLIENT_USER_MANUAL.md) | Guests | Registration/confirmation, booking, GCash proof, balances, services, rescheduling, cancellation, refunds, ocular visits, reviews/photos and troubleshooting |
| [Admin and Staff User Manual](ADMIN_USER_MANUAL.md) | Admins, managers and cashiers | Permissions, manual bookings, reservation edits, payment review, cash entry, refunds, billing documents, reports/charts, analytics, catalog/rates, website content, users and audit |
| [Printable Complete Manual](USER_MANUAL.html) | Both audiences | Both guides in one browser-readable document with navigation and printing |

## Read or print

Open `USER_MANUAL.pdf` to read, share or print the four-role manual. Its contents links and PDF outline provide navigation. The role-based HTML also works offline and does not require signing in. The earlier individual guides and their combined HTML remain available as additional screen-specific references.

The admin guide includes current screen limitations so staff and testers can distinguish working tasks from older demonstration screens. No production website address, account credentials or secret configuration values are included.

## Keeping the guides current

Update `USER_MANUAL_ALL_ROLES.md` when a screen, role permission or booking/payment rule changes. Regenerate the role-based HTML and PDF using:

```powershell
python docs/build-user-manual-pdf.py
```

This uses Python's standard library, Node.js, the installed project dependencies and a local headless Chrome or Edge browser. It downloads no fonts or packages. Set `CHROME_PATH` if the browser is installed elsewhere. The generator checks internal links, page overflow, A4 paper size and PDF page count, and saves preview images under `.next/manual-preview`.

To regenerate the earlier combined reference HTML after changing its individual guides, use:

```powershell
python docs/build-user-manual.py
```

The generator uses Python's standard library and adds no application dependency. Website/database setup instructions remain in the existing technical documents; these guides are for everyday users.
