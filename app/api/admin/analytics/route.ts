import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { customBucketIndex, customTrendBuckets, InvalidDateRangeError, manilaTodayExclusiveEnd, parseCustomDateRange, type CustomDateRange } from "@/lib/server/custom-date-range";
import { fetchAllPages } from "@/lib/server/fetch-all-pages";

type PeriodFilter = "Daily" | "Weekly" | "Monthly" | "Custom";
type AnalyticsAction = "forecast" | "sentiment";

interface ReservationRow {
  reservation_id: string;
  booking_type: "online" | "walk_in" | null;
  created_at: string;
}

interface PaymentRow {
  amount: number;
  status: "pending" | "verified";
  created_at: string;
}

interface ReviewRow {
  review_id: string;
  overall_rating: number;
  title: string;
  review_text: string;
  would_recommend: boolean | null;
  created_at: string;
}

interface AuditRow {
  created_at: string;
}

interface AnalyticsReport {
  trend: { label: string; value: number }[];
  split: { label: string; value: number }[];
  rows: Record<string, string>[];
}

const periodConfig: Record<Exclude<PeriodFilter, "Custom">, { count: number; milliseconds: number }> = {
  Daily: { count: 7, milliseconds: 24 * 60 * 60 * 1000 },
  Weekly: { count: 4, milliseconds: 7 * 24 * 60 * 60 * 1000 },
  Monthly: { count: 6, milliseconds: 30 * 24 * 60 * 60 * 1000 },
};

const parsePeriod = (value: string | null): PeriodFilter =>
  value === "Weekly" || value === "Monthly" || value === "Custom" ? value : "Daily";

const getRange = (period: PeriodFilter, customRange?: CustomDateRange) => {
  if (period === "Custom") {
    if (!customRange) throw new InvalidDateRangeError("Choose a start and end date.");
    return customRange;
  }
  const config = periodConfig[period];
  const end = manilaTodayExclusiveEnd();
  const start = new Date(end.getTime() - config.count * config.milliseconds);
  return { start, end };
};

const getBucketIndex = (value: string, period: PeriodFilter, start: Date, customRange?: CustomDateRange) => {
  if (period === "Custom") return customRange ? customBucketIndex(value, customRange) : -1;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return -1;
  return Math.floor((timestamp - start.getTime()) / periodConfig[period].milliseconds);
};

const getBucketLabels = (period: PeriodFilter, start: Date, customRange?: CustomDateRange) => {
  if (period === "Custom") return customRange ? customTrendBuckets(customRange).labels : [];
  const formatter = period === "Daily"
    ? new Intl.DateTimeFormat("en-PH", { weekday: "short" })
    : period === "Weekly"
      ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" })
      : new Intl.DateTimeFormat("en-PH", { month: "short" });

  return Array.from({ length: periodConfig[period].count }, (_, index) =>
    formatter.format(new Date(start.getTime() + index * periodConfig[period].milliseconds))
  );
};

const createTrend = (period: PeriodFilter, start: Date, values: { date: string; value: number }[], customRange?: CustomDateRange) => {
  const labels = getBucketLabels(period, start, customRange);
  const totals = labels.map(() => 0);

  values.forEach((item) => {
    const index = getBucketIndex(item.date, period, start, customRange);
    if (index >= 0 && index < totals.length) totals[index] += item.value;
  });

  return labels.map((label, index) => ({ label, value: Number(totals[index].toFixed(2)) }));
};

