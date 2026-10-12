import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const reservationId = "22222222-2222-4222-8222-222222222222";
function harness({ authenticated = true, rpcError = null, notificationFails = false } = {}) {
  const calls = [], notices = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: "guest" } : null }, error: null }) },
    rpc: async (name, args) => { calls.push({ name, args }); return { data: rpcError ? null : name === "get_guest_refund_overview" ? { refunds: [], eligible: [{ reservation_id: reservationId, amount: 500 }] } : "refund", error: rpcError }; },
  };
  const route = loadTsModule("app/api/reservations/refund/route.ts", {
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/notifications": { createNotifications: async options => { notices.push(options); if (notificationFails) throw new Error("Unavailable"); return { error: null }; } },
  });
  return { ...route, calls, notices, post: body => route.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) })) };
}
test("refund endpoint requires authentication and validates the reservation before invoking the RPC", async () => {
  const anonymous = harness({ authenticated: false });
  assert.equal((await anonymous.post({ reservationId })).status, 401);
  assert.equal((await anonymous.GET()).status, 401); assert.equal(anonymous.calls.length, 0);
  for (const value of [null, {}, { reservationId: "other" }]) {
    const h = harness(); assert.equal((await h.post(value)).status, 400); assert.equal(h.calls.length, 0);
  }
});
test("guest cannot supply a refund amount or act as another guest", async () => {
  const h = harness(); const response = await h.post({ reservationId, amount: 1000000, guestId: "other" });
  assert.equal(response.status, 201);
  assert.deepEqual(h.calls, [{ name: "request_overpayment_refund", args: { p_reservation: reservationId } }]);
  assert.equal(h.notices[0].actorId, "guest"); assert.equal(h.notices[0].guestActionUrl, "/manage");
});
test("refund overview is private and conflicts and unauthorized reservations surface correctly", async () => {
  const h = harness(); const response = await h.GET();
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await response.json()).eligible[0].amount, 500);
  for (const [code, status] of [["42501", 403], ["40001", 409], ["23505", 409], ["22023", 400], ["PGRST202", 503]]) {
    const blocked = harness({ rpcError: { code, message: "Denied" } });
    assert.equal((await blocked.post({ reservationId })).status, status); assert.equal(blocked.notices.length, 0);
  }
});
test("notification failure does not fail an already saved refund request", async () => {
  const h = harness({ notificationFails: true }); assert.equal((await h.post({ reservationId })).status, 201);
});
