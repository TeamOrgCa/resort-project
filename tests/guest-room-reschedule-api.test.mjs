import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const id = "33333333-3333-4333-8333-333333333333";
function harness({ user = { id: "guest" }, owned = true, error = null } = {}) {
  const calls = [], filters = [];
  const route = loadTsModule("app/api/reservations/reschedule-availability/route.ts", {
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) }, from: () => {
      const q = { select: () => q, eq: (...args) => { filters.push(args); return q; }, maybeSingle: async () => ({ data: owned ? { reservation_id: id } : null, error: null }) }; return q;
    } }) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { error, data: [{ date: "2028-02-29", available: false, reason: "Not enough Family rooms" }] }; } }) },
  });
  return { calls, filters, get: (query = `reservationId=${id}&month=2028-02`) => route.GET(new Request(`http://localhost/api/reservations/reschedule-availability?${query}`)) };
}
test("only the booking owner can load room reschedule dates", async () => {
  for (const [options, status] of [[{ user: null }, 401], [{ owned: false }, 403]]) {
    const h = harness(options); assert.equal((await h.get()).status, status); assert.equal(h.calls.length, 0);
  }
  const h = harness(), response = await h.get();
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(h.calls, [{ name: "swimming_room_reschedule_calendar", args: { p_reservation: id, p_from: "2028-02-01", p_to: "2028-02-29" } }]);
  assert.ok(h.filters.some(([column, value]) => column === "guest_id" && value === "guest"));
  assert.equal((await response.json()).dates[0].available, false);
});
test("invalid requests and missing room migrations fail with an actionable message", async () => {
  for (const query of [`reservationId=${id}&month=2028-13`, `reservationId=${id}&month=0001-02`, "reservationId=other&month=2028-02"]) assert.equal((await harness().get(query)).status, 400);
  const response = await harness({ error: { code: "PGRST202" } }).get();
  assert.equal(response.status, 503); assert.match((await response.json()).message, /swimming-guest-manage-migration.sql/);
});
