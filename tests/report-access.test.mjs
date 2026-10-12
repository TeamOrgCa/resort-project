import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const staff = { supabase: {}, staffUser: { role: "front_desk" } };

test("guest reports require transactions permission and cannot be used to request other reports", async () => {
  const requested = [];
  const permissions = [];
  const mocks = {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => staff },
    "@/lib/server/role-permissions": { staffHasPermission: async (_client, _role, permission) => { permissions.push(permission); return permission === "transactions"; } },
    "@/lib/server/reports": { generateReport: async (_request, tab) => { requested.push(tab); return new Response("ok"); } },
  };
  const { GET } = loadTsModule("app/api/admin/transactions/guest-report/route.ts", mocks);
  assert.equal((await GET(new Request("https://example.com/api/admin/transactions/guest-report?tab=Staff%20Report"))).status, 200);
  assert.deepEqual(permissions, ["transactions"]);
  assert.deepEqual(requested, ["Guest Report"]);
  mocks["@/lib/server/role-permissions"].staffHasPermission = async () => false;
  assert.equal((await GET(new Request("https://example.com"))).status, 403);
  assert.deepEqual(requested, ["Guest Report"]);
  mocks["@/lib/server/admin-audit"].requireActiveStaff = async () => null;
  assert.equal((await GET(new Request("https://example.com"))).status, 401);
});

test("Reports accepts only sales and staff reports after the module move", async () => {
  const requested = [];
  const { GET } = loadTsModule("app/api/admin/reports/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => staff },
    "@/lib/server/role-permissions": { staffHasPermission: async (_client, _role, permission) => permission === "reports" },
    "@/lib/server/reports": { generateReport: async (_request, tab) => { requested.push(tab); return new Response("ok"); } },
  });
  for (const tab of ["Financial Report", "Guest Report", "Unknown Report"]) {
    assert.equal((await GET(new Request(`https://example.com/api/admin/reports?tab=${encodeURIComponent(tab)}`))).status, 400);
  }
  for (const tab of ["Sales Report", "Staff Report"]) assert.equal((await GET(new Request(`https://example.com/api/admin/reports?tab=${encodeURIComponent(tab)}`))).status, 200);
  assert.deepEqual(requested, ["Sales Report", "Staff Report"]);
});

test("middleware maps the guest report and image uploads to their owning modules", () => {
  const { apiPermission } = loadTsModule("lib/auth/role-access.ts");
  assert.equal(apiPermission("/api/admin/transactions/guest-report", "GET"), "transactions");
  assert.equal(apiPermission("/api/admin/settings/images", "POST"), "configuration");
});
