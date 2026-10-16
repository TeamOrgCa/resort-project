import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";
const id = "33333333-3333-4333-8333-333333333333", guest = "guest", service = "44444444-4444-4444-8444-444444444444";
const version = "a".repeat(64);
const reservation = { reservation_id: id, guest_id: guest, reference_number: "MV-TEST", status: "confirmed", booking_mode: "day",
  start_datetime: "2027-06-14T08:00:00+08:00", end_datetime: "2027-06-14T16:00:00+08:00", adult_count: 22, child_count: 0 };
function harness({ authenticated = true, owned = true, full = false, locked = null, refunds = [], rpcError = null, notifyFails = false } = {}) {
  const calls = [], reads = [];
  const loaded = { reservation, services: [{ service_id: service, quantity: 2, price_at_time: 100 }], catalogServices: [{ service_id: service, name: "Table", is_active: false, price: 999 }],
    bill: { total_amount: 8600, paid_amount: full ? 8600 : 1720, status: full ? "paid" : "partial" }, lockedReason: locked, canChangeDetails: true,
    version, snapshot: { fixture: "server snapshot" }, packageRates: legacyRates };
  const routes = loadTsModule("app/api/reservations/edit/route.ts", {
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: authenticated ? { id: guest } : null }, error: null }) },
      from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ error: null, data: owned ? { reservation_id: id } : null }) }; return q; } }) },
    "@/lib/server/reservation-editor": { loadReservationEditor: async value => { reads.push(value); return loaded; } },
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: () => { const q = { select: () => q, eq: () => q, in: () => q, limit: async () => ({ data: refunds, error: null }) }; return q; },
      rpc: async (name, args) => { calls.push({ name, args }); return { data: { totalAmount: 8150, paidAmount: 1720, remainingBalance: 6430, overpaidAmount: 0, adultCount: 20, childCount: 0, services: [] }, error: rpcError }; } }) },
    "@/lib/notifications": { NOTIFICATION_AUDIENCES: { reservation: [] }, createNotifications: async () => { if (notifyFails) throw Error("Unavailable"); return { error: null }; } },
  });
  const url = "http://localhost/api/reservations/edit?reservationId=" + id;
  return { calls, reads, get: () => routes.GET(new Request(url)), post: (body = {}) => routes.POST(new Request(url, { method: "POST", body: JSON.stringify({ adultCount: 20, childCount: 0, services: [], version, expectedTotal: 8150, ...body }) })) };
}

test("guests must own the booking before privileged editor data is loaded", async () => {
  for (const [options, status] of [[{ authenticated: false }, 401], [{ owned: false }, 403]]) {
    const h = harness(options); assert.equal((await h.get()).status, status); assert.equal((await h.post()).status, status); assert.equal(h.reads.length, 0); assert.equal(h.calls.length, 0);
  }
  const response = await harness().get(); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const detail = await response.json(); assert.equal(detail.canReduceServices, true); assert.equal(detail.canChangeGuests, true); assert.equal(detail.snapshot, undefined);
});

test("guest edits use historical rates and server snapshots, ignore forged prices/dates and allow zero services", async () => {
  const h = harness(); const response = await h.post({ packageDelta: -999999, startDatetime: "2020-01-01", bookingMode: "night", paidAmount: 0 });
  assert.equal(response.status, 200); assert.equal((await response.json()).remainingBalance, 6430);
  assert.equal(h.calls[0].name, "edit_guest_reservation_bill");
  assert.deepEqual(h.calls[0].args.p_expected, { fixture: "server snapshot" });
  assert.deepEqual(h.calls[0].args.p_patch, { adultCount: 20, childCount: 0, services: [], packageDelta: -250, expectedTotal: 8150 });
});

test("fully paid reductions, open reviews, stale versions and totals cannot be saved", async () => {
  for (const [options, body] of [[{ full: true }, {}], [{ locked: "Pending payment review" }, {}], [{ refunds: [{ refund_id: "open" }] }, {}],
    [{}, { version: "b".repeat(64) }], [{}, { expectedTotal: 1 }]]) {
    const h = harness(options); assert.equal((await h.post(body)).status, 409); assert.equal(h.calls.length, 0);
  }
  const bad = harness(); assert.equal((await bad.post({ adultCount: 31 })).status, 400); assert.equal(bad.calls.length, 0);
});

test("missing migrations and database races remain actionable; notification failures cannot undo saved edits", async () => {
  for (const [code, status] of [["PGRST202", 503], ["42501", 403], ["40001", 409], ["22023", 400]]) {
    const h = harness({ rpcError: { code, message: "Reload booking" } }); const response = await h.post(); assert.equal(response.status, status);
    if (code === "PGRST202") assert.match((await response.json()).message, /guest-booking-edit migration/);
  }
  assert.equal((await harness({ notifyFails: true }).post()).status, 200);
});
