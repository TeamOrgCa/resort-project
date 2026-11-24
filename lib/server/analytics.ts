import { commercialTypeLabel, COMMERCIAL_TYPES } from "@/lib/booking/commercial-types";
import { createAdminClient } from "@/lib/supabase/admin";
import { manilaDateKey, manilaTimestamp, formatManilaDate } from "@/lib/booking/manila-date";
import { reportBucket, reportWindow } from "@/lib/reports/periods";
import type { ReportDateRange, ReportMetric, ReportPeriod } from "@/lib/reports/types";
import type { AnalyticsComparison, AnalyticsReports } from "@/lib/reports/analytics-types";
import { DAY_MS, round, percentage, median, changeLabel, collectionForecast } from "@/lib/reports/analytics-math";
import { fetchAllPages } from "./fetch-all-pages";
import { PUBLIC_ACCESS_TYPES, type PublicAccessType } from "@/lib/public-access/sales";

type Reservation = { reservation_id: string; commercial_type?: string; booking_type: string | null; created_at: string; start_datetime: string; status: string };
type Payment = { payment_id: string; amount: number; status: string; payment_type: string; created_at: string; verified_at: string | null };
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const metric = (label: string, value: number, help: string, format: ReportMetric["format"] = "count"): ReportMetric => ({ label, value: round(value), help, format });
const source = (row: Reservation) => row.booking_type === "online" ? "Online booking" : row.booking_type === "walk_in" ? "Offline booking" : null;
const confirmed = (row: Reservation) => ["confirmed", "completed"].includes(row.status);
const cancelled = (row: Reservation) => ["cancelled", "no_show"].includes(row.status);
const between = (date: string, start: number, end: number) => Date.parse(date) >= start && Date.parse(date) < end;

