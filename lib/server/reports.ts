import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { InvalidDateRangeError } from "@/lib/server/custom-date-range";
import { manilaTimestamp } from "@/lib/booking/manila-date";
import { fetchAllPages } from "@/lib/server/fetch-all-pages";
import { parseReportPeriod, reportBucket, reportWindow } from "@/lib/reports/periods";
import type { ReportData, ReportMetric, ReportRow, ReportTab } from "@/lib/reports/types";
export type { ReportTab } from "@/lib/reports/types";

type Window = ReturnType<typeof reportWindow>;
type Client = ReturnType<typeof createAdminClient>;
type Payment = { payment_id: string; amount: number; payment_type: string; created_at: string; verified_at: string | null };
type Reservation = { reservation_id: string; guest_id: string | null; walk_in_guest_id: string | null; reference_number: string; booking_type: string | null; adult_count: number; child_count: number; status: string; start_datetime: string; created_at: string };
type Guest = { id: string; first_name: string; last_name: string; phone_number: string; email: string };
type WalkIn = Omit<Guest, "id"> & { walk_in_guest_id: string };
type PriorBooking = { guest_id: string | null; walk_in_guest_id: string | null };
type Audit = { log_id: string; user_id: string | null; auth_user_id: string | null; action: string; entity_type: string | null; created_at: string };
type Staff = { id: string; full_name: string };
const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const rounded = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const title = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
const metric = (label: string, value: number, help: string, format: ReportMetric["format"] = "count"): ReportMetric => ({ label, value, help, format });
const statusLabels: Record<string, string> = { pending: "Awaiting payment", payment_submitted: "Payment under review", reschedule_requested: "Reschedule requested" };
const profileKey = (r: PriorBooking) => r.guest_id ? `guest:${r.guest_id}` : r.walk_in_guest_id ? `walk-in:${r.walk_in_guest_id}` : null;
const formatTime = (value: string) => Number.isFinite(Date.parse(value)) ? dateTime.format(new Date(value)) : "Unavailable";

function trend(window: Window, records: { date: string; value: number }[]) {
  const totals = window.labels.map(() => 0);
  for (const record of records) { const index = reportBucket(record.date, window); if (index >= 0) totals[index] += record.value; }
  return window.labels.map((label, index) => ({ label, value: rounded(totals[index]) }));
}
const base = (window: Window, now: Date) => ({ startDate: window.startDate, endDate: window.endDate, generatedAt: manilaTimestamp(now) });

/** Chunk lookups and paginate history so PostgREST limits never truncate totals. */
async function byIds<T>(client: Client, table: string, columns: string, idColumn: string, ids: string[], before?: string): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    rows.push(...await fetchAllPages<T>(async (from, to) => {
      let query = client.from(table).select(columns).in(idColumn, ids.slice(i, i + 200));
      if (before) query = query.lt("created_at", before).order("reservation_id");
      else query = query.order(idColumn);
      const result = await query.range(from, to);
      return { data: result.data as unknown as T[] | null, error: result.error };
    }));
  }
  return rows;
}
async function reservations(client: Client, window: Window) {
  return fetchAllPages<Reservation>((from, to) => client.from("reservations")
    .select("reservation_id, guest_id, walk_in_guest_id, reference_number, booking_type, adult_count, child_count, status, start_datetime, created_at")
    .gte("created_at", window.start.toISOString()).lt("created_at", window.end.toISOString()).order("created_at").order("reservation_id").range(from, to));
}

