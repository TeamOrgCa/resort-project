import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

test("permission updates reject incompatible refund roles and the retired cashier-review grant", async () => {
  const writes = [];
  const { PUT } = loadTsModule("app/api/admin/permissions/route.ts", {
    "@/lib/server/admin-audit": { requireAdminStaff: async () => ({ staffUser: { id: "admin" } }), createAuditLog: async () => {} },
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: () => ({ upsert: async rows => { writes.push(rows); return { error: null }; } }) }) },
  });
  const put = roles => PUT(new Request("http://localhost", { method: "PUT", body: JSON.stringify({ roles }) }));
  for (const [role, permission] of [["cashier", "refund_approval"], ["cashier", "refund_verify"], ["staff", "refund_payout"], ["cashier", "refund_review"]]) {
    assert.equal((await put([{ role, permissions: [permission] }])).status, 400);
  }
  assert.equal(writes.length, 0);
  assert.equal((await put([{ role: "staff", permissions: ["transactions", "refund_approval", "refund_verify"] }, { role: "cashier", permissions: ["transactions", "refund_payout"] }])).status, 200);
  assert.equal(writes.length, 1);
});

test("refund responses expose actions only to their required role even if every grant is supplied", async () => {
  for (const role of ["staff", "cashier", "admin"]) {
    const { GET } = loadTsModule("app/api/admin/refunds/route.ts", {
      "@/lib/server/admin-audit": { requireActiveStaff: async () => ({ supabase: {}, staffUser: { id: role, role } }) },
      "@/lib/server/role-permissions": { staffHasPermission: async () => true },
      "@/lib/server/fetch-all-pages": { fetchAllPages: async () => [], fetchByIds: async () => [] },
      "@/lib/booking/reservation-guest-names": { loadReservationGuestNames: async () => ({}) },
    });
    const response = await GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual((await response.json()).permissions, {
      canPay: role === "cashier", canVerify: role === "staff", canApprove: role === "staff", staffId: role,
    });
  }
});
