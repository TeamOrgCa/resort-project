import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const access = loadTsModule("lib/auth/role-access.ts");

test("admins have every permission without requiring role grants", () => {
  for (const permission of access.PERMISSIONS) {
    assert.equal(access.hasPermission("admin", access.PERMISSIONS, permission), true, permission);
  }
  assert.equal(access.getDefaultRouteForRole("admin", []), "/admin/users");
  assert.equal(access.hasPermission("staff", ["refund_approval"], "refund_approval"), true);
  assert.equal(access.hasPermission("cashier", ["refund_approval"], "refund_approval"), false);
  assert.equal(access.hasPermission("cashier", ["refund_verify"], "refund_verify"), false);
  assert.equal(access.hasPermission("staff", ["refund_payout"], "refund_payout"), false);
  assert.equal(access.hasPermission("cashier", ["refund_payout"], "refund_payout"), true);
  assert.equal(access.hasPermission("staff", ["refund_verify"], "refund_verify"), true);
  assert.equal(access.PERMISSIONS.includes("refund_review"), false);
  for (const role of ["staff", "cashier"]) {
    for (const permission of ["users", "configuration", "catalog"]) assert.equal(access.hasPermission(role, access.PERMISSIONS, permission), false);
  }
});

test("admin operational requests permit writes while route permissions remain in force", () => {
  for (const path of ["/api/admin/refunds", "/api/admin/maintenance-blocks", "/api/admin/maintenance-blocks-evil", "/api/admin/reservations/create", "/api/admin/payments/manual-entry", "/api/admin/analytics/feedback", "/api/admin/unknown", "/api/admin/settings-evil"]) {
    for (const method of ["GET", "HEAD", "OPTIONS"]) assert.equal(access.isAdminReadOnlyRequest("admin", path, method), false);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(access.isAdminReadOnlyRequest("admin", path, method), false, path);
    assert.equal(access.isAdminReadOnlyRequest("staff", path, "POST"), false);
  }
  for (const path of ["/api/admin/users", "/api/admin/users/example", "/api/admin/permissions", "/api/admin/settings", "/api/admin/catalog/rates", "/api/admin/booking-policy", "/api/admin/payment-accounts", "/api/admin/auth/logout"]) {
    assert.equal(access.isAdminReadOnlyRequest("admin", path, "POST"), false, path);
  }
});
