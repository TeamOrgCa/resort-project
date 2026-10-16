import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";

const now = Date.parse("2027-09-06T23:00:00+08:00");
const realNow = Date.now;
before(() => { Date.now = () => now; });
after(() => { Date.now = realNow; });
const reservation = { reservation_id: "booking", guest_id: "guest", reference_number: "MV-TEST", status: "confirmed", booking_mode: "day",
  start_datetime: "2027-09-20T08:00:00+08:00", end_datetime: "2027-09-20T16:00:00+08:00", adult_count: 20, child_count: 0, package_rate_version: 1 };
const payload = { reservationId: "booking", newStartDatetime: "2027-09-25T08:00:00+08:00", newEndDatetime: "2027-09-25T16:00:00+08:00" };
function harness({ booked = reservation, user = { id: "guest" }, conflict = false, insertError = null, pending = null, notificationFails = false, changed = false } = {}) {
  const writes = [], notifications = [], overlaps = [], filters = [];
  const admin = { from(table) {
    let mutation;
    const q = { select: () => q, eq: (key, value) => { filters.push({ table, mutation, key, value }); return q; }, insert: body => { mutation = "insert"; writes.push({ table, body }); return q; },
      update: body => { mutation = "update"; writes.push({ table, body }); return q; }, delete: () => { mutation = "delete"; writes.push({ table, mutation }); return q; },
      maybeSingle: async () => ({ data: mutation === "update" ? (changed ? null : { reservation_id: booked.reservation_id }) : pending, error: null }), single: async () => ({ data: { reschedule_id: "request" }, error: insertError }),
      then: (resolve, reject) => Promise.resolve({ data: null, error: mutation === "insert" ? insertError : null }).then(resolve, reject) };
    return q;
  } };
  const route = loadTsModule("app/api/reservations/reschedule/route.ts", {
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) },
      from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: booked, error: null }) }; return q; } }) },
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/server/package-rates": { loadPackageRates: async () => ({ version: 1, rates: legacyRates }), PackageRatesError: class extends Error {} },
    "@/lib/server/reservation-availability": { checkReservationOverlap: async (...args) => { overlaps.push(args); return { conflict, error: null }; } },
    "@/lib/notifications": { NOTIFICATION_AUDIENCES: { reservation: [] }, createNotifications: async body => { notifications.push(body); if (notificationFails) throw new Error("Notification unavailable"); return { error: null }; } },
  });
  return { writes, notifications, overlaps, filters, POST: route.POST, post: (body = payload) => route.POST(new Request("http://localhost/api/reservations/reschedule", { method: "POST", body: JSON.stringify(body) })) };
}

test("guest requests at the peak deadline retain the package and quote notice plus higher-date rates", async () => {
  const h = harness(); const response = await h.post(); const result = await response.json();
  assert.equal(response.status, 201); assert.equal(result.rescheduleFee, 50); assert.equal(result.rateAdjustment, 500);
  assert.equal(h.writes[0].body.reschedule_fee, 50); assert.equal(h.writes[0].body.rate_adjustment, 500);
  assert.equal(h.writes[1].body.status, "reschedule_requested"); assert.equal(h.notifications.length, 1);
  assert.equal(h.overlaps[0][3], "booking");
});

test("late guests in peak and non-peak months can submit pending requests without moving the reservation", async () => {
  for (const [start, end, notice] of [["2027-09-19T08:00:00+08:00", "2027-09-19T16:00:00+08:00", 14],
    ["2028-06-10T08:00:00+08:00", "2028-06-10T16:00:00+08:00", 7]]) {
    const previous = Date.now; if (notice === 7) Date.now = () => Date.parse("2028-06-04T10:00:00+08:00");
    try {
      const h = harness({ booked: { ...reservation, start_datetime: start, end_datetime: end } });
      const response = await h.post({ ...payload, newStartDatetime: "2028-06-25T08:00:00+08:00", newEndDatetime: "2028-06-25T16:00:00+08:00" });
      const result = await response.json(); assert.equal(response.status, 201); assert.equal(result.status, "reschedule_requested");
      assert.equal(h.writes[0].body.status, "pending"); assert.equal(h.writes[0].body.requested_by, "guest");
      assert.deepEqual(h.writes[1].body, { status: "reschedule_requested" });
      assert.equal(result.rescheduleFee, 50); assert.equal(h.notifications.length, 1);
    } finally { Date.now = previous; }
  }
});

