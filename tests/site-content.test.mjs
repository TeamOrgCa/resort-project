import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { contentImageExtension } from "../lib/settings/content-images.ts";

const { isContentImageUrl, publicContentKeys } = loadTsModule("lib/settings/public-content.ts");

test("content image URLs allow local/HTTPS assets and reject executable or ambiguous URLs", () => {
  for (const value of ["/website_photo.jpg", "https://images.example.com/logo.png"]) assert.equal(isContentImageUrl(value), true);
  for (const value of ["javascript:alert(1)", "data:image/svg+xml,test", "//example.com/logo.png", "/\\example.com/logo.png", "http://example.com/logo.png", "", " /image.png", {}, 42]) assert.equal(isContentImageUrl(value), false);
});

test("image uploads reject forged MIME types and active SVG content", () => {
  assert.equal(contentImageExtension(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"), "png");
  assert.equal(contentImageExtension(new Uint8Array([255, 216, 255]), "image/jpeg"), "jpg");
  assert.equal(contentImageExtension(Buffer.from("RIFF0000WEBP"), "image/webp"), "webp");
  assert.equal(contentImageExtension(Buffer.from("<svg onload='alert(1)'/>"), "image/png"), null);
  assert.equal(contentImageExtension(Buffer.from("<svg/>"), "image/svg+xml"), null);
});

test("public content returns saved values and defaults without exposing operational settings", async () => {
  const requested = [];
  const client = { from: () => ({ select: () => ({ in: async (_column, keys) => {
    requested.push(...keys);
    return { data: [{ setting_key: "content.home.hero_title", setting_value: "A new welcome" },
      { setting_key: "notifications.email_templates", setting_value: { private: "secret" } }], error: null };
  } }) }) };
  const { GET } = loadTsModule("app/api/site-content/route.ts", { "@/lib/supabase/admin": { createAdminClient: () => client } });
  const response = await GET(); const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.settings["content.home.hero_title"], "A new welcome");
  assert.equal(body.settings["content.branding.logo"], "/website_logo_transparent.png");
  assert.equal("notifications.email_templates" in body.settings, false);
  assert.deepEqual(requested, publicContentKeys);
  assert.ok(requested.every((key) => key.startsWith("content.") || key.startsWith("resort.")));
});

test("admin content saves reject malformed, oversized, and unsafe content", async () => {
  let written = false;
  const staff = { supabase: {}, staffUser: { role: "admin" } };
  const { PATCH } = loadTsModule("app/api/admin/settings/route.ts", {
    "@/lib/server/admin-audit": { requireAdminStaff: async () => staff, createAuditLog: async () => true },
    "@/lib/settings/settingsService": { updateSettings: async () => { written = true; return {}; } },
  });
  for (const updates of [[null], [{ key: "content.home.hero_title", value: 45 }],
    [{ key: "content.home.hero_title", value: "x".repeat(10001) }],
    [{ key: "content.branding.logo", value: "javascript:alert(1)" }], [{ key: "content.unknown", value: "text" }]]) {
    const response = await PATCH(new Request("https://example.com/api/admin/settings", { method: "PATCH", body: JSON.stringify({ updates }) }));
    assert.equal(response.status, 400);
  }
  assert.equal(written, false);
});

test("content saves preserve plain text and require admin authorization", async () => {
  const updates = [{ key: "content.home.hero_title", value: "Welcome\n<script>literal text</script>" }];
  let saved;
  const mocks = {
    "@/lib/server/admin-audit": { requireAdminStaff: async () => ({ supabase: {}, staffUser: { role: "admin" } }), createAuditLog: async () => true },
    "@/lib/settings/settingsService": { updateSettings: async (_client, values) => { saved = values; return {}; } },
  };
  const { PATCH } = loadTsModule("app/api/admin/settings/route.ts", mocks);
  assert.equal((await PATCH(new Request("https://example.com", { method: "PATCH", body: JSON.stringify({ updates }) }))).status, 200);
  assert.deepEqual(saved, updates);
  mocks["@/lib/server/admin-audit"].requireAdminStaff = async () => null;
  assert.equal((await PATCH(new Request("https://example.com", { method: "PATCH", body: "{}" }))).status, 401);
  const { POST } = loadTsModule("app/api/admin/settings/images/route.ts", mocks);
  assert.equal((await POST(new Request("https://example.com", { method: "POST" }))).status, 401);
});
