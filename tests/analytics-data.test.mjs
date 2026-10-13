import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

function analytics(tables = {}) {
  const calls = [];
  const client = { from(table) {
    const filters = []; let verifiedRange = null;
    const query = { select: () => query, order: () => query,
      eq: (key, value) => { filters.push(row => row[key] === value); return query; },
      gte: (key, value) => { filters.push(row => row[key] >= value); return query; },
      lt: (key, value) => { filters.push(row => row[key] < value); return query; },
      or: value => { verifiedRange = [value.match(/verified_at.gte.([^,]+)/)[1], value.match(/verified_at.lt.([^,)]+)/)[1]]; return query; },
      range: async (from, to) => { calls.push({ table, from, to, verifiedRange }); return { data: (tables[table] ?? []).filter(row => filters.every(filter => filter(row)) && (!verifiedRange || (row.verified_at ?? row.created_at) >= verifiedRange[0] && (row.verified_at ?? row.created_at) < verifiedRange[1])).slice(from, to + 1), error: null }; },
    }; return query;
  } };
  const { generateAnalytics } = loadTsModule("lib/server/analytics.ts", { "@/lib/supabase/admin": { createAdminClient: () => client } });
  return { generateAnalytics, calls };
}
const payment = (amount, extras = {}) => ({ amount, status: "verified", payment_type: "downpayment", created_at: "2026-10-01T01:00:00Z", verified_at: "2026-10-02T01:00:00Z", ...extras });
test("analytics uses verification dates, legacy fallback and selected calendar days for forecasts", async () => {
  const h = analytics({ payments: [payment(4500, { created_at: "2026-09-01T00:00:00Z" }), payment(1500, { verified_at: null }), payment(800, { status: "pending" }), payment(4000, { verified_at: "2026-10-04T01:00:00Z" })], reservations: [{ booking_type: "online", created_at: "2026-10-01T01:00:00Z" }, { booking_type: "walk_in", created_at: "2026-10-02T01:00:00Z" }, { booking_type: null, created_at: "2026-10-03T01:00:00Z" }] });
  const reports = await h.generateAnalytics("Custom", { startDate: "2026-10-01", endDate: "2026-10-03" }, new Date("2026-10-03T01:00:00Z"));
  assert.equal(reports.revenue.metrics[0].value, 6000); assert.equal(reports.revenue.metrics[1].value, 2000); assert.equal(reports.revenue.metrics[2].value, 2000);
  assert.equal(reports.revenue.trend.reduce((sum, p) => sum + p.value, 0), 6000);
  assert.equal(reports.revenue.split.reduce((sum, p) => sum + p.value, 0), 6000, "A pie must not mix future estimates with historical collections");
  assert.equal(reports.revenue.rows[0].projectedBookings, "1"); assert.match(reports.revenue.rows[0].periodLabel, /Oct 4, 2026/);
  assert.match(reports.revenue.note, /3 calendar days/); assert.match(reports.revenue.note, /no statistical confidence/);
  assert.equal(reports.booking.split.find(p => p.label === "Unspecified").value, 1);
  assert.equal(reports.performance.metrics[0].value, 1); assert.equal(reports.performance.metrics[1].value, 3);
  assert.equal(reports.performance.split.reduce((sum, p) => sum + p.value, 0), 3);
});

test("weekly and monthly forecasts are not multiplied twice and use actual calendar lengths", async () => {
  const weekly = await analytics({ payments: [payment(28000)] }).generateAnalytics("Weekly", undefined, new Date("2026-10-13T01:00:00Z"));
  assert.equal(weekly.revenue.metrics[1].value, 1000); assert.equal(weekly.revenue.metrics[2].value, 7000);
  const monthly = await analytics({ payments: [payment(18300, { created_at: "2024-03-15T01:00:00Z", verified_at: "2024-03-15T01:00:00Z" })] }).generateAnalytics("Monthly", undefined, new Date("2024-03-31T01:00:00Z"));
  assert.equal(monthly.revenue.metrics[1].value, 100); assert.equal(monthly.revenue.metrics[2].value, 3000);
  assert.match(monthly.revenue.rows[0].evidence, /183 calendar days/); assert.equal(new Set(monthly.booking.trend.map(p => p.label)).size, 6);
});

