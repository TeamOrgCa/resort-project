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
const payload = { reservationId: "booking", newStartDatetime: "2027-09-25T08:00:00+08:00", newEndDatetime: "2027-09-25T16:00:00+08:00", rescheduleReason: "Family schedule changed" };
function harness({ booked = reservation, user = { id: "guest" }, conflict = false, rpcError = null, pending = null, notificationFails = false, changed = false } = {}) {
  const writes = [], notifications = [], overlaps = [], filters = [];
  const admin = { from(table) {
    let mutation;
    const q = { select: () => q, eq: (key, value) => { filters.push({ table, mutation, key, value }); return q; }, insert: body => { mutation = "insert"; writes.push({ table, body }); return q; },
      update: body => { mutation = "update"; writes.push({ table, body }); return q; }, delete: () => { mutation = "delete"; writes.push({ table, mutation }); return q; },
      maybeSingle: async () => ({ data: mutation === "update" ? (changed ? null : { reservation_id: booked.reservation_id }) : pending, error: null }), single: async () => ({ data: { reschedule_id: "request" }, error: rpcError }),
      then: (resolve, reject) => Promise.resolve({ data: null, error: mutation === "insert" ? rpcError : null }).then(resolve, reject) };
    return q;
  } };
  admin.rpc = async (name, args) => {
    writes.push({ name, args });
    const error = rpcError ?? (changed ? { code: "40001", message: "This reservation changed. Refresh Manage Booking before rescheduling" } : null);
    const charge = args.p_notice_fee + args.p_rate_adjustment;
    return { error, data: error ? null : { reservationId: booked.reservation_id, status: "confirmed",
      startDatetime: args.p_new_start, endDatetime: args.p_new_end,
      rescheduleFee: args.p_notice_fee, rateAdjustment: args.p_rate_adjustment, totalAdditional: charge,
      totalAmount: 8600 + charge, paidAmount: 600, remainingBalance: 8000 + charge } };
  };
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

test("guest reschedules auto-approve and charge notice plus higher-date rates atomically", async () => {
  const h = harness(); const response = await h.post(); const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.rescheduleFee, 50); assert.equal(result.rateAdjustment, 500);
  assert.equal(h.writes[0].args.p_notice_fee, 50); assert.equal(h.writes[0].args.p_rate_adjustment, 500);
  assert.equal(h.writes[0].name, "reschedule_guest_reservation"); assert.equal(result.status, "confirmed"); assert.equal(result.totalAmount, 9150); assert.equal(h.notifications.length, 1);
  assert.equal(h.overlaps[0][3], "booking"); assert.equal(h.writes[0].args.p_reason, "Family schedule changed");
});

test("late guests in peak and non-peak months reschedule immediately without staff approval", async () => {
  for (const [start, end, notice] of [["2027-09-19T08:00:00+08:00", "2027-09-19T16:00:00+08:00", 14],
    ["2028-06-10T08:00:00+08:00", "2028-06-10T16:00:00+08:00", 7]]) {
    const previous = Date.now; if (notice === 7) Date.now = () => Date.parse("2028-06-04T10:00:00+08:00");
    try {
      const h = harness({ booked: { ...reservation, start_datetime: start, end_datetime: end } });
      const response = await h.post({ ...payload, newStartDatetime: "2028-06-25T08:00:00+08:00", newEndDatetime: "2028-06-25T16:00:00+08:00" });
      const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.status, "confirmed");
      assert.equal(h.writes[0].args.p_guest, "guest");
      assert.equal(h.writes.length, 1);
      assert.equal(result.rescheduleFee, 50); assert.equal(h.notifications.length, 1);
    } finally { Date.now = previous; }
  }
});

test("short-notice, same-day and past-date reschedules apply the correct fee immediately", async () => {
  const previous = Date.now;
  Date.now = () => Date.parse("2027-09-06T23:00:00+08:00");
  try {
    for (const [date, fee] of [["2027-09-12", 50], ["2027-09-11", 100], ["2027-09-09", 100], ["2027-09-08", 300], ["2027-09-07", 300], ["2027-09-06", 500], ["2027-09-05", 500]]) {
      const h = harness({ booked: { ...reservation, start_datetime: date + "T08:00:00+08:00", end_datetime: date + "T16:00:00+08:00" } });
      const response = await h.post(); const result = await response.json();
      assert.equal(response.status, 200, date); assert.equal(result.rescheduleFee, fee, date);
      assert.equal(h.writes[0].args.p_notice_fee, fee); assert.equal(result.status, "confirmed");
      assert.equal(h.writes.length, 1);
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

test("a missing automatic reschedule RPC explains which migration is required", async () => {
  const h = harness({ rpcError: { code: "PGRST202", message: "Function not found" } });
  const response = await h.post(); assert.equal(response.status, 503);
  assert.match((await response.json()).message, /guest-auto-reschedule-migration.sql/);
  assert.equal(h.notifications.length, 0);
});

test("database notice/fee races return actionable alerts instead of a generic submission error", async () => {
  const h = harness({ rpcError: { code: "40001", message: "Reschedule quote changed. Refresh before submitting" } });
  const response = await h.post(); assert.equal(response.status, 409); assert.match((await response.json()).message, /Refresh/);
  assert.equal(h.writes.length, 1); assert.equal(h.notifications.length, 0);
});

test("an automatically applied reschedule remains successful if notification delivery fails", async () => {
  const h = harness({ notificationFails: true });
  const response = await h.post(); assert.equal(response.status, 200); assert.equal((await response.json()).success, true);
  assert.equal(h.writes.length, 1);
});

test("a concurrent cancellation or staff edit cannot be overwritten by a guest reschedule", async () => {
  const h = harness({ changed: true });
  const response = await h.post(); assert.equal(response.status, 409);
  assert.match((await response.json()).message, /reservation changed/);
  assert.deepEqual(h.writes[0].args.p_expected, {
    startDatetime: reservation.start_datetime, endDatetime: reservation.end_datetime,
    adultCount: 20, childCount: 0, bookingMode: "day", packageRateVersion: 1,
  });
  assert.equal(h.writes.length, 1);
  assert.equal(h.notifications.length, 0);
});

test("malformed JSON is rejected as an invalid request without writing a reschedule", async () => {
  const h = harness(); const response = await h.POST(new Request("http://localhost", { method: "POST", body: "{" }));
  assert.equal(response.status, 400); assert.equal(h.writes.length, 0);
});


test("a changed charge preview is rejected before saving or charging", async () => {
  const h = harness();
  const response = await h.post({ ...payload, expectedAdditional: 50 });
  assert.equal(response.status, 409); assert.match((await response.json()).message, /charges changed/);
  assert.equal(h.writes.length, 0); assert.equal(h.notifications.length, 0);
});


test("reschedule reasons are required, length-limited and trimmed before the atomic save", async () => {
  for (const rescheduleReason of [undefined, null, 123, "", "   ", "four", "A".repeat(2001)]) {
    const h = harness(); const response = await h.post({ ...payload, rescheduleReason });
    assert.equal(response.status, 400); assert.match((await response.json()).message, /reschedule reason/);
    assert.equal(h.writes.length, 0);
  }
  const h = harness();
  assert.equal((await h.post({ ...payload, rescheduleReason: "  Family schedule changed  " })).status, 200);
  assert.equal(h.writes[0].args.p_reason, "Family schedule changed");
});
