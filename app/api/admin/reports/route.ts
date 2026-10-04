import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { customBucketIndex, customTrendBuckets, InvalidDateRangeError, manilaTodayExclusiveEnd, parseCustomDateRange, type CustomDateRange } from "@/lib/server/custom-date-range";
import { fetchAllPages } from "@/lib/server/fetch-all-pages";

type PeriodFilter = "Daily" | "Weekly" | "Monthly" | "Custom";
type ReportTab = "Sales Report" | "Financial Report" | "Guest Report" | "Staff Report";

interface PaymentRow {
  payment_id: string;
  reservation_id: string;
  amount: number;
  payment_type: "downpayment" | "full" | "additional";
  status: "pending" | "verified";
  created_at: string;
}

interface TransactionRow {
  reservation_id: string;
  total_amount: number;
  paid_amount: number | null;
  created_at: string;
}

interface ReservationRow {
  reservation_id: string;
  guest_id: string | null;
  booking_type: "online" | "walk_in" | null;
  adult_count: number;
  child_count: number;
  created_at: string;
}

interface GuestRow {
  id: string;
  created_at: string;
}

interface AuditRow {
  log_id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  created_at: string;
}

interface StaffRow {
  id: string;
  full_name: string;
}

interface ReportResponse {
  trend: { label: string; value: number }[];
  split: { label: string; value: number }[];
  rows: Record<string, unknown>[];
}

const periodConfig: Record<Exclude<PeriodFilter, "Custom">, { bucketCount: number; bucketMs: number }> = {
  Daily: { bucketCount: 7, bucketMs: 24 * 60 * 60 * 1000 },
  Weekly: { bucketCount: 4, bucketMs: 7 * 24 * 60 * 60 * 1000 },
  Monthly: { bucketCount: 6, bucketMs: 30 * 24 * 60 * 60 * 1000 },
};

// Keep period parsing at the API boundary so the report builders only handle valid filters.
const parsePeriod = (value: string | null): PeriodFilter =>
  value === "Weekly" || value === "Monthly" || value === "Custom" ? value : "Daily";

const parseTab = (value: string | null): ReportTab => {
  if (value === "Financial Report" || value === "Guest Report" || value === "Staff Report") {
    return value;
  }
  return "Sales Report";
};

const toNumber = (value: number | null | undefined) => Number(value ?? 0);

const getRange = (period: PeriodFilter, customRange?: CustomDateRange) => {
  if (period === "Custom") {
    if (!customRange) throw new InvalidDateRangeError("Choose a start and end date.");
    return customRange;
  }
  const config = periodConfig[period];
  const end = manilaTodayExclusiveEnd();
  const start = new Date(end.getTime() - config.bucketCount * config.bucketMs);
  return { start, end };
};

const getBucketIndex = (dateValue: string, period: PeriodFilter, start: Date, customRange?: CustomDateRange) => {
  if (period === "Custom") return customRange ? customBucketIndex(dateValue, customRange) : -1;
  const date = new Date(dateValue).getTime();
  if (Number.isNaN(date)) return -1;
  return Math.floor((date - start.getTime()) / periodConfig[period].bucketMs);
};

const getBucketLabels = (period: PeriodFilter, start: Date, customRange?: CustomDateRange) => {
  if (period === "Custom") return customRange ? customTrendBuckets(customRange).labels : [];
  const formatter = period === "Daily"
    ? new Intl.DateTimeFormat("en-PH", { weekday: "short" })
    : period === "Weekly"
      ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" })
      : new Intl.DateTimeFormat("en-PH", { month: "short" });

  return Array.from({ length: periodConfig[period].bucketCount }, (_, index) =>
    formatter.format(new Date(start.getTime() + index * periodConfig[period].bucketMs))
  );
};

const createTrend = (
  period: PeriodFilter,
  start: Date,
  values: { date: string; value: number }[],
  customRange?: CustomDateRange
) => {
  const labels = getBucketLabels(period, start, customRange);
  const totals = labels.map(() => 0);

  values.forEach((item) => {
    const index = getBucketIndex(item.date, period, start, customRange);
    if (index >= 0 && index < totals.length) totals[index] += item.value;
  });

  return labels.map((label, index) => ({ label, value: Number(totals[index].toFixed(2)) }));
};