test("analytics paginates all sources and returns honest empty estimates", async () => {
  const h = analytics({ reservations: Array.from({ length: 1001 }, () => ({ booking_type: "online", created_at: "2026-10-01T01:00:00Z" })) });
  const reports = await h.generateAnalytics("Custom", { startDate: "2026-10-01", endDate: "2026-10-03" });
  assert.equal(reports.booking.metrics[0].value, 1001); assert.ok(h.calls.some(c => c.from === 1000));
  assert.equal(reports.revenue.metrics[2].value, 0); assert.match(reports.revenue.note, /No verified payments/);
  const invalid = analytics(); await assert.rejects(invalid.generateAnalytics("Custom", { startDate: "2026-02-30", endDate: "2026-03-01" })); assert.equal(invalid.calls.length, 0);
});

function route({ active = true, allowed = true, reviews = [], modelResult } = {}) {
  const calls = [];
  const query = { select: () => query, eq: (key, value) => { calls.push([key, value]); return query; }, gte: () => query, lt: () => query, order: () => query, limit: async size => { calls.push(["limit", size]); return { data: reviews.slice(0, size), error: null }; } };
  const handlers = loadTsModule("app/api/admin/analytics/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => active ? { supabase: {}, staffUser: { role: "staff" } } : null },
    "@/lib/server/role-permissions": { staffHasPermission: async (_client, _role, permission) => { calls.push(["permission", permission]); return allowed; } },
    "@/lib/server/analytics": { generateAnalytics: async () => ({ booking: {}, revenue: {}, performance: {} }) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: () => query }) },
    "@google/generative-ai": { GoogleGenerativeAI: class { getGenerativeModel() { return { generateContent: async () => ({ response: { text: () => modelResult } }) }; } } },
  });
  return { ...handlers, calls };
}
const post = body => new Request("http://localhost/api/admin/analytics", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
test("analytics enforces module permission on reads and actions, rejects invalid input and prevents caching", async () => {
  const request = new Request("http://localhost/api/admin/analytics");
  for (const method of ["GET", "POST"]) {
    assert.equal((await route({ active: false })[method](method === "GET" ? request : post({ action: "forecast" }))).status, 401);
    assert.equal((await route({ allowed: false })[method](method === "GET" ? request : post({ action: "sentiment" }))).status, 403);
  }
  const h = route(); assert.equal((await h.GET(request)).headers.get("cache-control"), "no-store"); assert.deepEqual(h.calls[0], ["permission", "analytics"]);
  assert.equal((await h.GET(new Request("http://localhost/api/admin/analytics?period=unsupported"))).status, 400);
  assert.equal((await h.POST(post({ action: "unknown" }))).status, 400);
  assert.equal((await h.POST(post({ action: "sentiment", period: "Custom", startDate: "2026-02-30", endDate: "2026-03-01" }))).status, 400);
});

test("feedback analysis handles empty reviews, caps the sample and rejects malformed percentages", async () => {
  const original = process.env.GEMINI_API_KEY; process.env.GEMINI_API_KEY = "test-only-key";
  try {
    const empty = await (await route().POST(post({ action: "sentiment" }))).json(); assert.equal(empty.sentiment.sampleSize, 0); assert.equal(empty.sentiment.overallSentiment, "No approved reviews");
    const reviews = Array.from({ length: 101 }, () => ({ review_text: "Great stay", overall_rating: 5 }));
    const h = route({ reviews, modelResult: '```json\n{"overallSentiment":"Positive","positivePercent":80,"neutralPercent":15,"negativePercent":5,"themes":["Pool"],"summary":"Mostly positive."}\n```' });
    const response = await h.POST(post({ action: "sentiment" })); const { sentiment } = await response.json(); assert.equal(response.status, 200); assert.equal(sentiment.sampleSize, 100); assert.equal(sentiment.positivePercent, 80); assert.ok(h.calls.some(c => c[0] === "is_approved" && c[1] === true));
    const malformed = route({ reviews, modelResult: '{"overallSentiment":"Positive","positivePercent":500,"neutralPercent":0,"negativePercent":0,"themes":[],"summary":"Broken"}' });
    assert.equal((await malformed.POST(post({ action: "sentiment" }))).status, 500);
    delete process.env.GEMINI_API_KEY; assert.equal((await route({ reviews }).POST(post({ action: "sentiment" }))).status, 503);
  } finally { if (original === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = original; }
});