/** Compare equally long elapsed periods; unfinished days never train the forecast. */
export async function generateAnalytics(period: ReportPeriod, range?: ReportDateRange, now = new Date()): Promise<AnalyticsReports> {
  const window = reportWindow(period, range, now), client = createAdminClient();
  const fullDuration = window.end.getTime() - window.start.getTime();
  const observedEnd = Math.max(window.start.getTime(), Math.min(window.end.getTime(), now.getTime()));
  const previousStart = window.start.getTime() - fullDuration;
  const previousEnd = previousStart + observedEnd - window.start.getTime();
  const today = new Date(`${manilaDateKey(now)}T00:00:00+08:00`).getTime();
  const historyEnd = Math.min(today, window.end.getTime()), historyStart = historyEnd - 56 * DAY_MS;
  const start = new Date(Math.min(previousStart, historyStart)).toISOString();
  const end = new Date(Math.max(observedEnd, historyEnd)).toISOString();
  const [allReservations, privatePayments, submissions, publicSales, backlog] = await Promise.all([
    fetchAllPages<Reservation>((from, to) => client.from("reservations").select("reservation_id,commercial_type,booking_type,created_at,start_datetime,status").gte("created_at", new Date(previousStart).toISOString()).lt("created_at", new Date(observedEnd).toISOString()).order("created_at").order("reservation_id").range(from, to)),
    fetchAllPages<Payment>((from, to) => client.from("payments").select("payment_id,amount,status,payment_type,created_at,verified_at").eq("status", "verified").or(`and(verified_at.gte.${start},verified_at.lt.${end}),and(verified_at.is.null,created_at.gte.${start},created_at.lt.${end})`).order("created_at").order("payment_id").range(from, to)),
    fetchAllPages<Payment>((from, to) => client.from("payments").select("payment_id,amount,status,payment_type,created_at,verified_at").gte("created_at", new Date(previousStart).toISOString()).lt("created_at", new Date(observedEnd).toISOString()).order("created_at").order("payment_id").range(from, to)),
    fetchAllPages<{sale_id:string;amount:number;paid_at:string;access_type:PublicAccessType}>((from,to)=>client.from("public_access_sales").select("sale_id,amount,paid_at,access_type").gte("paid_at",start).lt("paid_at",end).order("paid_at").order("sale_id").range(from,to)),
    fetchAllPages<Payment>((from, to) => client.from("payments").select("payment_id,amount,status,payment_type,created_at,verified_at").eq("status", "pending").lt("created_at", now.toISOString()).order("created_at").order("payment_id").range(from, to)),
  ]);
  const allCollections = [...privatePayments, ...publicSales.map(sale => ({ payment_id: sale.sale_id, amount: sale.amount, status: "verified", payment_type: `public_${sale.access_type}`, created_at: sale.paid_at, verified_at: sale.paid_at }))];
  const collectionDate = (payment: Payment) => payment.verified_at ?? payment.created_at;
  const current = <T,>(rows: T[], date: (row: T) => string) => rows.filter(row => between(date(row), window.start.getTime(), observedEnd));
  const previous = <T,>(rows: T[], date: (row: T) => string) => rows.filter(row => between(date(row), previousStart, previousEnd));
  const reservations = current(allReservations, row => row.created_at), priorReservations = previous(allReservations, row => row.created_at);
  const verified = current(allCollections, collectionDate), priorCollections = previous(allCollections, collectionDate);
  const cohort = current(submissions, row => row.created_at), priorCohort = previous(submissions, row => row.created_at);
  const total = (rows: Payment[]) => round(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const gross = total(verified), priorGross = total(priorCollections);
  const metadata = { startDate: window.startDate, endDate: window.endDate, generatedAt: manilaTimestamp(now) };
  const buckets = <T,>(rows: T[], date: (row: T) => string, value: (row: T) => number, offset = 0) => {
    const totals = window.labels.map(() => 0);
    for (const row of rows) {
      const bucket = reportBucket(new Date(Date.parse(date(row)) + offset).toISOString(), window);
      if (bucket >= 0) totals[bucket] += value(row);
    }
    return totals.map(round);
  };
  const comparison = (values: (number | null)[], prior: (number | null)[], format: AnalyticsComparison["format"]): AnalyticsComparison => ({
    startDate: manilaDateKey(new Date(previousStart)), endDate: manilaDateKey(new Date(Math.max(previousStart, previousEnd - 1))), observedThrough: manilaTimestamp(new Date(Math.min(now.getTime(), observedEnd))), format,
    points: window.labels.map((label, i) => ({ label, current: window.boundaries[i].getTime() < observedEnd ? values[i] : null, previous: window.boundaries[i].getTime() < observedEnd ? prior[i] : null })),
  });
  const comparisonNote = observedEnd === window.start.getTime() ? "The selected dates have not started; no observed comparison is available." : `Compared with ${manilaDateKey(new Date(previousStart))} through ${manilaDateKey(new Date(Math.max(previousStart, previousEnd - 1)))} over the same elapsed duration. Current data stops at ${manilaTimestamp(new Date(observedEnd))}; a partial current day is compared with the same elapsed time in the earlier period.`;
  const bookingValues = buckets(reservations, row => row.created_at, () => 1);
  const bookingPrior = buckets(priorReservations, row => row.created_at, () => 1, fullDuration);
  const sources = ["Online booking", "Offline booking"];
  const sourcedCount = reservations.filter(row => source(row) !== null).length;
  const rates = (rows: Reservation[]) => ({ confirmed: percentage(rows.filter(confirmed).length, rows.length), cancelled: percentage(rows.filter(cancelled).length, rows.length) });
  const bookingRates = rates(reservations), priorRates = rates(priorReservations);
  const leadTimes = reservations.flatMap(row => {
    if (!row.start_datetime || !Number.isFinite(Date.parse(row.start_datetime))) return [];
    const lead = (Date.parse(`${manilaDateKey(row.start_datetime)}T00:00:00+08:00`) - Date.parse(`${manilaDateKey(row.created_at)}T00:00:00+08:00`)) / DAY_MS;
    return lead >= 0 ? [lead] : [];
  });
  const lead = median(leadTimes);
  const leadingSource = sources.map(label => ({ label, count: reservations.filter(row => source(row) === label).length })).sort((a, b) => b.count - a.count)[0];
  const history = Array.from({ length: 56 }, (_, index) => ({ date: manilaDateKey(new Date(historyStart + index * DAY_MS)), value: 0 }));
  for (const row of allCollections) {
    const index = Math.floor((Date.parse(collectionDate(row)) - historyStart) / DAY_MS);
    if (index >= 0 && index < history.length) history[index].value += Number(row.amount || 0);
  }
  const horizon = period === "Monthly" ? 30 : period === "Weekly" ? 7 : period === "Custom" ? Math.min(30, fullDuration / DAY_MS) : 1;
  const forecast = collectionForecast(history, window.end, horizon);
  const revenueValues = buckets(verified, collectionDate, row => Number(row.amount || 0));
  const revenuePrior = buckets(priorCollections, collectionDate, row => Number(row.amount || 0), fullDuration);
  const paymentTypes = new Map<string, number>();
  for (const row of verified) {
    const label = row.payment_type.startsWith("public_") ? PUBLIC_ACCESS_TYPES[row.payment_type.slice(7) as PublicAccessType] ?? "Public access" : row.payment_type === "downpayment" ? "Downpayments" : row.payment_type === "full" ? "Full / balance payments" : row.payment_type === "additional" ? "Additional charges" : "Other payments";
    paymentTypes.set(label, (paymentTypes.get(label) ?? 0) + Number(row.amount || 0));
  }
  const resolved = (rows: Payment[]) => rows.filter(row => ["verified", "rejected"].includes(row.status)).length;
  const verificationHours = (rows: Payment[]) => median(rows.flatMap(row => {
    const hours = row.status === "verified" && row.verified_at ? (Date.parse(row.verified_at) - Date.parse(row.created_at)) / 3600000 : NaN;
    return Number.isFinite(hours) && hours >= 0 ? [hours] : [];
  }));
  const medianHours = verificationHours(cohort), priorHours = verificationHours(priorCohort);
  const resolutionRate = percentage(resolved(cohort), cohort.length), previousResolution = percentage(resolved(priorCohort), priorCohort.length);
  const bucketRate = (rows: Payment[], offset = 0) => {
    const counts = buckets(rows, row => row.created_at, () => 1, offset);
    const done = buckets(rows.filter(row => ["verified", "rejected"].includes(row.status)), row => row.created_at, () => 1, offset);
    return counts.map((count, i) => count ? percentage(done[i], count) : null);
  };
  const aging = [{ label: "Under 24 hours", min: 0, max: 24 }, { label: "24 to under 72 hours", min: 24, max: 72 }, { label: "72 hours or more", min: 72, max: Infinity }].map(group => ({
    ...group, rows: backlog.filter(row => { const hours = (now.getTime() - Date.parse(row.created_at)) / 3600000; return hours >= group.min && hours < group.max; }),
  }));
  const oldest = backlog.reduce((hours, row) => Math.max(hours, (now.getTime() - Date.parse(row.created_at)) / 3600000), 0);
  const allZero = forecast.activeDays === 0;
  return {
    booking: {
      ...metadata, trend: bookingValues.map((value, i) => ({ label: window.labels[i], value })), split: Object.values(COMMERCIAL_TYPES).map(label => ({ label, value: reservations.filter(row => commercialTypeLabel(row.commercial_type) === label).length })),
      trendTitle: "Booking demand versus previous period", splitTitle: "Reservation types", tableTitle: "Booking source performance", comparison: comparison(bookingValues, bookingPrior, "count"),
      metrics: [metric("Reservations created", reservations.length, changeLabel(reservations.length, priorReservations.length)), { ...metric("Confirmed or completed", bookingRates.confirmed, `${reservations.filter(confirmed).length} of ${reservations.length}; previously ${priorReservations.length ? `${priorRates.confirmed}%` : "no bookings"}. Based on current status.`, "percent"), ...(!reservations.length ? { displayValue: "No bookings" } : {}) }, { ...metric("Cancelled or no-show", bookingRates.cancelled, `${reservations.filter(cancelled).length} of ${reservations.length}; previously ${priorReservations.length ? `${priorRates.cancelled}%` : "no bookings"}.`, "percent"), ...(!reservations.length ? { displayValue: "No bookings" } : {}) }],
      insights: [
        { title: "Demand movement", description: `${reservations.length} reservations versus ${priorReservations.length} in the comparable period. ${changeLabel(reservations.length, priorReservations.length)}.` },
        { title: "Booking lead time", description: lead === null ? "No usable arrival dates to calculate advance-booking behaviour." : `Half of these bookings were made at least ${lead} calendar days before swimming (${leadTimes.length} usable records). Use this booking window when timing availability announcements.` },
        { title: "Channel contribution", description: leadingSource.count ? `${leadingSource.label} supplied ${percentage(leadingSource.count, sourcedCount)}% of bookings with a recorded source. Compare source growth and cancellation shares below before deciding which channel needs attention.` : "No online or offline booking sources were recorded in the selected elapsed dates; channel performance cannot be compared yet." },
      ],
      rows: sources.map(label => { const rows = reservations.filter(row => source(row) === label), prior = priorReservations.filter(row => source(row) === label), rate = rates(rows); return { id: label, source: label, current: String(rows.length), previous: String(prior.length), change: changeLabel(rows.length, prior.length), confirmationRate: rows.length ? `${rate.confirmed}%` : "No bookings", cancellationRate: rows.length ? `${rate.cancelled}%` : "No bookings" }; }),
      note: `${comparisonNote} Bookings are grouped by creation date, including cancelled and expired records. Confirmation and cancellation shares describe today's status of each creation cohort; newer bookings have had less time to finish. These are not occupancy rates. The type chart includes Private Swimming, Public Swimming and Room Accommodation. The source table compares online and offline channels; overall totals include every booking.`,
    },
    revenue: {
      ...metadata, trend: revenueValues.map((value, i) => ({ label: window.labels[i], value })), split: Array.from(paymentTypes, ([label, value]) => ({ label, value: round(value) })),
      trendTitle: "Collections versus previous period", splitTitle: "Collection mix", tableTitle: "Collection forecast scenarios", comparison: comparison(revenueValues, revenuePrior, "money"), forecastPoints: forecast.points,
      metrics: [metric("Actual collections", gross, changeLabel(gross, priorGross), "money"), metric(`Estimated next ${horizon} ${horizon === 1 ? "day" : "days"}`, forecast.estimate, `${forecast.method}; uses 56 complete Philippine calendar days before the selected end date or today, whichever comes first.`, "money"), { ...metric("Typical daily forecast error", forecast.backtest?.mae ?? 0, forecast.backtest ? "Mean absolute error from predicting the final 7 historical days using only earlier history. Lower means estimates were closer." : "Need at least 14 calendar days and 7 earlier days with collections for a held-out check.", "money"), ...(!forecast.backtest ? { displayValue: "Not enough history" } : {}) }],
      insights: [
        { title: "Collection movement", description: `${money(gross)} collected versus ${money(priorGross)} previously. ${changeLabel(gross, priorGross)}. Standalone public access and verified private-swimming, public-swimming and room-accommodation payments are included, before refunds.` },
        { title: "Evidence behind the estimate", description: `${forecast.activeDays} of 56 complete days had collections. ${forecast.method}. ${allZero ? "No received payments: the estimate is zero." : forecast.activeDays < 14 ? "Limited active history: do not treat this estimate as a sales target." : "Weekday patterns influence the estimate; holidays and special events are not modelled."}` },
        { title: "Historical forecast check", description: forecast.backtest ? `Held-out actual collections: ${money(forecast.backtest.actual)}; estimated: ${money(forecast.backtest.estimated)}. Average daily absolute error: ${money(forecast.backtest.mae)}. The held-out days were not used to fit that test.` : "Not enough active history for a useful held-out check. Forecast quality has not yet been established." },
      ],
      rows: [
        ...(forecast.lower === null ? [] : [{ id: "lower", scenario: "Lower historical activity", projectedRevenue: money(forecast.lower), evidence: "25th percentile of historical rolling collection totals", method: "Activity scenario; not a confidence bound" }]),
        { id: "pattern", scenario: "Recent daily pattern", projectedRevenue: money(forecast.estimate), evidence: `${forecast.activeDays} collection days / 56 calendar days`, method: forecast.method },
        ...(forecast.upper === null ? [] : [{ id: "higher", scenario: "Higher historical activity", projectedRevenue: money(forecast.upper), evidence: "75th percentile of historical rolling collection totals", method: "Activity scenario; not a confidence bound" }]),
      ],
      note: `${comparisonNote} Forecast dates: ${formatManilaDate(window.end)} through ${formatManilaDate(new Date(window.end.getTime() + (horizon - 1) * DAY_MS))}. Historical training excludes unfinished days and counts days with no collections as zero. Reservation collections use the verification date (creation date for older records without one); public collections use the server-recorded paid-at date. Scenarios use rolling ${horizon}-day historical totals; they are not statistical confidence intervals. Estimates exclude refunds, holidays, special events and future cancellations, and are not guaranteed income.`,
    },
    performance: {
      ...metadata, trend: bucketRate(cohort).map((value, i) => ({ label: window.labels[i], value: value ?? 0 })), split: aging.map(group => ({ label: group.label, value: group.rows.length })), trendFormat: "percent",
      trendTitle: "Payment resolution versus previous period", splitTitle: "Age of all currently pending payments", tableTitle: "Payment backlog and follow-up", comparison: comparison(bucketRate(cohort), bucketRate(priorCohort, fullDuration), "percent"),
      metrics: [{ ...metric("Payment resolution rate", resolutionRate, `${resolved(cohort)} of ${cohort.length} submissions verified or rejected; previously ${priorCohort.length ? `${previousResolution}%` : "no submissions"}. Based on current statuses.`, "percent"), ...(!cohort.length ? { displayValue: "No submissions" } : {}) }, { ...metric("Median verification (hours)", medianHours ?? 0, medianHours === null ? "No usable verification timestamps in this submission cohort." : `${medianHours} hours from submission to approval; ${priorHours === null ? "no previous comparison" : `${priorHours} hours previously`}. Rejected payments have no recorded resolution timestamp.`), ...(medianHours === null ? { displayValue: "Not available" } : {}) }, metric("All pending payment amount", total(backlog), `${backlog.length} payments currently awaiting verification, including older submissions outside the selected dates. Not yet collected revenue.`, "money")],
      insights: [
        { title: "Processing movement", description: cohort.length && priorCohort.length ? `Resolution share changed by ${round(resolutionRate - previousResolution)} percentage points. These are current statuses of submissions created in each period; newer submissions have had less time to resolve.` : "A comparable resolution rate needs payment submissions in both periods. No percentage improvement is claimed for an empty cohort." },
        { title: "Oldest unresolved payment", description: backlog.length ? `The oldest pending submission is ${round(oldest)} hours old. Review proof and the actual transaction before approving; the pending amount is not verified income.` : "There are no pending payment submissions as of this refresh.", href: "/admin/transactions?tab=payments", action: "Review payment queue" },
        { title: "Bottleneck to investigate", description: aging[2].rows.length ? `${aging[2].rows.length} payments have waited 72 hours or more. Start with the oldest submissions and check whether missing proof or transaction details are delaying verification.` : "No pending submissions have waited 72 hours or more. Use the age groups below to prioritize follow-up." },
      ],
      rows: aging.map(group => ({ id: group.label, age: group.label, pending: String(group.rows.length), amount: money(total(group.rows)), meaning: group.rows.length ? "Verify the actual transaction and proof in Transactions; resolve oldest submissions first." : "No pending submissions in this age group." })),
      note: `${comparisonNote} The trend compares resolved shares of reservation payment submission cohorts; a zero with no submissions is not a measured success rate. Backlog age and amount are a live snapshot of all reservation payments still pending as of ${manilaTimestamp(now)}, regardless of the date filter. Cashier-recorded public access sales are received collections and do not enter this approval queue. Verification time uses valid non-negative submission-to-verification durations only.`,
    },
  };
}
