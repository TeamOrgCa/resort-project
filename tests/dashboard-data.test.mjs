import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { dashboardDatabase } from "./helpers/dashboard-database.mjs";

const now = new Date("2026-10-12T16:30:00Z"); // Oct 13, 00:30 in Manila; still Oct 12 in UTC.
const reservation = (id, extras = {}) => ({ reservation_id: id, reference_number: `MV-${id}`, guest_id: "g1", walk_in_guest_id: null,
  start_datetime: "2026-10-13T00:00:00Z", end_datetime: "2026-10-13T08:00:00Z", adult_count: 10, child_count: 2,
  booking_type: "online", booking_mode: "day", status: "confirmed", payment_deadline_at: null, created_at: "2026-10-12T16:01:00Z", ...extras });
const payment = (amount, extras = {}) => ({ payment_id: `p-${amount}`, amount, status: "verified", created_at: "2026-09-01T00:00:00Z", verified_at: "2026-10-12T16:01:00Z", ...extras });
function data(tables = {}, errors = {}) {
  const db = dashboardDatabase(tables, errors);
  const { generateDashboard } = loadTsModule("lib/server/dashboard.ts", { "@/lib/supabase/admin": { createAdminClient: () => db.client } });
  return { ...db, generateDashboard };
}

test("dashboard totals use Philippine dates and verification dates with a legacy fallback", async () => {
  const h = data({ payments: [payment(1000), payment(500, { verified_at: null, created_at: "2026-10-12T16:20:00Z" }),
    payment(300, { verified_at: "2026-10-12T15:59:59Z" }), payment(9000, { status: "pending", created_at: "2026-08-01T00:00:00Z" }),
    payment(4000, { status: "rejected" }), payment(5000, { verified_at: "2026-10-13T16:00:00Z" })] });
  const snapshot = await h.generateDashboard(now);
  assert.equal(snapshot.today, "2026-10-13"); assert.equal(snapshot.startDate, "2026-10-07"); assert.equal(snapshot.endDate, "2026-10-13"); assert.equal(snapshot.arrivalEndDate, "2026-11-11");
  assert.equal(snapshot.collectionsToday, 1500); assert.equal(snapshot.verifiedToday, 2); assert.equal(snapshot.collections.reduce((sum, p) => sum + p.value, 0), 1800);
  assert.equal(snapshot.collections.at(-1).value, 1500); assert.equal(snapshot.collections.at(-2).value, 300); assert.equal(snapshot.collections.length, 7);
  assert.equal(snapshot.queues.payments, 1, "Older unresolved payments remain in the queue");
});

test("arrivals exclude closed bookings, expired holds, past stays and the exclusive 30-day boundary", async () => {
  const h = data({ reservations: [reservation("today"), reservation("current", { start_datetime: "2026-10-12T12:00:00Z", end_datetime: "2026-10-13T00:00:00Z" }),
    reservation("cancelled", { status: "cancelled" }), reservation("completed", { status: "completed" }), reservation("rejected", { status: "rejected" }), reservation("expired", { status: "expired" }),
    reservation("old-hold", { status: "pending", payment_deadline_at: now.toISOString() }),
    reservation("valid-hold", { status: "pending", payment_deadline_at: "2026-10-12T17:00:00Z" }), reservation("proof", { status: "payment_submitted" }),
    reservation("past", { start_datetime: "2026-10-11T00:00:00Z", end_datetime: "2026-10-12T16:00:00Z" }),
    reservation("last-day", { start_datetime: "2026-11-11T10:00:00Z", end_datetime: "2026-11-12T00:00:00Z" }),
    reservation("boundary", { start_datetime: "2026-11-11T16:00:00Z", end_datetime: "2026-11-12T00:00:00Z" })], guests: [{ id: "g1", first_name: "Ana", last_name: "Santos" }] });
  const snapshot = await h.generateDashboard(now);
  assert.deepEqual(new Set(snapshot.reservations.map(r => r.id)), new Set(["today", "current", "valid-hold", "proof", "last-day"]));
  assert.equal(snapshot.arrivalsToday, 3); assert.equal(snapshot.scheduledNow, 1); assert.equal(snapshot.reservations.find(r => r.id === "today").guests, "12");
  assert.equal(snapshot.reservations.find(r => r.id === "today").guest, "Ana Santos"); assert.match(snapshot.reservations.find(r => r.id === "today").checkIn, /8:00/);
});

