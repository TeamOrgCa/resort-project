import { createAdminClient } from "@/lib/supabase/admin";
import { manilaDateKey, manilaTimestamp } from "@/lib/booking/manila-date";
import { reportBucket, reportWindow } from "@/lib/reports/periods";
import type { DashboardSnapshot } from "@/lib/dashboard/types";
import { fetchAllPages } from "./fetch-all-pages";

const DAY = 86_400_000;
type Reservation = {
  reservation_id: string; reference_number: string; guest_id: string | null; walk_in_guest_id: string | null;
  start_datetime: string; end_datetime: string; adult_count: number; child_count: number;
  booking_type: string | null; booking_mode: string | null; status: string; payment_deadline_at: string | null; created_at: string;
};
type Payment = { amount: number; created_at: string; verified_at: string | null };
type Guest = { id: string; first_name: string; last_name: string };
type WalkInGuest = Omit<Guest, "id"> & { walk_in_guest_id: string };
const labels: Record<string, string> = {
  pending: "Awaiting payment", payment_submitted: "Payment under review", confirmed: "Confirmed",
  reschedule_requested: "Reschedule requested", completed: "Completed", cancelled: "Cancelled", rejected: "Rejected", expired: "Expired",
};
const titleCase = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const dateTime = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
const source = (value: string | null) => value === "online" ? "Online" : value === "walk_in" ? "Staff entry" : "Unspecified";
const rounded = (value: number) => Math.round(value * 100) / 100;