// Load the shared source rows once; each report builder then derives its own projection.
const fetchReportData = async (period: PeriodFilter, customRange?: CustomDateRange) => {
  const { start, end } = getRange(period, customRange);
  const client = createAdminClient();
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const [payments, transactions, reservations, guests, audits] = await Promise.all([
    fetchAllPages<PaymentRow>((from, to) => client.from("payments").select("payment_id, reservation_id, amount, payment_type, status, created_at").gte("created_at", startIso).lt("created_at", endIso).order("created_at").order("payment_id").range(from, to)),
    fetchAllPages<TransactionRow>((from, to) => client.from("transactions").select("reservation_id, total_amount, paid_amount, created_at").gte("created_at", startIso).lt("created_at", endIso).order("created_at").order("reservation_id").range(from, to)),
    fetchAllPages<ReservationRow>((from, to) => client.from("reservations").select("reservation_id, guest_id, booking_type, adult_count, child_count, created_at").gte("created_at", startIso).lt("created_at", endIso).order("created_at").order("reservation_id").range(from, to)),
    fetchAllPages<GuestRow>((from, to) => client.from("guests").select("id, created_at").gte("created_at", startIso).lt("created_at", endIso).order("created_at").order("id").range(from, to)),
    fetchAllPages<AuditRow>((from, to) => client.from("audit_logs").select("log_id, user_id, action, entity_type, created_at").gte("created_at", startIso).lt("created_at", endIso).order("created_at").order("log_id").range(from, to)),
  ]);

  return {
    start,
    end,
    customRange,
    payments,
    transactions,
    reservations,
    guests,
    audits,
  };
};