test("short-notice, same-day and past-date requests quote the correct fee for staff review", async () => {
  const previous = Date.now;
  Date.now = () => Date.parse("2027-09-06T23:00:00+08:00");
  try {
    for (const [date, fee] of [["2027-09-12", 50], ["2027-09-11", 100], ["2027-09-09", 100], ["2027-09-08", 300], ["2027-09-07", 300], ["2027-09-06", 500], ["2027-09-05", 500]]) {
      const h = harness({ booked: { ...reservation, start_datetime: date + "T08:00:00+08:00", end_datetime: date + "T16:00:00+08:00" } });
      const response = await h.post(); const result = await response.json();
      assert.equal(response.status, 201, date); assert.equal(result.rescheduleFee, fee, date);
      assert.equal(h.writes[0].body.reschedule_fee, fee); assert.equal(h.writes[0].body.status, "pending");
      assert.deepEqual(h.writes[1].body, { status: "reschedule_requested" });
    }
  } finally { Date.now = previous; }
});

test("guest authentication, ownership, confirmed-payment status, duration and conflicts remain enforced", async () => {
  for (const [options, body, status] of [[{ user: null }, payload, 401], [{ booked: { ...reservation, guest_id: "other" } }, payload, 403],
    [{ booked: { ...reservation, status: "pending" } }, payload, 400], [{ booked: { ...reservation, checked_in_at: new Date(now).toISOString() } }, payload, 400], [{ pending: { reschedule_id: "old" } }, payload, 400],
    [{}, { ...payload, newEndDatetime: "2027-09-25T18:00:00+08:00" }, 400], [{ conflict: true }, payload, 409]]) {
    const h = harness(options); assert.equal((await h.post(body)).status, status); assert.equal(h.writes.length, 0);
  }
});

test("an older installed notice gate explains which migration enables guest requests", async () => {
  const h = harness({ insertError: { code: "22023", message: "Rescheduling requires 14 days notice. Contact the resort for a staff-reviewed exception" } });
  const response = await h.post(); assert.equal(response.status, 503);
  assert.match((await response.json()).message, /guest-reschedule-requests-migration.sql/);
  assert.equal(h.notifications.length, 0);
});

test("database notice/fee races return actionable alerts instead of a generic submission error", async () => {
  const h = harness({ insertError: { code: "40001", message: "Reschedule quote changed. Refresh before submitting" } });
  const response = await h.post(); assert.equal(response.status, 409); assert.match((await response.json()).message, /Refresh/);
  assert.equal(h.writes.length, 1); assert.equal(h.notifications.length, 0);
});

test("a saved request remains successful if notification delivery fails", async () => {
  const h = harness({ notificationFails: true });
  const response = await h.post(); assert.equal(response.status, 201); assert.equal((await response.json()).success, true);
  assert.equal(h.writes.length, 2);
});

test("a concurrent cancellation or staff edit cannot be overwritten by a guest reschedule", async () => {
  const h = harness({ changed: true });
  const response = await h.post(); assert.equal(response.status, 409);
  assert.match((await response.json()).message, /reservation changed/);
  for (const [key, value] of [["status", "confirmed"], ["start_datetime", reservation.start_datetime], ["end_datetime", reservation.end_datetime]]) {
    assert.ok(h.filters.some(filter => filter.mutation === "update" && filter.key === key && filter.value === value));
  }
  assert.ok(h.filters.some(filter => filter.mutation === "delete" && filter.key === "status" && filter.value === "pending"));
  assert.equal(h.notifications.length, 0);
});

test("malformed JSON is rejected as an invalid request without writing a reschedule", async () => {
  const h = harness(); const response = await h.POST(new Request("http://localhost", { method: "POST", body: "{" }));
  assert.equal(response.status, 400); assert.equal(h.writes.length, 0);
});