/** No illustration values or response-size caps. Calendar boundaries use Philippine time. */
export async function generateDashboard(now = new Date()): Promise<Omit<DashboardSnapshot, "permissions">> {
  const client = createAdminClient();
  const window = reportWindow("Daily", undefined, now);
  const today = manilaDateKey(now);
  const todayStart = new Date(`${today}T00:00:00+08:00`);
  const arrivalEnd = new Date(todayStart.getTime() + 30 * DAY);
  const start = window.start.toISOString(), end = window.end.toISOString();
  const count = async (table: string, status: string | string[]) => {
    const query = client.from(table).select("*", { count: "exact", head: true });
    const { count, error } = await (Array.isArray(status) ? query.in("status", status) : query.eq("status", status));
    if (error) throw new Error(error.message);
    if (count == null) throw new Error(`Unable to count ${table}`);
    return count;
  };
  const [arrivals, bookings, verified, payments, reschedules, ocular, refundReview, refundPayout] = await Promise.all([
    fetchAllPages<Reservation>((from, to) => client.from("reservations")
      .select("reservation_id, reference_number, guest_id, walk_in_guest_id, start_datetime, end_datetime, adult_count, child_count, booking_type, booking_mode, status, payment_deadline_at, created_at")
      .in("status", ["pending", "payment_submitted", "confirmed", "reschedule_requested"])
      .lt("start_datetime", arrivalEnd.toISOString()).gt("end_datetime", todayStart.toISOString())
      .order("start_datetime").order("reservation_id").range(from, to)),
    fetchAllPages<Pick<Reservation, "reservation_id" | "booking_type" | "status" | "created_at">>((from, to) => client.from("reservations").select("reservation_id, booking_type, status, created_at")
      .gte("created_at", start).lt("created_at", end).order("created_at").order("reservation_id").range(from, to)),
    fetchAllPages<Payment>((from, to) => client.from("payments").select("payment_id, amount, created_at, verified_at")
      .eq("status", "verified").or(`and(verified_at.gte.${start},verified_at.lt.${end}),and(verified_at.is.null,created_at.gte.${start},created_at.lt.${end})`)
      .order("created_at").order("payment_id").range(from, to)),
    count("payments", "pending"), count("reservation_reschedules", "pending"), count("ocular_visits", "pending"),
    count("refund_requests", ["pending", "reviewed"]), count("refund_requests", ["approved", "payout_submitted"]),
  ]);

  // An overdue unpaid hold is not a usable reservation, even before the expiry job runs.
  const active = arrivals.filter(r => r.status !== "pending" || !r.payment_deadline_at || Date.parse(r.payment_deadline_at) > now.getTime());
  async function profiles<T>(table: string, columns: string, key: string, ids: string[]) {
    const rows: T[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      rows.push(...await fetchAllPages<T>(async (from, to) => {
        const result = await client.from(table).select(columns).in(key, ids.slice(i, i + 200)).order(key).range(from, to);
        return { data: result.data as unknown as T[] | null, error: result.error };
      }));
    }
    return rows;
  }
  const guestIds = [...new Set(active.map(r => r.guest_id).filter((id): id is string => Boolean(id)))];
  const walkInIds = [...new Set(active.map(r => r.walk_in_guest_id).filter((id): id is string => Boolean(id)))];
  const [guests, walkIns] = await Promise.all([
    profiles<Guest>("guests", "id, first_name, last_name", "id", guestIds),
    profiles<WalkInGuest>("walk_in_guests", "walk_in_guest_id, first_name, last_name", "walk_in_guest_id", walkInIds),
  ]);
  const guestsById = new Map(guests.map(g => [g.id, g]));
  const walkInsById = new Map(walkIns.map(g => [g.walk_in_guest_id, g]));
  const collections = window.labels.map(label => ({ label, value: 0 }));
  let collectionsToday = 0, verifiedToday = 0;
  for (const payment of verified) {
    const at = payment.verified_at ?? payment.created_at;
    const index = reportBucket(at, window);
    const amount = Number(payment.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid payment amount");
    if (index >= 0) collections[index].value += amount;
    if (manilaDateKey(at) === today) { collectionsToday += amount; verifiedToday++; }
  }
  const statusCounts = new Map<string, number>();
  const sources = new Map<string, number>();
  for (const booking of bookings) {
    const label = labels[booking.status] ?? titleCase(booking.status || "Unspecified");
    statusCounts.set(label, (statusCounts.get(label) ?? 0) + 1);
    const channel = source(booking.booking_type);
    sources.set(channel, (sources.get(channel) ?? 0) + 1);
  }
  return {
    generatedAt: manilaTimestamp(now), today, arrivalEndDate: manilaDateKey(new Date(arrivalEnd.getTime() - 1)),
    startDate: window.startDate, endDate: window.endDate,
    arrivalsToday: active.filter(r => manilaDateKey(r.start_datetime) === today).length,
    scheduledNow: active.filter(r => ["confirmed", "reschedule_requested"].includes(r.status) && Date.parse(r.start_datetime) <= now.getTime() && Date.parse(r.end_datetime) > now.getTime()).length,
    collectionsToday: rounded(collectionsToday), verifiedToday,
    collections: collections.map(p => ({ ...p, value: rounded(p.value) })),
    bookingStatuses: Array.from(statusCounts, ([label, value]) => ({ label, value })),
    bookingSources: Array.from(sources, ([label, value]) => ({ label, value })), bookingsCreated: bookings.length,
    queues: { payments, reschedules, ocular, refundReview, refundPayout },
    reservations: active.map(r => {
      const guest = (r.guest_id ? guestsById.get(r.guest_id) : undefined) ?? (r.walk_in_guest_id ? walkInsById.get(r.walk_in_guest_id) : undefined);
      return {
        id: r.reservation_id, reference: r.reference_number, guest: guest ? `${guest.first_name ?? ""} ${guest.last_name ?? ""}`.replace(/\s+/g, " ").trim() || "Guest name unavailable" : "Guest name unavailable",
        checkIn: dateTime.format(new Date(r.start_datetime)), checkOut: dateTime.format(new Date(r.end_datetime)),
        startSort: r.start_datetime, endSort: r.end_datetime, arrivalDate: manilaDateKey(r.start_datetime),
        status: labels[r.status] ?? titleCase(r.status), statusCode: r.status, source: source(r.booking_type),
        guests: String(Number(r.adult_count ?? 0) + Number(r.child_count ?? 0)), package: titleCase(r.booking_mode ?? "Unspecified"),
      };
    }),
  };
}
