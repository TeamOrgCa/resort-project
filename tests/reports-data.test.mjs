import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const { reportWindow, reportBucket, parseReportPeriod } = loadTsModule("lib/reports/periods.ts");
const { reportCsv } = loadTsModule("lib/reports/export.ts");
test("preset windows use Manila days and real calendar months, including leap years", () => {
  const now = new Date("2026-10-12T16:30:00Z");
  const daily = reportWindow("Daily", undefined, now);
  assert.equal(daily.startDate, "2026-10-07"); assert.equal(daily.endDate, "2026-10-13");
  assert.equal(daily.start.toISOString(), "2026-10-06T16:00:00.000Z");
  assert.equal(reportBucket("2026-10-13T15:59:59Z", daily), 6);
  assert.equal(reportBucket("2026-10-13T16:00:00Z", daily), -1);
  const weekly = reportWindow("Weekly", undefined, now); assert.equal(weekly.startDate, "2026-09-16"); assert.equal(weekly.labels.length, 4);
  const monthly = reportWindow("Monthly", undefined, new Date("2024-03-31T01:00:00Z"));
  assert.equal(monthly.startDate, "2023-10-01"); assert.equal(monthly.endDate, "2024-03-31");
  assert.equal(new Set(monthly.labels).size, 6); assert.equal(reportBucket("2024-02-29T15:59:59Z", monthly), 4);
  assert.equal(reportBucket("2024-02-29T16:00:00Z", monthly), 5);
  assert.throws(() => parseReportPeriod("invalid"));
});

test("CSV preserves commas, quotes, newlines and leading-zero phones while neutralizing formulas", () => {
  const csv = reportCsv([{ key: "name", label: "Guest" }, { key: "phone", label: "Phone" }], [{ name: 'Guest, "One"\nNext line', phone: "09171234567" }, { name: " \t=HYPERLINK(\"bad\")", phone: "+639171234567" }]);
  assert.ok(csv.startsWith("\uFEFF")); assert.match(csv, /"Guest, ""One""\nNext line"/); assert.match(csv, /"09171234567"/);
  assert.match(csv, /"' \t=HYPERLINK/); assert.match(csv, /"'\+639171234567"/);
});

function harness(tables = {}, failTable = null) {
  const calls = [];
  const client = { from(table) {
    const filters = [], orders = [];
    let orFilter = null;
    const query = { select: () => query, eq: (key, value) => { filters.push(r => r[key] === value); return query; }, gte: (key, value) => { filters.push(r => r[key] >= value); return query; }, lt: (key, value) => { filters.push(r => r[key] < value); return query; }, in: (key, values) => { filters.push(r => values.includes(r[key])); return query; }, order: key => { orders.push(key); return query; }, or: value => { orFilter = value; return query; }, range: async (from, to) => {
      calls.push({ table, orFilter, from, to });
      if (table === failTable) return { data: null, error: { message: "Database unavailable" } };
      let rows = (tables[table] ?? []).filter(r => filters.every(f => f(r)));
      if (orFilter) {
        const start = orFilter.match(/verified_at.gte.([^,]+)/)[1], end = orFilter.match(/verified_at.lt.([^,)]+)/)[1];
        rows = rows.filter(r => (r.verified_at ?? r.created_at) >= start && (r.verified_at ?? r.created_at) < end);
      }
      rows.sort((a, b) => { for (const key of orders) { const n = String(a[key] ?? "").localeCompare(String(b[key] ?? "")); if (n) return n; } return 0; });
      return { data: rows.slice(from, to + 1), error: null };
    } };
    return query;
  } };
  const { generateReport } = loadTsModule("lib/server/reports.ts", { "@/lib/supabase/admin": { createAdminClient: () => client } });
  return { calls, get: (tab, query = "period=Custom&startDate=2026-10-01&endDate=2026-10-03") => generateReport(new Request(`http://localhost/api/admin/reports?${query}`), tab) };
}
const booking = (id, extras = {}) => ({ reservation_id: id, guest_id: "guest", walk_in_guest_id: null, reference_number: `MV-${id}`, booking_type: "online", adult_count: 2, child_count: 1, status: "confirmed", start_datetime: "2026-11-01T00:00:00Z", created_at: "2026-10-01T01:00:00Z", ...extras });

test("sales include payments approved in the period, exclude pending/rejected payments and retain legacy dates", async () => {
  const payment = (id, extras) => ({ payment_id: id, amount: 100, payment_type: "downpayment", status: "verified", created_at: "2026-09-01T01:00:00Z", verified_at: "2026-10-02T01:00:00Z", ...extras });
  const h = harness({ payments: [payment("approved-later", { amount: 1500 }), payment("pending", { status: "pending" }), payment("rejected", { status: "rejected" }), payment("outside", { verified_at: "2026-10-04T01:00:00Z" }), payment("legacy", { amount: 3500, payment_type: "full", verified_at: null, created_at: "2026-10-03T01:00:00Z" })], reservations: [booking("new"), booking("cancelled", { status: "cancelled" })] });
  const response = await h.get("Sales Report"); const { report } = await response.json();
  assert.equal(response.status, 200); assert.equal(report.metrics[0].value, 5000); assert.equal(report.metrics[1].value, 2); assert.equal(report.metrics[2].value, 2);
  assert.equal(report.trend.reduce((sum, p) => sum + p.value, 0), 5000); assert.equal(report.split.length, 2);
  assert.equal(response.headers.get("cache-control"), "no-store"); assert.match(report.note, /before|gross/);
});

