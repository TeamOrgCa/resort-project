import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { dashboardDatabase } from "./helpers/dashboard-database.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin", pretendToBeVisual: true });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const button = (container, text) => [...container.querySelectorAll("button")].find(b => b.textContent.trim() === text);
async function click(element) { assert.ok(element, "Button exists"); assert.equal(element.disabled, false, "Button is enabled"); await act(async () => element.click()); }
async function value(element, nextValue) {
  assert.ok(element);
  await act(async () => {
    const proto = element.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(element, nextValue);
    element.dispatchEvent(new dom.window.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}

function snapshot(count = 25) {
  const row = (i, extras = {}) => ({ id: `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`, reference: `MV-${i}`, guest: `Guest ${i}`, checkIn: "Oct 13, 2026, 11:00 AM", checkOut: "Oct 13, 2026, 5:00 PM", startSort: "2026-10-13T03:00:00Z", endSort: "2026-10-13T09:00:00Z", arrivalDate: "2026-10-13", status: "Confirmed", statusCode: "confirmed", source: i % 2 ? "Staff entry" : "Online", guests: String(i + 1), package: "Day", ...extras });
  return { generatedAt: "2026-10-13T01:00:00Z", today: "2026-10-13", startDate: "2026-10-07", endDate: "2026-10-13", arrivalEndDate: "2026-11-11", permissions: ["dashboard", "reservations", "create_reservation", "transactions", "records", "reports", "analytics"], arrivalsToday: count, scheduledNow: 1, collectionsToday: 1500, verifiedToday: 2, bookingsCreated: 30,
    collections: [{ label: "Oct 12", value: 300 }, { label: "Oct 13", value: 1500 }], bookingStatuses: [{ label: "Confirmed", value: 24 }, { label: "Cancelled", value: 6 }], bookingSources: [{ label: "Online", value: 20 }, { label: "Staff entry", value: 10 }], queues: { payments: 2, reschedules: 1, ocular: 0, refundReview: 3, refundPayout: 1 },
    reservations: count ? [...Array.from({ length: count }, (_, i) => row(i)), row(80, { guest: "Current stay", startSort: "2026-10-12T12:00:00Z", endSort: "2026-10-13T10:00:00Z", arrivalDate: "2026-10-12" }), row(90, { guest: "Later arrival", startSort: "2026-10-22T00:00:00Z", endSort: "2026-10-22T10:00:00Z", arrivalDate: "2026-10-22" })] : [],
  };
}

async function mount({ filename = "components/admin/AdminDashboard.tsx", fetcher, params = "", extraMocks = {} } = {}) {
  window.history.replaceState({}, "", `/admin${params}`);
  const requests = [], downloads = [], pushes = [], timers = [], blobs = new Map();
  const saved = { fetch: globalThis.fetch, create: URL.createObjectURL, revoke: URL.revokeObjectURL, click: dom.window.HTMLAnchorElement.prototype.click, interval: window.setInterval, clear: window.clearInterval };
  URL.createObjectURL = blob => { const id = `blob:test-${blobs.size}`; blobs.set(id, blob); return id; }; URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push({ filename: this.download, blob: blobs.get(this.href) }); };
  window.setInterval = (fn, ms) => { timers.push({ fn, ms }); return timers.length; }; window.clearInterval = () => {};
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return fetcher ? fetcher(url, options, requests.length) : Response.json({ success: true, dashboard: snapshot() }); };
  const { default: Component } = loadTsModule(filename, {
    "next/navigation": { useRouter: () => ({ push: href => pushes.push(href) }), useSearchParams: () => new URLSearchParams(window.location.search) },
    "next/link": { __esModule: true, default: ({ children, ...props }) => createElement("a", props, children) },
    "@/components/content/SiteContent": { useSiteContent: () => ({ "resort.name": "Test Resort" }), contentText: (content, key) => content[key] }, ...extraMocks,
  });
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component)));
  return { container, requests, downloads, pushes, timers, async navigate(query) { window.history.replaceState({}, "", `/admin${query}`); await act(async () => root.render(createElement(Component))); }, async close() {
    await act(async () => root.unmount()); container.remove(); globalThis.fetch = saved.fetch; URL.createObjectURL = saved.create; URL.revokeObjectURL = saved.revoke; dom.window.HTMLAnchorElement.prototype.click = saved.click; window.setInterval = saved.interval; window.clearInterval = saved.clear;
  } };
}