test("booking charts include all recorded statuses, accurate sources, and real walk-in names", async () => {
  const h = data({ reservations: [reservation("online"), reservation("walk-in", { guest_id: null, walk_in_guest_id: "w1", booking_type: "walk_in" }), reservation("unspecified", { guest_id: null, booking_type: null, status: "cancelled" }),
    reservation("outside", { created_at: "2026-10-06T15:59:59Z", guest_id: "missing" })], walk_in_guests: [{ walk_in_guest_id: "w1", first_name: "Ben", last_name: "Cruz" }] });
  const snapshot = await h.generateDashboard(now);
  assert.equal(snapshot.bookingsCreated, 3); assert.deepEqual(snapshot.bookingSources.map(p => p.value), [1, 1, 1]);
  assert.equal(snapshot.bookingStatuses.find(p => p.label === "Cancelled").value, 1); assert.equal(snapshot.bookingStatuses.reduce((s, p) => s + p.value, 0), 3);
  assert.equal(snapshot.reservations.find(r => r.id === "walk-in").guest, "Ben Cruz"); assert.equal(snapshot.reservations.find(r => r.id === "outside").guest, "Guest name unavailable");
});

test("every dashboard source is complete beyond PostgREST limits and profile IDs are chunked", async () => {
  const h = data({ reservations: Array.from({ length: 1001 }, (_, i) => reservation(String(i), { guest_id: `g${i}` })),
    guests: Array.from({ length: 1001 }, (_, i) => ({ id: `g${i}`, first_name: `Guest ${i}`, last_name: "Test" })),
    payments: Array.from({ length: 1001 }, (_, i) => payment(1, { payment_id: `p${i}` })), reservation_reschedules: [{ status: "pending" }, { status: "approved" }], ocular_visits: [{ status: "pending" }], refund_requests: [{ status: "pending" }, { status: "approved" }, { status: "refunded" }] });
  const snapshot = await h.generateDashboard(now);
  assert.equal(snapshot.arrivalsToday, 1001); assert.equal(snapshot.bookingsCreated, 1001); assert.equal(snapshot.collectionsToday, 1001);
  assert.equal(snapshot.reservations.length, 1001); assert.ok(snapshot.reservations.every(r => r.guest !== "Guest name unavailable"));
  assert.deepEqual(snapshot.queues, { payments: 0, reschedules: 1, ocular: 1, refundReview: 1, refundPayout: 1 });
  assert.ok(h.calls.some(c => c.from === 1000)); assert.ok(h.calls.filter(c => c.table === "guests").every(c => c.batches[0].length <= 200));
});

test("empty dashboards return actual zeros; database failures never become zero activity", async () => {
  const empty = await data().generateDashboard(now);
  assert.equal(empty.collectionsToday, 0); assert.equal(empty.bookingsCreated, 0); assert.deepEqual(empty.reservations, []); assert.deepEqual(empty.bookingStatuses, []);
  await assert.rejects(data({}, { payments: "Unavailable" }).generateDashboard(now), /Unavailable/);
  await assert.rejects(data({ reservations: [reservation("1")] }, { guests: "Unavailable" }).generateDashboard(now), /Unavailable/);
});

function route({ active = true, role = "front_desk", permissions = ["dashboard", "reservations"], fail = false } = {}) {
  let reads = 0;
  const handlers = loadTsModule("app/api/admin/dashboard/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => active ? { supabase: {}, staffUser: { role } } : null },
    "@/lib/server/role-permissions": { getRolePermissions: async () => permissions },
    "@/lib/server/dashboard": { generateDashboard: async () => { reads++; if (fail) throw new Error("Test database failure"); return { collectionsToday: 42 }; } },
  });
  return { ...handlers, reads: () => reads };
}

