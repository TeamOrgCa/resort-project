import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const base = { review_id: id, public_display_name: "Guest", overall_rating: 5, title: "Lovely visit", review_text: "A lovely visit with our family.", is_approved: true, created_at: "2026-10-13T00:00:00Z", archived_at: null, archive_reason: null, image_path: "private/photo.png" };
const range = "period=Custom&startDate=2026-10-01&endDate=2026-10-31";
function harness({ active = true, analytics = true, archive = true, rpcError = null } = {}) {
  const calls = { client: 0, filters: [], rpc: [], signed: [] };
  const admin = { from() {
    const filters = []; let offset;
    const q = { select: () => q, order: () => q,
      gte: (key, value) => { calls.filters.push([key, ">=", value]); filters.push(r => r[key] >= value); return q; },
      lt: (key, value) => { filters.push(r => r[key] < value); return q; },
      is: (key, value) => { filters.push(r => r[key] === value); return q; },
      not: (key) => { filters.push(r => r[key] !== null); return q; },
      ilike: (key, value) => { calls.filters.push([key, "ilike", value]); return q; },
      range: async (from, to) => { offset = [from, to]; const rows = [base, { ...base, review_id: "archived", archived_at: "2026-10-15T01:00:00Z" }].filter(r => filters.every(f => f(r))); return { data: rows.slice(offset[0], offset[1] + 1), count: rows.length, error: null }; } };
    return q;
  }, storage: { from: () => ({ createSignedUrls: async (paths, ttl) => { calls.signed.push({ paths, ttl }); return { data: paths.map(path => ({ path, signedUrl: "https://example.com/photo", error: null })) }; } }) } };
  const route = loadTsModule("app/api/admin/analytics/feedback/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => active ? { staffUser: { role: "staff" }, supabase: { rpc: async (name, args) => { calls.rpc.push({ name, args }); return { data: { review_id: id }, error: rpcError }; } } } : null },
    "@/lib/server/role-permissions": { staffHasPermission: async (_db, _role, permission) => permission === "analytics" ? analytics : archive },
    "@/lib/supabase/admin": { createAdminClient: () => { calls.client++; return admin; } },
  });
  return { calls, get: (query = range) => route.GET(new Request("http://localhost/api/admin/analytics/feedback?" + query)),
    patch: body => route.PATCH(new Request("http://localhost/api/admin/analytics/feedback", { method: "PATCH", body: JSON.stringify(body) })) };
}
const change = { reviewId: id, archive: true, reason: "Guest privacy request", expectedArchivedAt: null };
test("feedback reads enforce permission and filters, use Philippine dates and protect photo storage paths", async () => {
  for (const [options, status] of [[{ active: false }, 401], [{ analytics: false }, 403]]) { const h = harness(options); assert.equal((await h.get()).status, status); assert.equal(h.calls.client, 0); }
  const h = harness({ archive: false }); const response = await h.get(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.rows.length, 1); assert.equal(body.rows[0].image_path, undefined); assert.equal(body.rows[0].image_url, "https://example.com/photo");
  assert.equal(body.canArchive, false); assert.equal(h.calls.signed[0].ttl, 600);
  assert.equal(h.calls.filters[0][2], "2026-09-30T16:00:00.000Z");
  assert.equal((await (await h.get(range + "&status=archived")).json()).rows[0].review_id, "archived");
  for (const extra of ["&status=unknown", "&page=-1", "&page=1.5", "&search=" + "x".repeat(201)]) assert.equal((await h.get(range + extra)).status, 400);
});
test("archive mutations require both permissions, validate reason and preserve concurrency errors", async () => {
  for (const options of [{ archive: false }, { analytics: false }]) { const h = harness(options); assert.equal((await h.patch(change)).status, 403); assert.equal(h.calls.rpc.length, 0); }
  const h = harness();
  for (const body of [{ ...change, reason: " " }, { ...change, archive: "true" }, { ...change, expectedArchivedAt: undefined }, { ...change, reviewId: "bad" }]) assert.equal((await h.patch(body)).status, 400);
  assert.equal((await h.patch(change)).status, 200); assert.equal(h.calls.rpc[0].name, "set_feedback_archived"); assert.equal(h.calls.rpc[0].args.p_expected_archived_at, null);
  for (const [code, status] of [["42501", 403], ["40001", 409], ["P0002", 404], ["22023", 400], ["PGRST202", 503]]) assert.equal((await harness({ rpcError: { code, message: "Review changed" } }).patch(change)).status, status);
});
test("permission mapping exposes a separately configurable feedback archive permission", () => {
  const { PERMISSIONS, apiPermission, hasPermission } = loadTsModule("lib/auth/role-access.ts");
  assert.ok(PERMISSIONS.includes("feedback_archive")); assert.equal(apiPermission("/api/admin/analytics/feedback", "GET"), "analytics");
  assert.equal(apiPermission("/api/admin/analytics/feedback", "PATCH"), "feedback_archive"); assert.equal(hasPermission("staff", ["analytics"], "feedback_archive"), false);
});
