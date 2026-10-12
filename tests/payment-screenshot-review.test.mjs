import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

function harness({ receiptTime = "2026-10-13T01:15:00Z", authorized = true, permission = true, status = "pending", reservationStatus = "payment_submitted" } = {}) {
  const updates = [];
  const supabase = { from: table => {
    let updating = false;
    const query = { select: () => query, eq: () => query, update: data => { updates.push(data); updating = true; return query; },
      maybeSingle: async () => ({ error: null, data: updating ? null : table === "payments"
        ? { payment_id: "payment", reservation_id: "reservation", status, amount: 1500, receipt_paid_at: receiptTime }
        : { reservation_id: "reservation", status: reservationStatus } }) };
    return query;
  } };
  const { POST } = loadTsModule("app/api/admin/payments/approve/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => authorized ? { supabase, staffUser: { role: "admin" } } : null },
    "@/lib/server/role-permissions": { staffHasPermission: async () => permission },
    "@/lib/email": {}, "@/lib/notifications": {}, "@/lib/server/billing-email": {},
  });
  return { updates, post: body => POST(new Request("http://localhost/api/admin/payments/approve", { method: "POST", body: JSON.stringify({ paymentId: "payment", ...body }) })) };
}

test("new guest receipts cannot be approved without an explicit screenshot check", async () => {
  for (const screenshotReviewed of [undefined, false, "true", 1]) {
    const h = harness(); const response = await h.post({ screenshotReviewed });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /original GCash screenshot/);
    assert.equal(h.updates.length, 0);
  }
});

test("an explicit screenshot check reaches the guarded approval update and preserves race handling", async () => {
  const h = harness(); const response = await h.post({ screenshotReviewed: true });
  assert.equal(response.status, 409); // Simulated concurrent reviewer already took the pending row.
  assert.deepEqual(h.updates, [{ status: "verified" }]);
});

test("legacy and manual payments keep their existing approval workflow", async () => {
  const h = harness({ receiptTime: null }); const response = await h.post({});
  assert.equal(response.status, 409);
  assert.equal(h.updates.length, 1);
});

test("screenshot acknowledgement cannot bypass staff permission, status or reservation eligibility", async () => {
  for (const [options, expected] of [[{ authorized: false }, 401], [{ permission: false }, 403], [{ status: "verified" }, 409], [{ reservationStatus: "cancelled" }, 400]]) {
    const h = harness(options); assert.equal((await h.post({ screenshotReviewed: true })).status, expected);
    assert.equal(h.updates.length, 0);
  }
});
