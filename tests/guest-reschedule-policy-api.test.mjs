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
function harness({ booked = reservation, user = { id: "guest" }, conflict = false, insertError = null, pending = null, notificationFails = false } = {}) {
  const writes = [], notifications = [], overlaps = [];
  const admin = { from(table) {
    let mutation;
    const q = { select: () => q, eq: () => q, insert: body => { mutation = "insert"; writes.push({ table, body }); return q; },
      update: body => { mutation = "update"; writes.push({ table, body }); return q; }, delete: () => q,
      maybeSingle: async () => ({ data: pending, error: null }), single: async () => ({ data: { reschedule_id: "request" }, error: insertError }),
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
  return { writes, notifications, overlaps, post: (body = payload) => route.POST(new Request("http://localhost/api/reservations/reschedule", { method: "POST", body: JSON.stringify(body) })) };
}

test("guest requests at the peak deadline retain the package and quote notice plus higher-date rates", async () => {
  const h = harness(); const response = await h.post(); const result = await response.json();
  assert.equal(response.status, 201); assert.equal(result.rescheduleFee, 50); assert.equal(result.rateAdjustment, 500);
  assert.equal(h.writes[0].body.reschedule_fee, 50); assert.equal(h.writes[0].body.rate_adjustment, 500);
  assert.equal(h.writes[1].body.status, "reschedule_requested"); assert.equal(h.notifications.length, 1);
  assert.equal(h.overlaps[0][3], "booking");
});

test("late guests get the deadline and contact-resort alert without saving a request", async () => {
  for (const [start, end, notice] of [["2027-09-19T08:00:00+08:00", "2027-09-19T16:00:00+08:00", 14],
    ["2028-06-10T08:00:00+08:00", "2028-06-10T16:00:00+08:00", 7]]) {
    const previous = Date.now; if (notice === 7) Date.now = () => Date.parse("2028-06-04T10:00:00+08:00");
    try {
      const h = harness({ booked: { ...reservation, start_datetime: start, end_datetime: end } });
      const response = await h.post({ ...payload, newStartDatetime: "2028-06-25T08:00:00+08:00", newEndDatetime: "2028-06-25T16:00:00+08:00" });
      const result = await response.json(); assert.equal(response.status, 400); assert.equal(result.code, "RESCHEDULE_NOTICE_REQUIRED");
      assert.equal(result.policy.minimumNoticeDays, notice); assert.match(result.message, /Contact the resort/); assert.equal(h.writes.length, 0);
    } finally { Date.now = previous; }
  }
});

test("guest authentication, ownership, confirmed-payment status, duration and conflicts remain enforced", async () => {
  for (const [options, body, status] of [[{ user: null }, payload, 401], [{ booked: { ...reservation, guest_id: "other" } }, payload, 403],
    [{ booked: { ...reservation, status: "pending" } }, payload, 400], [{ pending: { reschedule_id: "old" } }, payload, 400],
    [{}, { ...payload, newEndDatetime: "2027-09-25T18:00:00+08:00" }, 400], [{ conflict: true }, payload, 409]]) {
    const h = harness(options); assert.equal((await h.post(body)).status, status); assert.equal(h.writes.length, 0);
  }
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
