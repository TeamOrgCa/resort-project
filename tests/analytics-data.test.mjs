import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

function analytics(tables = {}, failTable = null) {
  const calls = [];
  const client = { from(table) {
    const filters = []; const fields = []; let verifiedRange = null;
    const query = { select: () => query, order: () => query, in: (key, values) => { filters.push(row => values.includes(row[key])); return query; },
      eq: (key, value) => { fields.push([key, value]); filters.push(row => row[key] === value); return query; },
      gte: (key, value) => { filters.push(row => Date.parse(row[key]) >= Date.parse(value)); return query; },
      lt: (key, value) => { filters.push(row => Date.parse(row[key]) < Date.parse(value)); return query; },
      or: value => { verifiedRange = [value.match(/verified_at.gte.([^,]+)/)[1], value.match(/verified_at.lt.([^,)]+)/)[1]]; return query; },
      range: async (from, to) => { calls.push({ table, from, to, verifiedRange, fields }); if (table === failTable) return { data: null, error: { message: "Database unavailable" } }; return { data: (tables[table] ?? []).filter(row => filters.every(filter => filter(row)) && (!verifiedRange || Date.parse(row.verified_at ?? row.created_at) >= Date.parse(verifiedRange[0]) && Date.parse(row.verified_at ?? row.created_at) < Date.parse(verifiedRange[1]))).slice(from, to + 1), error: null }; },
    }; return query;
  } };
  const { generateAnalytics } = loadTsModule("lib/server/analytics.ts", { "@/lib/supabase/admin": { createAdminClient: () => client } });
  return { generateAnalytics, calls };
}
const payment = (amount, extras = {}) => ({ amount, status: "verified", payment_type: "downpayment", created_at: "2026-10-01T01:00:00Z", verified_at: "2026-10-02T01:00:00Z", ...extras });

const range = { startDate: "2026-10-01", endDate: "2026-10-03" };
const now = new Date("2026-10-03T16:00:00Z");
const reservation = (id, date, status = "confirmed", extras = {}) => ({ reservation_id: id, created_at: date, start_datetime: "2026-10-10T00:00:00Z", booking_type: "online", status, ...extras });

test("analytics counts received public and private collections on the correct Philippine dates", async () => {
  const h = analytics({ payments: [payment(4500, { created_at: "2026-09-01T00:00:00Z" }), payment(1500, { verified_at: null }), payment(800, { status: "pending" }), payment(4000, { verified_at: "2026-10-03T16:00:00Z" })], public_access_sales: [
    { sale_id: "public", access_type: "room", amount: 300, paid_at: "2026-09-30T16:00:00Z" },
    { sale_id: "boundary", access_type: "swimming", amount: 9999, paid_at: "2026-10-03T16:00:00Z" },
  ] });
  const reports = await h.generateAnalytics("Custom", range, now);
  assert.equal(reports.revenue.metrics[0].value, 6300);
  assert.equal(reports.revenue.split.find(point => point.label === "Room usage").value, 300);
  assert.equal(reports.revenue.trend.reduce((sum, point) => sum + point.value, 0), 6300);
  assert.equal(reports.revenue.split.reduce((sum, point) => sum + point.value, 0), 6300, "Future estimates never enter the received collections mix");
  assert.equal(reports.booking.metrics[0].value, 0, "Public access does not create reservations");
  assert.match(reports.revenue.note, /public collections use the server-recorded paid-at date/);
  assert.equal(reports.revenue.forecastPoints.length, 3);
  assert.equal(reports.revenue.forecastPoints[0].label, "2026-10-04");
  assert.equal(reports.revenue.metrics[1].value, 337.5, "6300 / 56 completed days, multiplied by 3 only once");
  assert.equal(reports.revenue.metrics[2].displayValue, "Not enough history");
  assert.match(reports.revenue.note, /not statistical confidence intervals/);
});