async function salesReport(client: Client, window: Window, now: Date): Promise<ReportData> {
  const start = window.start.toISOString(), end = window.end.toISOString();
  const [payments, bookings] = await Promise.all([
    fetchAllPages<Payment>((from, to) => client.from("payments").select("payment_id, amount, payment_type, created_at, verified_at")
      .eq("status", "verified").or(`and(verified_at.gte.${start},verified_at.lt.${end}),and(verified_at.is.null,created_at.gte.${start},created_at.lt.${end})`)
      .order("created_at").order("payment_id").range(from, to)), reservations(client, window),
  ]);
  const values = trend(window, payments.map(p => ({ date: p.verified_at ?? p.created_at, value: number(p.amount) })));
  const counts = trend(window, payments.map(p => ({ date: p.verified_at ?? p.created_at, value: 1 })));
  const bookingCounts = trend(window, bookings.map(r => ({ date: r.created_at, value: 1 })));
  const byType = new Map<string, number>();
  const types: Record<string, string> = { downpayment: "Down payments", full: "Full / balance payments", additional: "Additional payments" };
  for (const p of payments) { const label = types[p.payment_type] ?? "Other payments"; byType.set(label, (byType.get(label) ?? 0) + number(p.amount)); }
  return { ...base(window, now), trend: values, split: [...byType].map(([label, value]) => ({ label, value: rounded(value) })),
    metrics: [metric("Payments collected", rounded(payments.reduce((sum, p) => sum + number(p.amount), 0)), "Verified payments before refunds", "money"), metric("Verified payments", payments.length, "Payments approved during these dates"), metric("Reservations created", bookings.length, "All reservation statuses included")],
    rows: values.map((item, index) => ({ id: `sales-${index}`, label: item.label, periodStart: window.boundaries[index].toISOString(), revenue: money.format(item.value), payments: String(counts[index].value), bookings: String(bookingCounts[index].value) })),
    note: "Collections use the payment approval date; legacy payments without that date use their submission date. Refunds are separate from these gross collections. Booking counts use reservation creation dates and include all statuses.",
  };
}

async function guestReport(client: Client, window: Window, now: Date): Promise<ReportData> {
  const bookings = await reservations(client, window);
  const guestIds = [...new Set(bookings.flatMap(r => r.guest_id ? [r.guest_id] : []))];
  const walkInIds = [...new Set(bookings.flatMap(r => !r.guest_id && r.walk_in_guest_id ? [r.walk_in_guest_id] : []))];
  const [guests, walkIns, priorGuests, priorWalkIns] = await Promise.all([
    byIds<Guest>(client, "guests", "id, first_name, last_name, phone_number, email", "id", guestIds),
    byIds<WalkIn>(client, "walk_in_guests", "walk_in_guest_id, first_name, last_name, phone_number, email", "walk_in_guest_id", walkInIds),
    byIds<PriorBooking>(client, "reservations", "guest_id, walk_in_guest_id", "guest_id", guestIds, window.start.toISOString()),
    byIds<PriorBooking>(client, "reservations", "guest_id, walk_in_guest_id", "walk_in_guest_id", walkInIds, window.start.toISOString()),
  ]);
  const profiles = new Map<string, Guest | WalkIn>([...guests.map(g => [`guest:${g.id}`, g] as const), ...walkIns.map(g => [`walk-in:${g.walk_in_guest_id}`, g] as const)]);
  const keys = new Set(bookings.map(profileKey).filter((key): key is string => key !== null));
  const returning = new Set([...priorGuests, ...priorWalkIns].map(profileKey).filter((key): key is string => key !== null));
  const returningCount = [...keys].filter(key => returning.has(key)).length;
  const online = bookings.filter(r => r.booking_type === "online").length;
  const staffEntry = bookings.filter(r => r.booking_type === "walk_in").length;
  const rows: ReportRow[] = bookings.map(r => {
    const key = profileKey(r), guest = key ? profiles.get(key) : undefined;
    return { id: r.reservation_id, reference: r.reference_number, guest: guest ? `${guest.first_name} ${guest.last_name}`.trim() : "Profile unavailable", phone: guest?.phone_number || "—", email: guest?.email || "—", source: r.booking_type === "online" ? "Online" : r.booking_type === "walk_in" ? "Staff entry" : "Unspecified", status: statusLabels[r.status] ?? title(r.status), guests: String(number(r.adult_count) + number(r.child_count)), startAt: formatTime(r.start_datetime), startSort: r.start_datetime, createdAt: formatTime(r.created_at), createdSort: r.created_at, history: key ? returning.has(key) ? "Returning booker" : "First-time booker" : "Profile unavailable" };
  });
  return { ...base(window, now), rows, trend: trend(window, bookings.map(r => ({ date: r.created_at, value: 1 }))), split: [{ label: "Online", value: online }, { label: "Staff entry", value: staffEntry }, { label: "Unspecified", value: bookings.length - online - staffEntry }],
    metrics: [metric("Reservations created", bookings.length, "All statuses, including cancelled bookings"), metric("Booked headcount", bookings.reduce((sum, r) => sum + number(r.adult_count) + number(r.child_count), 0), "Adults and children on those reservations"), metric("First-time bookers", keys.size - returningCount, "Guest profiles with no reservation before this period"), metric("Returning bookers", returningCount, "Guest profiles with an earlier reservation")],
    note: "Dates filter when a reservation was created. Scheduled arrival appears in the table. Headcount includes every reservation status. First-time and returning totals count distinct guest profiles, including walk-ins, based on reservations before the selected period.",
  };
}

