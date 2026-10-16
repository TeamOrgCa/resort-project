# Mobile layout verification

Updated 2026-10-17.

The shared admin tables display labelled record cards below 1024px, with the same sorting, selection, pagination and row actions. Tablet navigation uses the hamburger drawer. Desktop tables retain their normal layout and scroll within their own region when necessary.

Client booking, ocular, authentication, review and profile forms use smaller phone padding. Calendars retain seven day columns with readable headings; time options use two columns on phones. Booking summaries wrap long values and become sticky only on desktop. Dialogs, notifications and the chatbot have viewport height/width limits and scroll within their own panels. Phone form fields use at least 16px text to avoid input zoom.

Run `node scripts/check-mobile-layout.mjs` with an installed Chromium browser, or set `CHROME_PATH`. The script needs permission to launch a local headless browser. It uses public-page rendering and representative admin components with fixture data; it does not log into production or modify a database.

Verified 28 layouts at each size:

| Viewport | Coverage |
| --- | --- |
| 320 × 568 | Small phone |
| 390 × 844 | Phone |
| 667 × 375 | Landscape phone |
| 768 × 1024 | Tablet |
| 1024 × 768 | Landscape tablet / desktop boundary |
| 1280 × 900 | Desktop |

All 168 browser checks passed for page overflow, module container bounds and phone input font sizes. Fixtures cover public pages, booking steps, authentication, dashboard/report/analytics components, transaction/record/user/audit/catalog tables, reservation calendars, website content groups and the restore dialog. Separate interaction tests cover the live controls and form submission behavior; the browser layout check itself does not hydrate the fixture pages or emulate Safari.

Website content can be recovered using **Configuration → Website content → Restore website defaults → Restore and publish defaults**. The server restores only the original content definitions, including local image paths, through an administrator-only endpoint. No database migration is required.