test("booking analysis compares equal elapsed durations and separates source, outcomes and lead time", async () => {
  const h = analytics({ reservations: [
    reservation("current-1", "2026-10-01T01:00:00Z"),
    reservation("current-2", "2026-10-02T01:00:00Z", "completed", { booking_type: "walk_in", commercial_type: "public_swimming" }),
    reservation("current-3", "2026-10-03T00:00:00Z", "cancelled", { booking_type: null, commercial_type: "room_accommodation" }),
    reservation("future", "2026-10-03T08:00:00Z"),
    reservation("prior", "2026-09-28T01:00:00Z", "confirmed"),
    reservation("prior-after-cutoff", "2026-09-30T08:00:00Z", "no_show"),
  ] });
  const report = (await h.generateAnalytics("Custom", range, new Date("2026-10-03T01:00:00Z"))).booking;
  assert.equal(report.metrics[0].value, 3); assert.match(report.metrics[0].help, /200%/);
  assert.equal(report.metrics[1].value, 66.67); assert.equal(report.metrics[2].value, 33.33);
  assert.equal(report.comparison.points.reduce((sum, p) => sum + (p.previous ?? 0), 0), 1);
  assert.equal(report.comparison.points.reduce((sum, p) => sum + (p.current ?? 0), 0), 3);
  assert.equal(report.comparison.startDate, "2026-09-28"); assert.equal(report.comparison.endDate, "2026-09-30");
  assert.equal(report.rows.find(row => row.source === "Offline booking").confirmationRate, "100%");
  assert.deepEqual(report.rows.map(row => row.source), ["Online booking", "Offline booking"]);
  assert.deepEqual(report.split.map(point => point.label), ["Private Swimming", "Public Swimming", "Room Accommodation"]);
  assert.deepEqual(report.split.map(point => point.value), [1, 1, 1]);
  assert.match(report.insights.find(item => item.title === "Channel contribution").description, /50% of bookings with a recorded source/);
  assert.match(report.note, /overall totals include every booking/);
  assert.match(report.insights.find(item => item.title === "Booking lead time").description, /8 calendar days/);
  assert.match(report.note, /newer bookings have had less time/i);
  assert.match(report.note, /not occupancy rates/);
});

test("zero prior activity is labelled honestly and unobserved dates remain gaps", async () => {
  const report = (await analytics({ reservations: [reservation("new", "2026-10-01T01:00:00Z")] }).generateAnalytics("Custom", range, new Date("2026-10-01T02:00:00Z"))).booking;
  assert.match(report.metrics[0].help, /previous period had none/); assert.doesNotMatch(report.metrics[0].help, /Infinity|100%/);
  assert.equal(report.comparison.points[0].previous, 0);
  assert.equal(report.comparison.points[1].current, null);
  assert.equal(report.comparison.points[2].previous, null);
  const future = await analytics().generateAnalytics("Custom", { startDate: "2026-10-10", endDate: "2026-10-12" }, now);
  assert.ok(future.booking.comparison.points.every(p => p.current === null && p.previous === null));
  assert.match(future.booking.note, /dates have not started/);
  assert.equal(future.booking.metrics[1].displayValue, "No bookings");
});

test("operations analyses submission outcomes, valid verification times and ALL pending backlog ages", async () => {
  const h = analytics({ payments: [
    payment(500, { payment_id: "valid", created_at: "2026-10-01T01:00:00Z", verified_at: "2026-10-01T03:00:00Z" }),
    payment(500, { payment_id: "legacy", verified_at: null }),
    payment(500, { payment_id: "bad-clock", verified_at: "2026-09-30T01:00:00Z" }),
    payment(100, { payment_id: "rejected", status: "rejected" }),
    payment(200, { payment_id: "fresh", status: "pending", created_at: "2026-10-03T15:00:00Z" }),
    payment(300, { payment_id: "day-old", status: "pending", created_at: "2026-10-02T16:00:00Z" }),
    payment(400, { payment_id: "three-days", status: "pending", created_at: "2026-09-30T16:00:00Z" }),
    payment(1000, { payment_id: "old", status: "pending", created_at: "2026-08-01T01:00:00Z" }),
    payment(500, { payment_id: "prior-done", created_at: "2026-09-28T01:00:00Z" }),
    payment(600, { payment_id: "prior-pending", status: "pending", created_at: "2026-09-29T01:00:00Z" }),
  ], public_access_sales: [{ sale_id: "public", access_type: "swimming", amount: 9000, paid_at: "2026-10-02T01:00:00Z" }] });
  const report = (await h.generateAnalytics("Custom", range, now)).performance;
  assert.equal(report.metrics[0].value, 57.14, "4 resolved out of 7 submitted in the selected period");
  assert.equal(report.metrics[1].value, 2, "Legacy and negative verification durations are excluded");
  assert.equal(report.metrics[2].value, 2500, "Includes old pending submissions outside the filter, excludes public receipts");
  assert.deepEqual(report.rows.map(row => row.pending), ["1", "1", "3"]);
  assert.deepEqual(report.split.map(p => p.value), [1, 1, 3]);
  assert.match(report.insights[0].description, /7.14 percentage points/);
  assert.equal(report.insights[1].href, "/admin/transactions?tab=payments");
  assert.equal(report.comparison.format, "percent");
  assert.equal(report.comparison.points[2].current, 0, "Submissions with none resolved is measured zero");
  assert.ok(h.calls.every(call => call.table !== "audit_logs"), "Audit activity counts must not masquerade as productivity");
});