test("guest report includes online and walk-in contact details and uses reservation history rather than signup date", async () => {
  const h = harness({ reservations: [booking("old", { created_at: "2026-09-01T01:00:00Z" }), booking("repeat"), booking("second"), booking("manual", { guest_id: null, walk_in_guest_id: "walk", booking_type: "walk_in", adult_count: 4, child_count: 2 }), booking("missing", { guest_id: "deleted", status: "cancelled" })], guests: [{ id: "guest", first_name: "Registered", last_name: "Guest", phone_number: "09170000000", email: "guest@example.com" }], walk_in_guests: [{ walk_in_guest_id: "walk", first_name: "Walk-in", last_name: "Guest", phone_number: "09171111111", email: "walk@example.com" }] });
  const { report } = await (await h.get("Guest Report")).json();
  assert.equal(report.rows.length, 4); assert.equal(report.metrics[0].value, 4); assert.equal(report.metrics[1].value, 15); assert.equal(report.metrics[3].value, 1);
  const manual = report.rows.find(r => r.id === "manual"); assert.equal(manual.guest, "Walk-in Guest"); assert.equal(manual.phone, "09171111111"); assert.equal(manual.source, "Staff entry"); assert.equal(manual.history, "First-time booker");
  assert.equal(report.rows.find(r => r.id === "repeat").history, "Returning booker"); assert.equal(report.rows.find(r => r.id === "missing").guest, "Profile unavailable");
  assert.equal(report.split.reduce((sum, item) => sum + item.value, 0), 4);
  const unknown = harness({ reservations: [booking("legacy", { booking_type: null })] });
  const legacyReport = (await (await unknown.get("Guest Report")).json()).report;
  assert.equal(legacyReport.rows[0].source, "Unspecified");
  assert.equal(legacyReport.split.find(item => item.label === "Unspecified").value, 1);
});

test("reports collect more than 1000 records and chunk referenced profile lookups", async () => {
  const bookings = Array.from({ length: 1001 }, (_, i) => booking(`r${i}`, { guest_id: `g${i}` }));
  const guests = bookings.map(r => ({ id: r.guest_id, first_name: "Guest", last_name: r.guest_id, email: "guest@example.com", phone_number: "0917" }));
  const h = harness({ reservations: bookings, guests }); const { report } = await (await h.get("Guest Report")).json();
  assert.equal(report.rows.length, 1001); assert.equal(report.metrics[2].value, 1001); assert.ok(h.calls.filter(c => c.table === "guests").length > 5);
  assert.ok(report.rows.every(r => r.guest !== "Profile unavailable"));
});

test("staff with the same name remain separate and identified staff auth events are attributed correctly", async () => {
  const audit = (id, extras) => ({ log_id: id, user_id: null, auth_user_id: null, action: "Updated reservation", entity_type: "reservation", created_at: "2026-10-02T01:00:00Z", ...extras });
  const h = harness({ audit_logs: [audit("one", { user_id: "s1" }), audit("two", { user_id: "s2" }), audit("login", { auth_user_id: "s1", action: "Signed in" }), audit("guest", { auth_user_id: "guest" })], staff_users: [{ id: "s1", full_name: "Alex" }, { id: "s2", full_name: "Alex" }] });
  const { report } = await (await h.get("Staff Report")).json();
  assert.equal(report.rows.filter(r => r.staff === "Alex").length, 2); assert.equal(report.rows.find(r => r.id === "s1").actions, "2");
  assert.equal(report.metrics[1].value, 2); assert.equal(report.metrics[2].value, 1); assert.equal(report.trend.reduce((sum, p) => sum + p.value, 0), 4);
});

test("empty reports are usable, invalid ranges fail before fetching and database failures return a retryable response", async () => {
  const h = harness(); const { report } = await (await h.get("Guest Report")).json(); assert.deepEqual(report.rows, []); assert.equal(report.metrics[0].value, 0);
  const invalid = harness(); assert.equal((await invalid.get("Sales Report", "period=Custom&startDate=2026-02-30&endDate=2026-03-01")).status, 400); assert.equal(invalid.calls.length, 0);
  assert.equal((await invalid.get("Sales Report", "period=Unknown")).status, 400);
  assert.equal((await harness({}, "payments").get("Sales Report")).status, 500);
});