// Sales revenue is based on verified payments, while booking volume comes from reservations.
const buildSalesReport = (data: Awaited<ReturnType<typeof fetchReportData>>, period: PeriodFilter): ReportResponse => {
  const verifiedPayments = data.payments.filter((payment) => payment.status === "verified");
  const trend = createTrend(period, data.start, verifiedPayments.map((payment) => ({ date: payment.created_at, value: toNumber(payment.amount) })), data.customRange);
  const rows = trend.map((item, index) => ({
    id: `sales-${index}`,
    label: item.label,
    revenue: `₱${item.value.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
    bookings: data.reservations.filter((reservation) => getBucketIndex(reservation.created_at, period, data.start, data.customRange) === index).length.toString(),
  }));
  return { trend, split: [{ label: "Verified Revenue", value: verifiedPayments.reduce((sum, payment) => sum + toNumber(payment.amount), 0) }], rows };
};

// Financial rows separate received money from pending submissions and current balances.
const buildFinancialReport = (data: Awaited<ReturnType<typeof fetchReportData>>, period: PeriodFilter): ReportResponse => {
  const verified = data.payments.filter((payment) => payment.status === "verified");
  const pending = data.payments.filter((payment) => payment.status === "pending");
  const trend = createTrend(period, data.start, verified.map((payment) => ({ date: payment.created_at, value: toNumber(payment.amount) })), data.customRange);
  const received = verified.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
  const pendingAmount = pending.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
  const outstanding = data.transactions.reduce((sum, transaction) => sum + Math.max(toNumber(transaction.total_amount) - toNumber(transaction.paid_amount), 0), 0);
  const rows = ["downpayment", "full", "additional"].map((type) => {
    const receivedForType = verified.filter((payment) => payment.payment_type === type).reduce((sum, payment) => sum + toNumber(payment.amount), 0);
    const pendingForType = pending.filter((payment) => payment.payment_type === type).reduce((sum, payment) => sum + toNumber(payment.amount), 0);
    return { id: `financial-${type}`, item: type === "downpayment" ? "Downpayments" : type === "full" ? "Full Payments" : "Additional Payments", received: `₱${receivedForType.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`, outstanding: `₱${pendingForType.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`, status: pendingForType > 0 ? "Pending review" : "Recorded" };
  });
  return { trend, split: [{ label: "Received", value: received }, { label: "Pending", value: pendingAmount }, { label: "Outstanding", value: outstanding }], rows };
};

// Guest segments are derived from reservation guest IDs and guest creation dates.
const buildGuestReport = (data: Awaited<ReturnType<typeof fetchReportData>>, period: PeriodFilter): ReportResponse => {
  const guestIds = new Set(data.reservations.map((reservation) => reservation.guest_id).filter((id): id is string => Boolean(id)));
  const newGuests = data.guests.filter((guest) => guestIds.has(guest.id) && new Date(guest.created_at) >= data.start && new Date(guest.created_at) < data.end).length;
  const returningGuests = Math.max(guestIds.size - newGuests, 0);
  const totalGuests = data.reservations.reduce((sum, reservation) => sum + reservation.adult_count + reservation.child_count, 0);
  const trend = createTrend(period, data.start, data.reservations.map((reservation) => ({ date: reservation.created_at, value: 1 })), data.customRange);
  return { trend, split: [{ label: "New Guests", value: newGuests }, { label: "Returning Guests", value: returningGuests }], rows: [{ id: "guest-new", segment: "New Guests", count: newGuests.toString() }, { id: "guest-returning", segment: "Returning Guests", count: returningGuests.toString() }, { id: "guest-visitors", segment: "Total Visitors", count: totalGuests.toString() }] };
};

// Audit logs provide an implementation-independent activity report for every staff module.
const buildStaffReport = async (data: Awaited<ReturnType<typeof fetchReportData>>, period: PeriodFilter): Promise<ReportResponse> => {
  const staffIds = [...new Set(data.audits.map((audit) => audit.user_id).filter((id): id is string => Boolean(id)))];
  const client = createAdminClient();
  const { data: staffData, error } = staffIds.length ? await client.from("staff_users").select("id, full_name").in("id", staffIds) : { data: [], error: null };
  if (error) throw error;
  const staffNames = new Map(((staffData as StaffRow[] | null) ?? []).map((staff) => [staff.id, staff.full_name]));
  const trend = createTrend(period, data.start, data.audits.map((audit) => ({ date: audit.created_at, value: 1 })), data.customRange);
  const byStaff = data.audits.reduce<Record<string, number>>((counts, audit) => { const name = audit.user_id ? staffNames.get(audit.user_id) ?? "Unknown Staff" : "System"; counts[name] = (counts[name] ?? 0) + 1; return counts; }, {});
  const rows = Object.entries(byStaff).map(([staff, actions], index) => ({ id: `staff-${index}`, staff, actions: actions.toString() }));
  const moduleCounts = data.audits.reduce<Record<string, number>>((counts, audit) => { const entity = audit.entity_type ?? "general"; counts[entity] = (counts[entity] ?? 0) + 1; return counts; }, {});
  return { trend, split: Object.entries(moduleCounts).map(([label, value]) => ({ label, value })), rows };
};

export async function GET(request: Request) {
  try {
    if (!(await requireActiveStaff())) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
    const url = new URL(request.url);
    const period = parsePeriod(url.searchParams.get("period"));
    const customRange = period === "Custom" ? parseCustomDateRange(url.searchParams.get("startDate"), url.searchParams.get("endDate")) : undefined;
    const tab = parseTab(url.searchParams.get("tab"));
    const data = await fetchReportData(period, customRange);
    const report = tab === "Sales Report" ? buildSalesReport(data, period) : tab === "Financial Report" ? buildFinancialReport(data, period) : tab === "Guest Report" ? buildGuestReport(data, period) : await buildStaffReport(data, period);
    return NextResponse.json({ success: true, report });
  } catch (error) {
    if (error instanceof InvalidDateRangeError) return NextResponse.json({ success: false, message: error.message }, { status: 400 });
    return NextResponse.json({ success: false, message: "Failed to generate report." }, { status: 500 });
  }
}