test("dashboard API requires an active staff session and dashboard permission before reading data", async () => {
  for (const [options, status] of [[{ active: false }, 401], [{ permissions: ["transactions"] }, 403]]) {
    const h = route(options); assert.equal((await h.GET()).status, status); assert.equal(h.reads(), 0);
  }
  const h = route(); const response = await h.GET();
  assert.equal(response.headers.get("cache-control"), "no-store"); assert.deepEqual((await response.json()).dashboard.permissions, ["dashboard", "reservations"]);
  const admin = await (await route({ role: "admin", permissions: [] }).GET()).json(); assert.ok(admin.dashboard.permissions.includes("create_reservation"));
  assert.equal((await route({ fail: true }).GET()).status, 500);
  const { apiPermission } = loadTsModule("lib/auth/role-access.ts"); assert.equal(apiPermission("/api/admin/dashboard", "GET"), "dashboard");
});

test("reservation deep links validate IDs/dates and check add permission before opening the form", async () => {
  const { default: Page } = loadTsModule("app/admin/(portal)/reservations/page.tsx", {
    "@/components/admin/ReservationCalendar": { default: () => null },
    "@/lib/server/admin-audit": { requireActiveStaff: async () => ({ supabase: {}, staffUser: { role: "front_desk" } }) },
    "@/lib/server/role-permissions": { staffHasPermission: async (_client, _role, permission) => permission === "create_reservation" },
  });
  const id = "22222222-2222-4222-8222-222222222222";
  const valid = await Page({ searchParams: Promise.resolve({ reservation: id, date: "2026-11-01", new: "1" }) });
  assert.equal(valid.props.initialReservationId, id); assert.equal(valid.props.initialDate, "2026-11-01"); assert.equal(valid.props.openNew, true);
  const invalid = await Page({ searchParams: Promise.resolve({ reservation: "invalid", date: "2026-02-30" }) });
  assert.equal(invalid.props.initialReservationId, undefined); assert.equal(invalid.props.initialDate, undefined); assert.equal(invalid.props.openNew, false);
});

test("refund queues paginate all requests and references, fail visibly and enforce transactions access", async () => {
  const db = dashboardDatabase({ refund_requests: Array.from({ length: 1001 }, (_, i) => ({ refund_id: `refund-${i}`, reservation_id: `r-${i}`, status: i === 0 ? "pending" : "refunded", requested_at: "2026-10-01T00:00:00Z" })),
    reservations: Array.from({ length: 1001 }, (_, i) => ({ reservation_id: `r-${i}`, reference_number: `MV-${i}` })) });
  let allowed = true;
  const { GET } = loadTsModule("app/api/admin/refunds/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => ({ supabase: db.client, staffUser: { role: "front_desk" } }) },
    "@/lib/server/role-permissions": { staffHasPermission: async (_client, _role, permission) => allowed && permission === "transactions" },
    "@/lib/notifications": {}, "@/lib/supabase/admin": {},
  });
  const response = await GET(); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const result = await response.json(); assert.equal(result.refunds.length, 1001); assert.equal(result.reservations.length, 1001);
  assert.ok(db.calls.some(c => c.table === "refund_requests" && c.from === 1000)); assert.ok(db.calls.filter(c => c.table === "reservations").every(c => c.batches[0].length <= 200));
  allowed = false; const reads = db.calls.length; assert.equal((await GET()).status, 403); assert.equal(db.calls.length, reads);
  const failed = dashboardDatabase({}, { refund_requests: "Database unavailable" });
  const failure = loadTsModule("app/api/admin/refunds/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => ({ supabase: failed.client, staffUser: { role: "admin" } }) },
    "@/lib/server/role-permissions": { staffHasPermission: async () => true }, "@/lib/notifications": {}, "@/lib/supabase/admin": {},
  });
  assert.equal((await failure.GET()).status, 503);
});
