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

## Compact notification pop-ups — 11 November 2026

The shared guest/staff notification component displays one compact banner on viewports narrower than 640px or at most 500px tall, including landscape phones. The title uses at most two lines; full message text stays in the notification tray. View details, the waiting count, individual dismissal and Dismiss all remain available. The banner clears the guest's 80px navigation bar and respects the device's top safe area. Desktop layouts retain their three-card stack.

Only visible notifications start their five-second dismissal timer. Resizing preserves queued notifications, and dismissing a pop-up does not mark its saved notification read. The same behavior applies to guests, administrators, managers and cashiers.

Run `node scripts/check-notification-layout.mjs` to check the actual component markup and generated application CSS in Chromium. It covers customer and staff fixtures at 320 × 568, 390 × 844, 430 × 932, 568 × 320, 667 × 375, 844 × 390, 768 × 1024 and 1280 × 900. It checks banner size, page-action clickability, horizontal bounds and 44px touch targets. React interaction tests separately cover viewport changes, queue retention, dismissal timers and both account menus. The browser fixtures do not sign into a live account.

## Notification visibility on authentication screens — 11 November 2026

Guest and staff authentication screens do not start the account notification feed, even when another tab shares a signed-in browser session. This applies to `/auth/*`, `/staff/*` and `/admin/login`. The shared notification context supplies an empty account and feed on these screens so account menus cannot fall back to loading notifications independently.

Navigating to one of these screens immediately removes pop-ups, unsubscribes from notification/auth events and clears feed polling and popup timers. Late responses from the previous screen are discarded. Returning to an ordinary page verifies the current account and loads a fresh feed; saved notifications and read flags are preserved. No database migration is required. `node --test tests/notification-center-ui.test.mjs` covers shared-session signals on login screens, route changes, stale responses and subsequent account changes, alongside the existing desktop/mobile notification behavior.