test("empty operations is unavailable rather than a fake zero performance measure", async () => {
  const reports = await analytics().generateAnalytics("Custom", range, now);
  assert.equal(reports.performance.metrics[0].displayValue, "No submissions");
  assert.equal(reports.performance.metrics[1].displayValue, "Not available");
  assert.ok(reports.performance.comparison.points.every(p => p.current === null));
  assert.equal(reports.revenue.metrics[1].value, 0);
  assert.equal(reports.revenue.metrics[2].displayValue, "Not enough history");
  assert.match(reports.revenue.insights[1].description, /No received payments/);
});

test("forecasts use 56 complete days and seven or thirty future days without unfinished-day leakage", async () => {
  const reference = new Date("2026-10-13T01:00:00Z");
  const completeEnd = Date.parse("2026-10-12T16:00:00Z");
  const payments = Array.from({ length: 56 }, (_, i) => payment(100, { payment_id: `history-${i}`, created_at: new Date(completeEnd - (56 - i) * 86400000).toISOString(), verified_at: new Date(completeEnd - (56 - i) * 86400000).toISOString() }));
  payments.push(payment(1000000, { payment_id: "unfinished-day", created_at: "2026-10-13T00:00:00Z", verified_at: "2026-10-13T00:00:00Z" }));
  for (const [period, days] of [["Weekly", 7], ["Monthly", 30]]) {
    const report = (await analytics({ payments }).generateAnalytics(period, undefined, reference)).revenue;
    assert.equal(report.forecastPoints.length, days); assert.equal(report.metrics[1].value, 100 * days);
    assert.equal(report.metrics[2].value, 0); assert.equal(report.metrics[2].displayValue, undefined, "This zero is a measured perfect held-out match");
    assert.match(report.metrics[1].help, /Day-of-week average/);
    assert.equal(report.forecastPoints[0].label, "2026-10-14");
    assert.ok(report.metrics[0].value > 1000000, "Today's actual collections are still included");
  }
});

test("analytics paginates all queried sources, propagates database errors and validates ranges before querying", async () => {
  const h = analytics({
    reservations: Array.from({ length: 1001 }, (_, i) => reservation(`r-${i}`, "2026-10-01T01:00:00Z")),
    payments: Array.from({ length: 1001 }, (_, i) => payment(1, { payment_id: `verified-${i}` })).concat(Array.from({ length: 1001 }, (_, i) => payment(2, { payment_id: `pending-${i}`, status: "pending" }))),
    public_access_sales: Array.from({ length: 1001 }, (_, i) => ({ sale_id: `sale-${i}`, amount: 3, paid_at: "2026-10-01T01:00:00Z", access_type: "swimming" })),
  });
  const reports = await h.generateAnalytics("Custom", range, now);
  assert.equal(reports.booking.metrics[0].value, 1001);
  assert.equal(reports.revenue.metrics[0].value, 4004);
  assert.equal(reports.performance.metrics[2].value, 2002);
  for (const table of ["reservations", "payments", "public_access_sales"]) assert.ok(h.calls.some(c => c.table === table && c.from === 1000));
  assert.ok(h.calls.some(c => c.table === "payments" && c.from === 1000 && c.fields.some(([key, value]) => key === "status" && value === "pending")));
  await assert.rejects(analytics({}, "payments").generateAnalytics("Custom", range, now), /Database unavailable/);
  const invalid = analytics(); await assert.rejects(invalid.generateAnalytics("Custom", { startDate: "2026-02-30", endDate: "2026-03-01" }, now)); assert.equal(invalid.calls.length, 0);
});

