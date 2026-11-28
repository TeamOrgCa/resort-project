import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function harness({ user = { id: "guest" }, owned = true } = {}) {
  const calls = [], filters = [];
  const { GET } = loadTsModule("app/api/booking/rooms/route.ts", {
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) }, from: () => {
      const q = { select: () => q, eq: (...args) => { filters.push(args); return q; }, maybeSingle: async () => ({ data: owned ? { reservation_id: id } : null, error: null }) }; return q;
    } }) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: { classifications: [], rooms: [] }, error: null }; } }) },
    "@/lib/server/advance-booking": { loadAdvanceBookingWindow: async () => ({ maxBookingDate: "2030-12-31" }) },
  });
  return { calls, filters, get: () => GET(new Request(`http://localhost/api/booking/rooms?startDatetime=2030-06-01T08:00:00%2B08:00&endDatetime=2030-06-01T16:00:00%2B08:00&excludeReservationId=${id}`)) };
}
test("only the owner can exclude their existing rooms from edit availability", async () => {
  for (const [options, status] of [[{ user: null }, 401], [{ owned: false }, 403]]) {
    const h = harness(options); assert.equal((await h.get()).status, status); assert.equal(h.calls.length, 0);
  }
  const h = harness(), response = await h.get();
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(h.calls, [{ name: "swimming_room_edit_catalog", args: { p_reservation: id } }]);
  assert.ok(h.filters.some(([column, value]) => column === "guest_id" && value === "guest"));
});
