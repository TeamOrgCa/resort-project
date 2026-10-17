import { createAdminClient } from "@/lib/supabase/admin";
import { manilaTimestamp } from "@/lib/booking/manila-date";
import { reportBucket, reportWindow } from "@/lib/reports/periods";
import type { ReportDateRange, ReportMetric, ReportPeriod } from "@/lib/reports/types";
import type { AnalyticsReports } from "@/lib/reports/analytics-types";
import { fetchAllPages } from "./fetch-all-pages";

type Reservation = { reservation_id: string; booking_type: string | null; created_at: string };
type Payment = { amount: number; status: string; payment_type: string; created_at: string; verified_at: string | null };
type Audit = { created_at: string };
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const metric = (label: string, value: number, help: string, format: "money" | "count" = "count"): ReportMetric => ({ label, value, help, format });

/** Analytics uses the same Philippine calendar and collection date as Sales Reports. */
export async function generateAnalytics(period: ReportPeriod, range?: ReportDateRange, now = new Date()): Promise<AnalyticsReports> {
  const window = reportWindow(period, range, now);
  const client = createAdminClient();
  const start = window.start.toISOString(), end = window.end.toISOString();
  const [reservations, verified, submissions, audits] = await Promise.all([
    fetchAllPages<Reservation>((from, to) => client.from("reservations").select("reservation_id, booking_type, created_at").gte("created_at", start).lt("created_at", end).order("created_at").order("reservation_id").range(from, to)),
    fetchAllPages<Payment>((from, to) => client.from("payments").select("payment_id, amount, status, payment_type, created_at, verified_at").eq("status", "verified").or(`and(verified_at.gte.${start},verified_at.lt.${end}),and(verified_at.is.null,created_at.gte.${start},created_at.lt.${end})`).order("created_at").order("payment_id").range(from, to)),
    fetchAllPages<Payment>((from, to) => client.from("payments").select("payment_id, amount, status, payment_type, created_at, verified_at").gte("created_at", start).lt("created_at", end).order("created_at").order("payment_id").range(from, to)),
    fetchAllPages<Audit>((from, to) => client.from("audit_logs").select("log_id, created_at").gte("created_at", start).lt("created_at", end).order("created_at").order("log_id").range(from, to)),
  ]);
  const trend = (items: { date: string; value: number }[]) => {
    const totals = window.labels.map(() => 0);
    for (const item of items) { const bucket = reportBucket(item.date, window); if (bucket >= 0) totals[bucket] += item.value; }
    return window.labels.map((label, i) => ({ label, value: Math.round(totals[i] * 100) / 100 }));
  };
  const metadata = { startDate: window.startDate, endDate: window.endDate, generatedAt: manilaTimestamp(now) };
  const bookingTrend = trend(reservations.map(r => ({ date: r.created_at, value: 1 })));
  const online = reservations.filter(r => r.booking_type === "online").length;
  const staff = reservations.filter(r => r.booking_type === "walk_in").length;
  const gross = verified.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const days = (window.end.getTime() - window.start.getTime()) / 86_400_000;
  const horizon = period === "Weekly" ? 7 : period === "Monthly" ? 30 : 1;
  const average = gross / days;
  const projected = Math.round(average * horizon * 100) / 100;
  const revenueTrend = trend(verified.map(p => ({ date: p.verified_at ?? p.created_at, value: Number(p.amount || 0) })));
  const paymentTypes = new Map<string, number>();
  for (const p of verified) {
    const label = p.payment_type === "downpayment" ? "Downpayments" : p.payment_type === "full" ? "Full / balance payments" : p.payment_type === "additional" ? "Additional charges" : "Other payments";
    paymentTypes.set(label, (paymentTypes.get(label) ?? 0) + Number(p.amount || 0));
  }
  const pending = submissions.filter(p => p.status === "pending").length;
  const statuses = new Map<string, number>();
  for (const p of submissions) { const label = p.status === "pending" ? "Awaiting review" : p.status === "verified" ? "Verified" : p.status === "rejected" ? "Rejected" : "Other"; statuses.set(label, (statuses.get(label) ?? 0) + 1); }
  const forecastStart = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }).format(window.end);
  const forecastEnd = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }).format(new Date(window.end.getTime() + (horizon - 1) * 86_400_000));
  return {
    booking: {
      ...metadata, trend: bookingTrend, split: [{ label: "Online", value: online }, { label: "Staff entry", value: staff }, { label: "Unspecified", value: reservations.length - online - staff }],
      trendTitle: "Reservations created over time", splitTitle: "Booking sources", tableTitle: "Reservations by date",
      metrics: [metric("Reservations created", reservations.length, "All reservation statuses, counted by booking creation date."), metric("Online bookings", online, "Reservations created through the website."), metric("Staff-entered bookings", staff, "Includes walk-ins, phone and Messenger bookings entered by staff.")],
      rows: bookingTrend.map((item, index) => ({ id: `booking-${index}`, periodLabel: item.label, periodStart: window.boundaries[index].toISOString(), bookings: String(item.value) })),
      note: "These counts show when bookings were created, including cancelled bookings. They do not measure arrivals, occupancy or the number of guests. Staff entry includes reservations taken outside the website; missing booking sources are shown as Unspecified.",
    },
    revenue: {
      ...metadata, trend: revenueTrend, split: Array.from(paymentTypes, ([label, value]) => ({ label, value })),
      trendTitle: "Actual verified collections over time", splitTitle: "Actual collections by payment type", tableTitle: "Collection estimate",
      metrics: [metric("Actual collections", gross, `${verified.length} verified payments in the selected dates; before refunds.`, "money"), metric("Average per calendar day", average, `Actual collections divided by ${days} selected calendar days, including days with no payments.`, "money"), metric(`Estimated next ${horizon === 1 ? "day" : `${horizon} days`}`, projected, "Historical daily average multiplied by the forecast length. This is an estimate, not a payment received.", "money")],
      rows: [{ id: "forecast", periodLabel: horizon === 1 ? forecastStart : `${forecastStart} – ${forecastEnd}`, projectedBookings: String(Math.round(reservations.length / days * horizon)), projectedRevenue: money(projected), evidence: `${verified.length} verified payments / ${days} calendar days`, method: "Historical daily average" }],
      note: `Estimate = ${money(gross)} ÷ ${days} calendar days × ${horizon} forecast days. The forecast starts after the selected end date, so a past range produces a historical estimate. Today's totals may still change. Collections use the verification date (creation date for older records without one), before refunds. This simple average does not account for holidays, seasonality or cancellations and has no statistical confidence score.${verified.length === 0 ? " No verified payments: the estimate is zero." : verified.length < 5 ? " Limited payment history: treat this estimate with extra care." : ""}`,
    },
    performance: {
      ...metadata, trend: trend(audits.map(a => ({ date: a.created_at, value: 1 }))), split: Array.from(statuses, ([label, value]) => ({ label, value })),
      trendTitle: "Logged activity over time", splitTitle: "Status of payments submitted in this period", tableTitle: "Tasks to check",
      metrics: [metric("Payments awaiting review", pending, "Pending payments submitted in the selected dates. Older pending payments are outside this count."), metric("Payment submissions", submissions.length, "All payment statuses, counted by submission date."), metric("Logged actions", audits.length, "Audit records for these dates; includes system and guest activity.")],
      rows: [{ id: "pending", signal: "Review pending payments", value: String(pending), meaning: pending ? "Open Transactions → Payment Verification to review these submissions." : "No pending submissions within the selected dates." }, { id: "actions", signal: "Recorded activity", value: String(audits.length), meaning: "Open Audit Logs for details. Action counts do not measure staff productivity." }],
      note: "This view summarizes activity within the selected dates, not the entire current payment queue. Payment statuses reflect their current state. Logged actions and payments have different units and are shown in separate charts; there are no arbitrary severity thresholds.",
    },
  };
}
