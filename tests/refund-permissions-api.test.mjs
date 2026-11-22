import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

test("refund details include original sender accounts, payment method and cancellation context", async () => {
  const selects = {};
  const rows = {
    refund_requests: [{ refund_id: "refund", reservation_id: "reservation" }],
    reservations: [{ reservation_id: "reservation", cancellation_reason: "Family plans changed", cancellation_initiator: "guest" }],
    payments: [{ payment_id: "payment", reservation_id: "reservation", account_name: "Ana Santos", account_number: "09171234567", payment_methods: { name: "GCash" } }],
  };
  const client = { from: table => {
    const query = { select: fields => { selects[table] = fields; return query; }, in: () => query, eq: () => query, order: () => query,
      range: async from => ({ data: from === 0 ? rows[table] ?? [] : [], error: null }) };
    return query;
  } };
  const { GET } = loadTsModule("app/api/admin/refunds/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => ({ supabase: client, staffUser: { id: "cashier", role: "cashier" } }) },
    "@/lib/server/role-permissions": { staffHasPermission: async () => true },
    "@/lib/booking/reservation-guest-names": { loadReservationGuestNames: async () => ({ reservation: "Ana Santos" }) },
  });
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const data = await response.json();
  for (const field of ["account_name", "account_number", "payment_methods(name)"]) assert.ok(selects.payments.includes(field));
  assert.deepEqual(data.payments, rows.payments);
  assert.equal(data.reservations[0].cancellation_reason, "Family plans changed");
});

test("permission updates reject incompatible refund roles and the retired cashier-review grant", async () => {
  const writes = [];
  const { PUT } = loadTsModule("app/api/admin/permissions/route.ts", {
    "@/lib/server/admin-audit": { requireAdminStaff: async () => ({ staffUser: { id: "admin" } }), createAuditLog: async () => {} },
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: () => ({ upsert: async rows => { writes.push(rows); return { error: null }; } }) }) },
  });
  const put = roles => PUT(new Request("http://localhost", { method: "PUT", body: JSON.stringify({ roles }) }));
  for (const [role, permission] of [["cashier", "refund_approval"], ["cashier", "refund_verify"], ["staff", "refund_payout"], ["cashier", "refund_review"], ["cashier", "feedback_moderation"]]) {
    assert.equal((await put([{ role, permissions: [permission] }])).status, 400);
  }
  assert.equal(writes.length, 0);
  assert.equal((await put([{ role: "staff", permissions: ["transactions", "refund_approval", "refund_verify"] }, { role: "cashier", permissions: ["transactions", "refund_payout"] }])).status, 200);
  assert.equal(writes.length, 1);
  assert.equal((await put([{ role: "staff", permissions: ["analytics", "feedback_moderation"] }])).status, 200);
  assert.deepEqual(writes[1][0].permissions, ["analytics", "feedback_moderation"]);
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
      canPay: ["admin", "cashier"].includes(role), canVerify: ["admin", "staff"].includes(role), canApprove: ["admin", "staff"].includes(role), staffId: role,
    });
  }
});