function route({ active = true, allowed = true, reviews = [], modelResult } = {}) {
  const calls = [];
  const query = { select: () => query, eq: (key, value) => { calls.push([key, value]); return query; }, is: (key, value) => { calls.push([key, value]); return query; }, gte: () => query, lt: () => query, order: () => query, limit: async size => { calls.push(["limit", size]); return { data: reviews.slice(0, size), error: null }; } };
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
    const response = await h.POST(post({ action: "sentiment" })); const { sentiment } = await response.json(); assert.equal(response.status, 200); assert.equal(sentiment.sampleSize, 100); assert.equal(sentiment.positivePercent, 80); assert.ok(h.calls.some(c => c[0] === "is_approved" && c[1] === true)); assert.ok(h.calls.some(c => c[0] === "archived_at" && c[1] === null));
    const malformed = route({ reviews, modelResult: '{"overallSentiment":"Positive","positivePercent":500,"neutralPercent":0,"negativePercent":0,"themes":[],"summary":"Broken"}' });
    assert.equal((await malformed.POST(post({ action: "sentiment" }))).status, 500);
    delete process.env.GEMINI_API_KEY; assert.equal((await route({ reviews }).POST(post({ action: "sentiment" }))).status, 503);
  } finally { if (original === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = original; }
});


test("analytics type filters scope comparisons, forecast collections and pending backlog to linked reservation types", async () => {
  const h = analytics({ reservations: [
    reservation("private", "2026-10-01T01:00:00Z"),
    reservation("public", "2026-10-01T01:00:00Z", "confirmed", { commercial_type: "public_swimming" }),
    reservation("room", "2026-10-01T01:00:00Z", "confirmed", { commercial_type: "room_accommodation" }),
    reservation("old-room", "2026-08-01T01:00:00Z", "confirmed", { commercial_type: "room_accommodation" }),
    reservation("prior-room", "2026-09-28T01:00:00Z", "confirmed", { commercial_type: "room_accommodation" }),
  ], payments: [
    payment(100, { payment_id: "p1", reservation_id: "private" }),
    payment(200, { payment_id: "p2", reservation_id: "public" }),
    payment(300, { payment_id: "p3", reservation_id: "old-room" }),
    payment(40, { payment_id: "queue-public", reservation_id: "public", status: "pending", created_at: "2026-08-01T01:00:00Z" }),
    payment(50, { payment_id: "queue-room", reservation_id: "room", status: "pending", created_at: "2026-08-01T01:00:00Z" }),
  ], public_access_sales: [
    { sale_id: "s1", access_type: "mixed", amount: 20, paid_at: "2026-10-02T01:00:00Z" },
    { sale_id: "s2", access_type: "room", amount: 30, paid_at: "2026-10-02T01:00:00Z" },
  ] });
  for (const [type, collected, backlog] of [["private_swimming", 100, 0], ["public_swimming", 220, 40], ["room_accommodation", 330, 50]]) {
    const reports = await h.generateAnalytics("Custom", range, now, type);
    assert.equal(reports.booking.metrics[0].value, 1);
    assert.equal(reports.revenue.metrics[0].value, collected);
    assert.equal(reports.revenue.split.reduce((sum, row) => sum + row.value, 0), collected);
    assert.equal(reports.performance.metrics[2].value, backlog);
    assert.equal(reports.booking.comparison.points.reduce((sum, row) => sum + (row.previous ?? 0), 0), type === "room_accommodation" ? 1 : 0);
  }
});