async function staffReport(client: Client, window: Window, now: Date): Promise<ReportData> {
  const audits = await fetchAllPages<Audit>((from, to) => client.from("audit_logs").select("log_id, user_id, auth_user_id, action, entity_type, created_at")
    .gte("created_at", window.start.toISOString()).lt("created_at", window.end.toISOString()).order("created_at").order("log_id").range(from, to));
  const ids = [...new Set(audits.flatMap(a => [a.user_id, a.auth_user_id].filter((id): id is string => Boolean(id))))];
  const staff = await byIds<Staff>(client, "staff_users", "id, full_name", "id", ids);
  const names = new Map(staff.map(s => [s.id, s.full_name]));
  const grouped = new Map<string, { name: string; count: number; latest: Audit }>();
  const modules = new Map<string, number>();
  const staffActors = new Set<string>();
  let otherCount = 0;
  for (const a of audits) {
    const id = a.user_id ?? (a.auth_user_id && names.has(a.auth_user_id) ? a.auth_user_id : null);
    const key = id ?? "guest-system", name = id ? names.get(id) ?? "Former / unknown staff" : "Other / system activity";
    if (id) staffActors.add(id); else otherCount++;
    const existing = grouped.get(key);
    grouped.set(key, { name, count: (existing?.count ?? 0) + 1, latest: !existing || Date.parse(a.created_at) > Date.parse(existing.latest.created_at) ? a : existing.latest });
    const label = title(a.entity_type || "General"); modules.set(label, (modules.get(label) ?? 0) + 1);
  }
  return { ...base(window, now), trend: trend(window, audits.map(a => ({ date: a.created_at, value: 1 }))), split: [...modules].map(([label, value]) => ({ label, value })),
    rows: [...grouped].map(([id, actor]) => ({ id, staff: actor.name, actions: String(actor.count), latestAction: actor.latest.action, lastActive: formatTime(actor.latest.created_at), lastActiveSort: actor.latest.created_at })),
    metrics: [metric("Logged actions", audits.length, "Audit entries across resort modules"), metric("Staff with activity", staffActors.size, "Distinct staff accounts in this period"), metric("Other / system actions", otherCount, "Entries without an identified staff actor")],
    note: "Activity counts come from the audit log and include guest or automated events. Each staff account is counted separately, even when staff members share a name.",
  };
}

export async function generateReport(request: Request, tab: ReportTab) {
  try {
    const params = new URL(request.url).searchParams, period = parseReportPeriod(params.get("period"));
    const now = new Date();
    const window = reportWindow(period, period === "Custom" ? { startDate: params.get("startDate") ?? "", endDate: params.get("endDate") ?? "" } : undefined, now);
    const client = createAdminClient();
    const report = tab === "Sales Report" ? await salesReport(client, window, now) : tab === "Guest Report" ? await guestReport(client, window, now) : await staffReport(client, window, now);
    return NextResponse.json({ success: true, report }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvalidDateRangeError) return NextResponse.json({ success: false, message: error.message }, { status: 400 });
    console.error("[reports] Generation failed", error);
    return NextResponse.json({ success: false, message: "Unable to load the report. Please refresh to try again." }, { status: 500 });
  }
}