test("dashboard search, filters, numeric sorting, paging, CSV and reservation View work", async () => {
  const h = await mount();
  try {
    assert.equal(h.requests[0].url, "/api/admin/dashboard"); assert.equal(h.requests[0].options.cache, "no-store"); assert.match(h.container.textContent, /1,500/); assert.match(h.container.textContent, /Philippine time/);
    assert.equal(h.container.querySelectorAll("tbody tr").length, 10); await click(button(h.container, "Next")); assert.match(h.container.textContent, /Page 2 of 3/);
    await click(button(h.container, "Last")); assert.match(h.container.textContent, /Page 3 of 3/); await click(button(h.container, "Previous")); await click(button(h.container, "First"));
    await click(button(h.container, "Export CSV")); assert.equal((await h.downloads[0].blob.text()).split("\r\n").length, 26); assert.match(await h.downloads[0].blob.text(), /Guest 24/);
    await value(h.container.querySelector('input[aria-label^="Search guest"]'), "Guest 17"); assert.equal(h.container.querySelectorAll("tbody tr").length, 1);
    await click(button(h.container, "Export CSV")); assert.equal((await h.downloads[1].blob.text()).split("\r\n").length, 2);
    await click(button(h.container, "View")); assert.match(h.pushes[0], /reservation=22222222-2222-4222-8222-000000000017&date=2026-10-13/);
    await click(button(h.container, "Clear table filters"));
    const source = [...h.container.querySelectorAll("label")].find(l => l.textContent.startsWith("Booked through"))?.querySelector("select");
    await value(source, "Staff entry"); assert.match(h.container.textContent, /12 matching records/);
    await click(button(h.container, "Clear table filters"));
    const sort = () => [...h.container.querySelectorAll("th button")].find(b => b.textContent.startsWith("Group size"));
    await click(sort()); assert.match(h.container.querySelector("tbody tr").textContent, /Guest 0/); await click(sort()); assert.match(h.container.querySelector("tbody tr").textContent, /Guest 24/);
    await value(h.container.querySelector('input[aria-label^="Search guest"]'), "missing"); assert.equal(button(h.container, "Export CSV").disabled, true);
  } finally { await h.close(); }
});

test("arrival scopes, all chart choices, queue shortcuts and manual booking links are connected", async () => {
  const h = await mount();
  try {
    await click(button(h.container, "Next 30 days")); assert.match(h.container.textContent, /26 matching records/);
    await click(button(h.container, "Scheduled now")); assert.match(h.container.querySelector("tbody").textContent, /Current stay/); assert.doesNotMatch(h.container.querySelector("tbody").textContent, /Later arrival/);
    await click(button(h.container, "Today")); assert.match(h.container.textContent, /25 matching records/);
    for (const type of ["bar", "pie", "progress", "line"]) {
      const select = h.container.querySelector('select[aria-label="Verified collections chart type"]'); await value(select, type);
      assert.equal(select.closest("article").querySelector("svg") !== null, type !== "progress"); assert.equal(h.requests.length, 1);
    }
    await click(button(h.container, "Booking source")); assert.ok(h.container.querySelector('select[aria-label="Where bookings came from chart type"]'));
    await click(button(h.container, "Booking status")); assert.ok(h.container.querySelector('select[aria-label="Status of new bookings chart type"]'));
    const hrefs = [...h.container.querySelectorAll("a")].map(a => a.getAttribute("href"));
    for (const href of ["/admin/reservations?new=1", "/admin/reservations", "/admin/transactions?tab=payments", "/admin/transactions?tab=refunds", "/admin/records?tab=reschedules", "/admin/records?tab=ocular", "/admin/reports", "/admin/analytics"]) assert.ok(hrefs.includes(href), href);
    await click(button(h.container, "Refresh")); assert.equal(h.requests.length, 2); await click(button(h.container, "Refresh dashboard")); assert.equal(h.requests.length, 3);
    assert.ok(h.timers.every(t => t.ms === 60_000)); await act(async () => h.timers.at(-1).fn()); assert.equal(h.requests.length, 4);
    await act(async () => window.dispatchEvent(new dom.window.Event("focus"))); assert.equal(h.requests.length, 5);
  } finally { await h.close(); }
});

test("dashboard failures show no invented zeros, retries work and stale responses cannot overwrite fresh data", async () => {
  let finishOld;
  const h = await mount({ fetcher: (_url, _options, count) => count === 1 ? Response.json({ success: false, message: "Temporary failure" }, { status: 503 }) : count === 3 ? new Promise(resolve => { finishOld = resolve; }) : Response.json({ success: true, dashboard: snapshot(1) }) });
  try {
    assert.match(h.container.querySelector('[role="alert"]').textContent, /Temporary failure/); assert.equal(h.container.querySelector("tbody"), null);
    await click(button(h.container, "Refresh dashboard")); assert.match(h.container.querySelector("tbody").textContent, /Guest 0/);
    await act(async () => window.dispatchEvent(new dom.window.Event("focus"))); assert.equal(button(h.container, "Export CSV").disabled, true); const request = h.requests.at(-1);
    await act(async () => window.dispatchEvent(new dom.window.Event("focus"))); assert.equal(request.options.signal.aborted, true);
    await act(async () => finishOld(Response.json({ success: true, dashboard: { ...snapshot(), collectionsToday: 999999 } })));
    assert.doesNotMatch(h.container.textContent, /999,999/); assert.equal(button(h.container, "Export CSV").disabled, false);
  } finally { await h.close(); }
  const failed = await mount({ fetcher: (_u, _o, count) => count === 1 ? Response.json({ success: true, dashboard: snapshot(1) }) : Response.json({ success: false, message: "Refresh failed" }, { status: 500 }) });
  try { await click(button(failed.container, "Refresh dashboard")); assert.match(failed.container.textContent, /Showing the last successful update/); assert.equal(button(failed.container, "Export CSV").disabled, true); } finally { await failed.close(); }
});

