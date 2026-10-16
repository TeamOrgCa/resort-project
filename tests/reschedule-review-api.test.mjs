import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

function harness({ permitted = true, rpcError = null } = {}) {
  const calls = [], notices = [];
  const future = new Date(Date.now() + 30 * 86400000).toISOString();
  const request = { reschedule_id: "request", reservation_id: "booking", status: "pending", new_start: future, new_end: new Date(Date.parse(future) + 8 * 3600000).toISOString(), reschedule_fee: 300, rate_adjustment: 500 };
  const admin = {
    from(table) { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === "reservation_reschedules" ? request : { guest_id: "guest", reference_number: "MV-TEST", status: "reschedule_requested" }, error: null }) }; return query; },
    rpc: async (name, args) => { calls.push({ name, args }); return { data: { totalAmount: 3800, paidAmount: 600, additionalCharge: 800 }, error: rpcError }; },
  };
  const route = loadTsModule("app/api/admin/reschedule-requests/approve/route.ts", {
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/server/admin-audit": { requireActiveStaff: async () => ({ staffUser: { id: "manager", role: "manager" }, supabase: { from() { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { permissions: permitted ? ["reschedule_approval"] : [] }, error: null }) }; return q; } } }), createAuditLog: async () => true },
    "@/lib/server/reservation-availability": { checkReservationOverlap: async () => ({ conflict: false, error: null }) },
    "@/lib/notifications": { createNotifications: async value => { notices.push(value); return { error: null }; } },
  });
  return { calls, notices, post: () => route.POST(new Request("http://localhost/api/admin/reschedule-requests/approve", { method: "POST", body: JSON.stringify({ rescheduleId: "request" }) })) };
}

test("staff with reschedule approval permission can approve a short-notice guest request and notify the guest", async () => {
  const h = harness(); const response = await h.post(); const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.status, "approved"); assert.equal(result.rescheduleFee, 300);
  assert.equal(result.additionalCharge, 800); assert.equal(result.totalAmount, 3800);
  assert.deepEqual(h.calls, [{ name: "approve_reschedule_request", args: { p_reschedule_id: "request", p_staff_id: "manager" } }]);
  assert.equal(h.notices.length, 1); assert.equal(h.notices[0].guestId, "guest"); assert.equal(h.notices[0].title, "Reschedule approved");
});

test("staff without approval permission cannot approve or notify guests", async () => {
  const h = harness({ permitted: false }); assert.equal((await h.post()).status, 403);
  assert.equal(h.calls.length, 0); assert.equal(h.notices.length, 0);
});

test("an old approval function gives the administrator the required migration instead of rejecting the guest's request", async () => {
  const h = harness({ rpcError: { code: "22023", message: "This late request requires a documented staff exception. Reject it and use the reservation editor" } });
  const response = await h.post(); assert.equal(response.status, 503);
  assert.match((await response.json()).message, /guest-reschedule-requests-migration.sql/); assert.equal(h.notices.length, 0);
});
