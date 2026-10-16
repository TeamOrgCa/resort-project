import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const { contentDefinitions } = loadTsModule("lib/settings/content-catalog.ts");
function harness({ authorized = true, fail = false } = {}) {
  const writes = [], audits = [];
  const { POST } = loadTsModule("app/api/admin/settings/content-defaults/route.ts", {
    "@/lib/server/admin-audit": { requireAdminStaff: async () => authorized ? { supabase: {}, staffUser: { role: "admin", id: "admin" } } : null,
      createAuditLog: async (_context, entry) => { audits.push(entry); return true; } },
    "@/lib/settings/settingsService": { updateSettings: async (_client, updates) => {
      if (fail) throw Error("Offline"); writes.push(updates);
      return { "resort.name": "Keep resort details", ...Object.fromEntries(updates.map(update => [update.key, update.value])) };
    } },
  });
  return { writes, audits, post: () => POST(new Request("http://localhost/api/admin/settings/content-defaults", { method: "POST", body: JSON.stringify({ updates: [{ key: "payments.accepted_methods", value: [] }] }) })) };
}

test("restoring website defaults uses server-defined text/images and preserves operational settings", async () => {
  const h = harness(); const response = await h.post(); const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.success, true);
  assert.deepEqual(h.writes[0], contentDefinitions.map(definition => ({ key: definition.key, value: definition.defaultValue })));
  assert.ok(h.writes[0].every(update => update.key.startsWith("content.")));
  assert.equal(result.settings["resort.name"], "Keep resort details");
  assert.equal(result.settings["content.branding.logo"], "/website_logo_transparent.png");
  assert.equal(h.audits[0].action, "Restored default website content");
  for (const definition of contentDefinitions.filter(item => item.input === "image")) assert.ok(existsSync(`public${definition.defaultValue}`), definition.key);
});

test("website reset requires administrator access and failures never claim success", async () => {
  const blocked = harness({ authorized: false }); assert.equal((await blocked.post()).status, 401); assert.equal(blocked.writes.length, 0);
  const failed = harness({ fail: true }); const response = await failed.post(); assert.equal(response.status, 500);
  assert.equal((await response.json()).success, false); assert.equal(failed.audits.length, 0);
});