const formatCurrency = (value: number) => `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fetchSourceData = async (period: PeriodFilter, customRange?: CustomDateRange) => {
  const { start, end } = getRange(period, customRange);
  const client = createAdminClient();
  const [reservations, payments, reviewsResult, audits] = await Promise.all([
    fetchAllPages<ReservationRow>((from, to) => client.from("reservations").select("reservation_id, booking_type, created_at").gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).order("created_at").order("reservation_id").range(from, to)),
    fetchAllPages<PaymentRow>((from, to) => client.from("payments").select("amount, status, created_at").gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).order("created_at").order("payment_id").range(from, to)),
    client.from("reviews").select("review_id, overall_rating, title, review_text, would_recommend, created_at").eq("is_approved", true).gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).order("created_at", { ascending: false }).limit(100),
    fetchAllPages<AuditRow>((from, to) => client.from("audit_logs").select("log_id, created_at").gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).order("created_at").order("log_id").range(from, to)),
  ]);

  const error = reviewsResult.error;
  if (error) throw error;

  return {
    start,
    customRange,
    reservations,
    payments,
    reviews: (reviewsResult.data as ReviewRow[] | null) ?? [],
    audits,
  };
};

const buildBookingTrend = (data: Awaited<ReturnType<typeof fetchSourceData>>, period: PeriodFilter): AnalyticsReport => {
  const trend = createTrend(period, data.start, data.reservations.map((reservation) => ({ date: reservation.created_at, value: 1 })), data.customRange);
  const online = data.reservations.filter((reservation) => reservation.booking_type !== "walk_in").length;
  const walkIn = data.reservations.filter((reservation) => reservation.booking_type === "walk_in").length;
  const rows = trend.map((item, index) => ({ id: `booking-${index}`, periodLabel: item.label, bookings: item.value.toString(), channel: "All channels" }));
  return { trend, split: [{ label: "Website", value: online }, { label: "Walk-in", value: walkIn }], rows };
};

const buildRevenueForecast = (data: Awaited<ReturnType<typeof fetchSourceData>>, period: PeriodFilter): AnalyticsReport => {
  const verifiedPayments = data.payments.filter((payment) => payment.status === "verified");
  const trend = createTrend(period, data.start, verifiedPayments.map((payment) => ({ date: payment.created_at, value: Number(payment.amount ?? 0) })), data.customRange);
  const average = trend.reduce((sum, item) => sum + item.value, 0) / Math.max(trend.length, 1);
  const customDays = data.customRange ? (data.customRange.end.getTime() - data.customRange.start.getTime()) / 86_400_000 : null;
  const projected = customDays ? verifiedPayments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0) / customDays :
    average * (period === "Daily" ? 1 : period === "Weekly" ? 7 : 30);
  const rows = [
    { id: "forecast-next", periodLabel: period === "Daily" || period === "Custom" ? "Next 24 hours" : period === "Weekly" ? "Next 7 days" : "Next 30 days", projectedBookings: Math.round(data.reservations.length / (customDays ?? Math.max(trend.length, 1))).toString(), projectedRevenue: formatCurrency(projected), confidence: verifiedPayments.length >= 5 ? "High" : "Limited" },
  ];
  return { trend, split: [{ label: "Historical verified revenue", value: trend.reduce((sum, item) => sum + item.value, 0) }, { label: "Projected next period", value: projected }], rows };
};

const buildPerformanceSignals = (data: Awaited<ReturnType<typeof fetchSourceData>>, period: PeriodFilter): AnalyticsReport => {
  const pendingPayments = data.payments.filter((payment) => payment.status === "pending").length;
  const actionCount = data.audits.length;
  const trend = createTrend(period, data.start, data.audits.map((audit) => ({ date: audit.created_at, value: 1 })), data.customRange);
  const rows = [
    { id: "signal-pending", signal: "Pending Payment Queue", value: pendingPayments.toString(), threshold: "10", severity: pendingPayments > 10 ? "Watch" : "Normal" },
    { id: "signal-actions", signal: "Staff Activity", value: actionCount.toString(), threshold: "0", severity: actionCount > 0 ? "Normal" : "Watch" },
  ];
  return { trend, split: [{ label: "Pending payments", value: pendingPayments }, { label: "Audit actions", value: actionCount }], rows };
};

const parseGeminiJson = (text: string) => {
  const normalized = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(normalized) as Record<string, unknown>;
};

const analyzeSentiment = async (reviews: ReviewRow[]) => {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured.");
  if (reviews.length === 0) return { overallSentiment: "No data", positivePercent: 0, neutralPercent: 0, negativePercent: 0, themes: [], summary: "No approved guest feedback is available." };

  const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: "gemini-2.5-flash" });
  const feedback = reviews.map((review) => ({ rating: review.overall_rating, title: review.title, review: review.review_text, wouldRecommend: review.would_recommend }));
  const prompt = `Analyze this resort guest feedback. Return JSON only with keys overallSentiment, positivePercent, neutralPercent, negativePercent, themes (array of strings), and summary. Percentages must total 100. Do not include personal data. Feedback: ${JSON.stringify(feedback)}`;
  const result = await model.generateContent(prompt);
  return parseGeminiJson((await result.response).text());
};

export async function GET(request: Request) {
  try {
    if (!(await requireActiveStaff())) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
    const url = new URL(request.url);
    const period = parsePeriod(url.searchParams.get("period"));
    const customRange = period === "Custom" ? parseCustomDateRange(url.searchParams.get("startDate"), url.searchParams.get("endDate")) : undefined;
    const data = await fetchSourceData(period, customRange);
    return NextResponse.json({ success: true, reports: { booking: buildBookingTrend(data, period), revenue: buildRevenueForecast(data, period), performance: buildPerformanceSignals(data, period) } });
  } catch (error) {
    if (error instanceof InvalidDateRangeError) return NextResponse.json({ success: false, message: error.message }, { status: 400 });
    return NextResponse.json({ success: false, message: "Failed to load analytics data." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!(await requireActiveStaff())) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
    const body = (await request.json()) as { action?: AnalyticsAction; period?: PeriodFilter; startDate?: string; endDate?: string };
    const period = parsePeriod(body.period ?? null);
    const customRange = period === "Custom" ? parseCustomDateRange(body.startDate, body.endDate) : undefined;
    const data = await fetchSourceData(period, customRange);

    if (body.action === "sentiment") {
      return NextResponse.json({ success: true, sentiment: await analyzeSentiment(data.reviews) });
    }

    if (body.action === "forecast") {
      return NextResponse.json({ success: true, report: buildRevenueForecast(data, period) });
    }

    return NextResponse.json({ success: false, message: "Unsupported analytics action." }, { status: 400 });
  } catch (error) {
    if (error instanceof InvalidDateRangeError) return NextResponse.json({ success: false, message: error.message }, { status: 400 });
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Analytics action failed." }, { status: 500 });
  }
}
