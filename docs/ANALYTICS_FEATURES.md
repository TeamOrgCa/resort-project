# Analytics and Reporting Features

## Overview

The admin analytics module provides live operational analytics for MarVille Resort Complex. Data is loaded from the database through protected server routes, while the client page is responsible for filters, charts, actions, and exports.

## Analytics Views

### Booking Trend Analysis

- Displays reservation volume for the selected period.
- Groups activity into Daily, Weekly, or Monthly buckets.
- Shows the booking channel split between website/online and walk-in reservations.
- Table rows contain the bucket label, booking count, and channel context.

### Revenue Forecasting

- Uses verified payment records as historical revenue input.
- Calculates a transparent projection from the selected period's average verified revenue.
- Displays projected bookings, projected revenue, and confidence based on available verified payment history.
- The `Run Forecast` action refreshes the forecast through the server endpoint.

### Performance Signals

- Shows pending payment queue volume.
- Shows staff/system audit activity for the selected period.
- Compares current values with simple operational thresholds and assigns a Normal or Watch severity.

### Guest Feedback Sentiment

- Uses approved records from the `reviews` table.
- Sends review rating, title, body, and recommendation values to Gemini for aggregate analysis.
- Displays overall sentiment, positive/neutral/negative percentages, key themes, and a written summary.
- The `Analyze Feedback` action runs a fresh Gemini analysis.
- Individual guest identities are not sent to Gemini.

## Exporting

### CSV

`Export Summary` downloads the currently selected tab and period as a CSV file. The export uses the visible table columns and rows.

### PDF

`Export PDF` opens a print-ready report in a new browser tab and opens the native print dialog. Choose **Save as PDF** as the printer destination to save the report. The PDF includes:

- Report title and selected period.
- Generation timestamp.
- Current table data.
- Sentiment summary and themes when exporting the Guest Feedback Sentiment tab.

The PDF export intentionally uses the browser print system instead of adding a PDF runtime dependency. Pop-ups must be allowed for the export tab to open.

## API Routes

### `GET /api/admin/analytics?period=Daily`

Returns live data for:

- Booking trend analysis.
- Revenue forecasting input and projection.
- Performance signals.

Supported period values are `Daily`, `Weekly`, and `Monthly`. The route requires an authenticated active staff session.

### `POST /api/admin/analytics`

Request body:

```json
{
  "action": "forecast",
  "period": "Weekly"
}
```

Supported actions:

- `forecast`: recalculates the revenue forecast.
- `sentiment`: analyzes approved guest reviews with Gemini.

Both actions require an authenticated active staff session.

## Data Sources

- `reservations`: booking volume and booking channel.
- `payments`: verified revenue and pending payment queue.
- `reviews`: approved guest feedback for sentiment analysis.
- `audit_logs`: staff and system activity.
- `staff_users`: staff names used when activity is expanded in future reporting views.

All report calculations are performed server-side with the Supabase service-role client after staff authentication has been verified.

## Configuration

Add the Gemini key to the server environment:

```env
GEMINI_API_KEY=your_gemini_api_key
```

The configured model is `gemini-2.5-flash`. If the key is missing, sentiment analysis returns a configuration error while the non-Gemini analytics remain available.

## Maintenance Notes

- Keep database queries and aggregation logic in `app/api/admin/analytics/route.ts`.
- Keep display-only state, chart rendering, and export formatting in `app/admin/(portal)/analytics/page.tsx`.
- Add new analytics tabs to the `AnalyticsTab` union, `analyticsTabs`, `tableConfigs`, API response shape, and server report builder.
- Keep Gemini prompts aggregate-focused and avoid sending guest names, contact details, reservation IDs, or other identifying information.
- If a direct downloadable PDF file is required instead of browser print-to-PDF, add a server PDF library and move document rendering to an authenticated server route.

## Validation

Run the following commands after analytics changes:

```bash
npx eslint "app/admin/(portal)/analytics/page.tsx" app/api/admin/analytics/route.ts
npm run build
```