test("empty data and restricted permissions hide unavailable module actions", async () => {
  const h = await mount({ fetcher: () => Response.json({ success: true, dashboard: { ...snapshot(0), permissions: ["dashboard"], collections: [], bookingStatuses: [] } }) });
  try { assert.equal(h.container.querySelector("a"), null); assert.equal(button(h.container, "View"), undefined); assert.equal(button(h.container, "Export CSV").disabled, true); assert.match(h.container.textContent, /No activity recorded/); assert.doesNotMatch(h.container.innerHTML, /NaN|Infinity/); } finally { await h.close(); }
});

test("transaction links open payment/refund tabs and pending payments outside the recent ledger remain visible", async () => {
  const db = dashboardDatabase({ staff_users: [{ id: "staff", role: "admin", is_active: true }],
    transactions: [{ transaction_id: "t1", reservation_id: "recent", total_amount: 1000, paid_amount: 1000, balance: 0, overpaid_amount: 0, status: "paid", updated_at: "2026-10-13T01:00:00Z" }],
    reservations: [{ reservation_id: "recent", reference_number: "MV-RECENT", booking_type: "online" }, { reservation_id: "old", reference_number: "MV-OLD", booking_type: "online" }],
    payments: [{ payment_id: "old-proof", reservation_id: "old", reference_number: "1234567890123", amount: 500, payment_type: "downpayment", status: "pending", created_at: "2026-01-01T01:00:00Z", ocr_status: "needs_review", ocr_notes: "Needs a review", paid_at: "2026-01-01T01:00:00Z", proof_path: null }] });
  const h = await mount({ filename: "app/admin/(portal)/transactions/page.tsx", params: "?tab=payments", fetcher: () => Response.json({ refunds: [], reservations: [] }), extraMocks: { "@/lib/supabase/client": { createClient: () => db.client } } });
  try {
    assert.match(h.container.textContent, /MV-OLD/); assert.match(h.container.textContent, /1234567890123/);
    await click(button(h.container, "Transaction Ledger")); assert.match(h.container.querySelector("tbody").textContent, /MV-RECENT/);
    await h.navigate("?tab=refunds"); assert.match(h.container.textContent, /No refund requests/); assert.ok(h.requests.some(r => r.url === "/api/admin/refunds"));
    await click(button(h.container, "Payment Verification Queue")); assert.match(h.container.querySelector("tbody").textContent, /MV-OLD/);
  } finally { await h.close(); }
});

test("record links select the intended tab and older pending requests are not lost after 300 records", async () => {
  const db = dashboardDatabase({ reservation_reschedules: Array.from({ length: 1001 }, (_, i) => ({ reschedule_id: `req-${i}`, reservation_id: "r1", requested_by: "g1", old_start: "2026-10-13T00:00:00Z", old_end: "2026-10-13T08:00:00Z", new_start: "2026-10-14T00:00:00Z", new_end: "2026-10-14T08:00:00Z", status: i === 0 ? "pending" : "approved", created_at: `2026-${i === 0 ? "01" : "10"}-01T00:00:00Z` })),
    reservations: [{ reservation_id: "r1", reference_number: "MV-REQUEST", guest_id: "g1", start_datetime: "2026-10-13T00:00:00Z", end_datetime: "2026-10-13T08:00:00Z", adult_count: 10, status: "confirmed" }], guests: [{ id: "g1", first_name: "Test", last_name: "Guest" }], staff_users: [{ id: "staff", role: "admin" }], ocular_visits: [{ visit_id: "v1", reference_number: "MV-VISIT", guest_id: "g1", scheduled_date: "2026-10-13", status: "pending", created_at: "2026-10-13T00:00:00Z" }] });
  const h = await mount({ filename: "app/admin/(portal)/records/page.tsx", params: "?tab=reschedules", extraMocks: { "@/lib/supabase/client": { createClient: () => db.client } } });
  try {
    assert.match(h.container.textContent, /MV-REQUEST/); assert.ok(db.calls.some(c => c.table === "reservation_reschedules" && c.from === 1000));
    const status = [...h.container.querySelectorAll("label")].find(l => l.textContent.startsWith("Status"))?.querySelector("select"); await value(status, "Pending"); assert.equal(h.container.querySelectorAll("tbody tr").length, 1);
    await h.navigate("?tab=ocular"); assert.match(h.container.querySelector("tbody").textContent, /MV-VISIT/);
  } finally { await h.close(); }
});
