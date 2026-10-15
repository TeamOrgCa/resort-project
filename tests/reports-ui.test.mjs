import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

const makeReport = (tab, count = 40) => ({ startDate: "2026-10-01", endDate: "2026-10-03", generatedAt: "2026-10-03T01:00:00Z", note: "Summary covers this date range.", metrics: [{ label: "Reservations created", value: count, help: "All statuses", format: "count" }], trend: [{ label: "Oct 1, 2026", value: count }], split: [{ label: "Online", value: count }], rows: Array.from({ length: count }, (_, i) => tab === "Guest Report"
  ? { id: `r-${i}`, reference: `MV-${i}`, guest: `Guest ${i}`, phone: "09171234567", email: `guest${i}@example.com`, source: i % 2 ? "Staff entry" : "Online", status: "Confirmed", guests: String(i + 1), startAt: "Nov 1, 2026", startSort: "2026-11-01T00:00:00Z", createdAt: `Oct ${i % 3 + 1}, 2026`, createdSort: `2026-10-0${i % 3 + 1}T01:00:00Z`, history: "First-time booker" }
  : tab === "Staff Report" ? { id: `s-${i}`, staff: `Staff ${i}`, actions: String(i + 1), latestAction: "Updated reservation", lastActive: "Oct 1, 2026", lastActiveSort: "2026-10-01T01:00:00Z" }
    : { id: `p-${i}`, label: `Oct ${i + 1}, 2026`, periodStart: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z`, revenue: `₱${i + 1}.00`, payments: "1", bookings: "1" }) });

async function mount({ tabs = ["Guest Report"], fetcher, filename = "components/admin/ReportPanel.tsx", extraMocks = {} } = {}) {
  const requests = [], downloads = [], blobs = new Map(); let printed = null, printedCharts = null;
  const originalFetch = globalThis.fetch, originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const originalClick = dom.window.HTMLAnchorElement.prototype.click;
  const originalPrint = window.print;
  URL.createObjectURL = blob => { const url = `blob:test-${blobs.size}`; blobs.set(url, blob); return url; };
  URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push({ filename: this.download, blob: blobs.get(this.href) }); };
  window.print = () => { const report = document.querySelector("#admin-report-print"); printed = report?.textContent; printedCharts = [...report?.querySelectorAll("svg") ?? []].map(svg => svg.getAttribute("aria-label")); assert.equal(report?.querySelector("select"), null); window.dispatchEvent(new dom.window.Event("afterprint")); };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (fetcher) return fetcher(url, options, requests.length);
    const params = new URL(url, "http://localhost").searchParams;
    return Response.json({ success: true, report: makeReport(params.get("tab")) });
  };
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const { default: Panel } = loadTsModule(filename, { "@/components/content/SiteContent": { useSiteContent: () => ({ "resort.name": "Test Resort" }), contentText: (content, key) => content[key] }, ...extraMocks });
  await act(async () => { root.render(createElement(Panel, { tabs })); });
  return { container, requests, downloads, printed: () => printed, printedCharts: () => printedCharts, async close() {
    await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    dom.window.HTMLAnchorElement.prototype.click = originalClick; window.print = originalPrint;
  } };
}
const button = (container, label) => [...container.querySelectorAll("button")].find(b => b.textContent.trim() === label);
async function click(element) { assert.ok(element, "Button exists"); assert.equal(element.disabled, false, "Button enabled"); await act(async () => element.click()); }
async function value(element, nextValue) {
  assert.ok(element);
  await act(async () => {
    const proto = element.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(element, nextValue);
    element.dispatchEvent(new dom.window.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}

test("guest search, source filters, reset, numeric sorting and all pagination buttons work", async () => {
  const h = await mount();
  try {
    assert.match(h.requests[0].url, /^\/api\/admin\/transactions\/guest-report/);
    assert.equal(h.container.querySelectorAll("tbody tr").length, 25);
    await click(button(h.container, "Next")); assert.match(h.container.textContent, /Page 2 of 2/);
    await click(button(h.container, "Previous")); assert.match(h.container.textContent, /Page 1 of 2/);
    await click(button(h.container, "Last")); assert.match(h.container.textContent, /Page 2 of 2/);
    await click(button(h.container, "First")); assert.match(h.container.textContent, /Page 1 of 2/);
    await value(h.container.querySelector('input[placeholder^="Search guest"]'), "guest17@example.com");
    assert.equal(h.container.querySelectorAll("tbody tr").length, 1); assert.match(h.container.querySelector("tbody").textContent, /Guest 17/);
    await click(button(h.container, "Clear table filters"));
    const source = [...h.container.querySelectorAll("label")].find(l => l.textContent.startsWith("Booked through"))?.querySelector("select");
    await value(source, "Staff entry"); assert.match(h.container.textContent, /20 matching records/);
    await click(button(h.container, "Clear table filters"));
    const sizeHeader = [...h.container.querySelectorAll("th button")].find(b => b.textContent.startsWith("Group size"));
    await click(sizeHeader); assert.match(h.container.querySelector("tbody tr").textContent, /Guest 0/);
    await click([...h.container.querySelectorAll("th button")].find(b => b.textContent.startsWith("Group size"))); assert.match(h.container.querySelector("tbody tr").textContent, /Guest 39/);
  } finally { await h.close(); }
});

test("CSV and printing use every filtered row, including rows on other pages", async () => {
  const h = await mount();
  try {
    await click(button(h.container, "Export CSV"));
    const csv = await h.downloads[0].blob.text();
    assert.equal(csv.split("\r\n").length, 41); assert.match(csv, /guest39@example.com/); assert.match(h.downloads[0].filename, /2026-10-01-to-2026-10-03/);
    await value(h.container.querySelector('input[placeholder^="Search guest"]'), "guest17@example.com");
    await click(button(h.container, "Export CSV")); assert.equal((await h.downloads[1].blob.text()).split("\r\n").length, 2);
    await click(button(h.container, "Print report"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
    assert.match(h.printed(), /Test Resort — Guest Report/); assert.match(h.printed(), /Guest 17/); assert.doesNotMatch(h.printed(), /Guest 39/);
    assert.match(h.printed(), /1 matching records/); assert.equal(document.querySelector("#admin-report-print"), null);
    assert.deepEqual(h.printedCharts(), ["Line graph", "Pie chart"]);
    await value(h.container.querySelector('input[placeholder^="Search guest"]'), "missing@example.com");
    assert.equal(button(h.container, "Export CSV").disabled, true); assert.equal(button(h.container, "Print report").disabled, true);
  } finally { await h.close(); }
});

test("failed reports keep Refresh enabled and a retry can successfully load records", async () => {
  const h = await mount({ fetcher: (_url, _options, count) => Response.json(count === 1 ? { success: false, message: "Temporary failure" } : { success: true, report: makeReport("Guest Report", 1) }, { status: count === 1 ? 503 : 200 }) });
  try {
    assert.match(h.container.textContent, /Temporary failure/); await click(button(h.container, "Refresh report"));
    assert.equal(h.requests.length, 2); assert.equal(h.container.querySelectorAll("tbody tr").length, 1);
  } finally { await h.close(); }
});

test("period selection, custom Apply dates, invalid ranges and Reset period request the intended report", async () => {
  const h = await mount();
  try {
    await value(h.container.querySelector("select"), "Monthly"); assert.match(h.requests.at(-1).url, /period=Monthly/);
    await value(h.container.querySelector("select"), "Custom");
    await value(h.container.querySelectorAll('input[type="date"]')[0], "2026-10-01");
    await value(h.container.querySelectorAll('input[type="date"]')[1], "2026-10-03");
    await click(button(h.container, "Apply dates")); assert.match(h.requests.at(-1).url, /startDate=2026-10-01&endDate=2026-10-03/);
    const count = h.requests.length;
    await value(h.container.querySelectorAll('input[type="date"]')[0], "2026-10-10");
    await act(async () => h.container.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(h.requests.length, count); assert.match(h.container.textContent, /valid date range/);
    await click(button(h.container, "Reset period")); assert.match(h.requests.at(-1).url, /period=Daily/);
  } finally { await h.close(); }
});

test("switching report types aborts the previous request and prevents old records from appearing", async () => {
  let resolveSales;
  const h = await mount({ tabs: ["Sales Report", "Staff Report"], fetcher: url => new URL(url, "http://localhost").searchParams.get("tab") === "Sales Report"
    ? new Promise(resolve => { resolveSales = resolve; }) : Response.json({ success: true, report: makeReport("Staff Report", 1) }) });
  try {
    assert.equal(button(h.container, "Export CSV"), undefined);
    await click(button(h.container, "Staff Report")); assert.equal(h.requests[0].options.signal.aborted, true);
    await act(async () => resolveSales(Response.json({ success: true, report: makeReport("Sales Report", 1) })));
    assert.match(h.container.querySelector("tbody").textContent, /Staff 0/); assert.doesNotMatch(h.container.querySelector("tbody").textContent, /₱/);
    await click(button(h.container, "Export CSV")); assert.match(await h.downloads[0].blob.text(), /Staff 0/);
  } finally { await h.close(); }
});

test("Transactions ledger and document refresh/export controls work, invoice View opens, and Guest Report uses its own endpoint", async () => {
  const fixture = {
    staff_users: [{ id: "staff", role: "admin", is_active: true }],
    transactions: [{ transaction_id: "t1", reservation_id: "r1", total_amount: 5000, paid_amount: 1000, balance: 4000, overpaid_amount: 0, status: "partial", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" }],
    reservations: [{ reservation_id: "r1", reference_number: "MV-TEST", booking_type: "online", status: "confirmed", start_datetime: "2026-11-01T00:00:00Z", end_datetime: "2026-11-01T08:00:00Z" }],
    invoices: [{ invoice_id: "invoice1", reservation_id: "r1", total_amount: 5000, created_at: "2026-10-01T00:00:00Z" }],
    receipts: [{ receipt_id: "receipt1", payment_id: "payment1", receipt_number: "RCPT-TEST", issued_at: "2026-10-01T00:00:00Z", is_active: true, archived_at: null, billed_to_name: "Test Guest" }],
  };
  let ledgerReads = 0;
  const client = { auth: { getUser: async () => ({ data: { user: { id: "staff" } } }) }, from: table => {
    const filters = [];
    const result = () => { if (table === "transactions") ledgerReads++; return { data: (fixture[table] ?? []).filter(row => filters.every(fn => fn(row))), error: null }; };
    const query = { select: () => query, order: () => query, limit: () => query,
      eq: (key, expected) => { filters.push(row => row[key] === expected); return query; },
      in: (key, expected) => { filters.push(row => expected.includes(row[key])); return query; },
      range: async (from, to) => { const response = result(); return { ...response, data: response.data.slice(from, to + 1) }; },
      maybeSingle: async () => { const value = result(); return { ...value, data: value.data[0] ?? null }; },
      then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject) };
    return query;
  } };
  const h = await mount({ filename: "app/admin/(portal)/transactions/page.tsx", extraMocks: { "@/lib/supabase/client": { createClient: () => client } } });
  try {
    await click(button(h.container, "Export Ledger")); assert.match(await h.downloads[0].blob.text(), /MV-TEST/);
    const before = ledgerReads; await click(button(h.container, "Refresh ledger")); assert.ok(ledgerReads > before);
    await click(button(h.container, "Generated Invoices")); assert.equal(button(h.container, "Generate Invoice"), undefined); assert.equal(button(h.container, "Download"), undefined);
    await click(button(h.container, "Export invoices CSV")); assert.match(await h.downloads[1].blob.text(), /INVOICE1/);
    await click(button(h.container, "Refresh invoices"));
    await click(button(h.container, "View")); assert.match(h.container.querySelector('[role="dialog"]').textContent, /Invoice Details/);
    await click(button(h.container, "Close")); assert.equal(h.container.querySelector('[role="dialog"]'), null);
    await click(button(h.container, "Issued Receipts")); assert.equal(button(h.container, "Issue Receipt"), undefined);
    await click(button(h.container, "Export receipts CSV")); assert.match(await h.downloads[2].blob.text(), /RCPT-TEST/);
    await click(button(h.container, "Refresh receipts"));
    await click(button(h.container, "Guest Report")); assert.match(h.requests.at(-1).url, /^\/api\/admin\/transactions\/guest-report/);
    assert.match(h.container.textContent, /Guest reservations/);
  } finally { await h.close(); }
});


test("report and guest charts switch between line, bar, pie and progress without changing totals", async () => {
  for (const tab of ["Guest Report", "Sales Report", "Staff Report"]) {
    const h = await mount({ tabs: [tab] });
    try {
      const selectors = h.container.querySelectorAll('select[aria-label$="chart type"]');
      assert.equal(selectors.length, 2); assert.equal(selectors[0].value, "line"); assert.equal(selectors[1].value, "pie");
      const originalRows = h.container.querySelector("tbody").textContent;
      const originalRequests = h.requests.length;
      for (const type of ["bar", "pie", "progress", "line"]) {
        await value(selectors[0], type);
        const chart = selectors[0].closest("article");
        assert.equal(chart.querySelector("dl dd").textContent.includes("40"), true);
        assert.equal(chart.querySelector("dl dd").textContent.includes("\u20b1"), tab === "Sales Report");
        if (type === "progress") assert.equal(chart.querySelector("svg"), null);
        else assert.ok(chart.querySelector("svg"));
        assert.equal(h.container.querySelector("tbody").textContent, originalRows); assert.equal(h.requests.length, originalRequests);
      }
      await value(selectors[1], "bar"); assert.ok(selectors[1].closest("article").querySelector("svg rect"));
    } finally { await h.close(); }
  }
  const empty = await mount({ fetcher: () => Response.json({ success: true, report: makeReport("Guest Report", 0) }) });
  try { assert.match(empty.container.textContent, /No activity recorded/); assert.doesNotMatch(empty.container.innerHTML, /NaN|Infinity/); } finally { await empty.close(); }
});

function makeAnalytics() {
  const base = makeReport("Guest Report", 1);
  return {
    booking: { ...base, trendTitle: "Reservations created over time", splitTitle: "Booking sources", tableTitle: "Reservations by date", rows: Array.from({ length: 30 }, (_, i) => ({ id: `a-${i}`, periodLabel: `Day ${i}`, periodStart: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z`, bookings: String(i + 1) })) },
    revenue: { ...base, trendTitle: "Actual verified collections over time", splitTitle: "Actual collections by payment type", tableTitle: "Collection estimate", metrics: [{ label: "Actual collections", value: 2000, format: "money", help: "Before refunds" }], note: "Historical average only. No statistical confidence score.", trend: [{ label: "Oct 1", value: 2000 }], split: [{ label: "Downpayments", value: 2000 }], rows: [{ id: "forecast", periodLabel: "Oct 4, 2026", projectedBookings: "2", projectedRevenue: "\u20b12000.00", evidence: "2 verified payments / 3 calendar days", method: "Historical daily average" }] },
    performance: { ...base, trendTitle: "Logged activity over time", splitTitle: "Status of payments submitted in this period", tableTitle: "Tasks to check", metrics: [{ label: "Payments awaiting review", value: 1, format: "count", help: "Submitted within these dates" }], rows: [{ id: "pending", signal: "Review pending payments", value: "1", meaning: "Open Transactions" }] },
  };
}
const feedbackFixture = { sampleSize: 10, startDate: "2026-10-01", endDate: "2026-10-03", generatedAt: "2026-10-03T01:00:00Z", overallSentiment: "Positive", positivePercent: 80, neutralPercent: 15, negativePercent: 5, themes: ["Friendly staff"], summary: "Mostly positive." };

test("analytics chart units, all tabs, filtered exports, print, refresh and feedback analysis work", async () => {
  const h = await mount({ filename: "app/admin/(portal)/analytics/page.tsx", fetcher: (_url, options) => Response.json(options?.method === "POST" ? { success: true, sentiment: feedbackFixture } : { success: true, reports: makeAnalytics() }) });
  try {
    assert.doesNotMatch(h.container.textContent, /\u20b1/); assert.equal(h.container.querySelectorAll('select[aria-label$="chart type"]').length, 2);
    await value(h.container.querySelector('select[aria-label$="chart type"]'), "bar"); assert.ok(h.container.querySelector("svg rect"));
    await click(button(h.container, "Export CSV")); assert.equal((await h.downloads[0].blob.text()).split("\r\n").length, 31);
    await value(h.container.querySelector('input[aria-label="Search records..."]'), "Day 29");
    await click(button(h.container, "Export CSV")); assert.equal((await h.downloads[1].blob.text()).split("\r\n").length, 2);
    await click(button(h.container, "Print report")); await act(async () => new Promise(resolve => setTimeout(resolve, 180)));
    assert.match(h.printed(), /Analytics: Bookings/); assert.match(h.printed(), /Day 29/); assert.doesNotMatch(h.printed(), /Day 28/);
    assert.deepEqual(h.printedCharts(), ["Bar chart", "Pie chart"]);
    await click(button(h.container, "Collection forecast")); assert.match(h.container.textContent, /\u20b1/); assert.match(h.container.textContent, /Historical average only/); assert.equal(button(h.container, "Run Forecast"), undefined);
    await click(button(h.container, "Operations")); assert.doesNotMatch(h.container.textContent, /\u20b1/); assert.match(h.container.textContent, /Tasks to check/);
    await click(button(h.container, "Guest feedback")); assert.equal(button(h.container, "Export CSV"), undefined);
    await click(button(h.container, "Analyze feedback")); assert.match(h.container.textContent, /80%/); assert.match(h.container.textContent, /Friendly staff/);
    await value(h.container.querySelector('select[aria-label$="chart type"]'), "bar"); assert.ok(h.container.querySelector("svg rect"));
    await click(button(h.container, "Export CSV")); assert.match(await h.downloads.at(-1).blob.text(), /80%/);
    await click(button(h.container, "Analyze again")); assert.equal(h.requests.filter(r => r.options?.method === "POST").length, 2);
    await click(button(h.container, "Refresh analytics")); assert.equal(button(h.container, "Export CSV"), undefined); assert.match(h.container.textContent, /has not been analyzed/);
    await value(h.container.querySelector("select"), "Custom");
    await value(h.container.querySelectorAll('input[type="date"]')[0], "2026-10-01"); await value(h.container.querySelectorAll('input[type="date"]')[1], "2026-10-03");
    await click(button(h.container, "Apply dates")); assert.match(h.requests.at(-1).url, /startDate=2026-10-01&endDate=2026-10-03/);
    await click(button(h.container, "Reset period")); assert.match(h.requests.at(-1).url, /period=Daily/);
  } finally { await h.close(); }
});

test("analytics retries failures and aborts stale data and feedback after date changes", async () => {
  let resolveMonthly, resolveFeedback;
  const h = await mount({ filename: "app/admin/(portal)/analytics/page.tsx", fetcher: (url, options, count) => {
    if (count === 1) return Response.json({ success: false, message: "Try again" }, { status: 503 });
    if (options?.method === "POST") return new Promise(resolve => { resolveFeedback = resolve; });
    if (url.includes("Monthly")) return new Promise(resolve => { resolveMonthly = resolve; });
    return Response.json({ success: true, reports: makeAnalytics() });
  } });
  try {
    assert.match(h.container.textContent, /Try again/); await click(button(h.container, "Refresh analytics"));
    await value(h.container.querySelector("select"), "Monthly"); assert.equal(button(h.container, "Export CSV"), undefined);
    const monthlyRequest = h.requests.at(-1);
    await value(h.container.querySelector("select"), "Weekly"); assert.equal(monthlyRequest.options.signal.aborted, true);
    await act(async () => resolveMonthly(Response.json({ success: true, reports: { ...makeAnalytics(), booking: { ...makeAnalytics().booking, note: "STALE MONTHLY" } } })));
    assert.doesNotMatch(h.container.textContent, /STALE MONTHLY/);
    await click(button(h.container, "Guest feedback"));
    // Starting an async POST keeps the action pending while dates change.
    await act(async () => button(h.container, "Analyze feedback").click());
    const feedbackRequest = h.requests.at(-1); assert.equal(button(h.container, "Analyzing...").disabled, true);
    await value(h.container.querySelector("select"), "Daily"); assert.equal(feedbackRequest.options.signal.aborted, true);
    await act(async () => resolveFeedback(Response.json({ success: true, sentiment: feedbackFixture })));
    assert.doesNotMatch(h.container.textContent, /Friendly staff/); assert.equal(button(h.container, "Analyze feedback").disabled, false);
  } finally { await h.close(); }
});


test("staff can settle a reservation balance in cash, acknowledge receipt and see the issued receipt",async()=>{
 let saved=false,fail=true;const posted=[];
 const client={auth:{getUser:async()=>({data:{user:{id:"admin"}}})},from:table=>{
   const result=()=>({error:null,data:table==="staff_users"?{role:"admin",is_active:true}:table==="transactions"?[{transaction_id:"txn",reservation_id:"booking",total_amount:3000,paid_amount:saved?3000:600,balance:saved?0:2400,overpaid_amount:0,status:saved?"paid":"partial",updated_at:"2026-10-15T01:00:00Z"}]:table==="reservations"?[{reservation_id:"booking",reference_number:"MV-CASH",booking_type:"online",status:"confirmed"}]:table==="receipts"&&saved?[{receipt_id:"receipt",payment_id:"cash",receipt_number:"RCPT-CASH",issued_at:"2026-10-15T01:00:00Z",is_active:true}]:[]});
   const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:()=>q,range:async(from,to)=>{const response=result();return{...response,data:response.data.slice(from,to+1)};},maybeSingle:async()=>result(),then:(resolve,reject)=>Promise.resolve(result()).then(resolve,reject)};return q;
 }};
 const h=await mount({filename:"app/admin/(portal)/transactions/page.tsx",extraMocks:{"@/lib/supabase/client":{createClient:()=>client}},fetcher:(url,options)=>{
   assert.equal(url,"/api/admin/payments/manual-entry");posted.push(JSON.parse(options.body));
   if(fail)return Response.json({success:false,message:"Please retry with the same cash reference"},{status:503});saved=true;
   return Response.json({success:true,message:"Cash payment recorded",receipt:{receipt_number:"RCPT-CASH"},remainingBalance:0});
 }});
 try{
   await click(button(h.container,"Settle in cash"));const modal=h.container.querySelector('[role="dialog"]');
   assert.match(modal.textContent,/Cash \(staff only\)/);assert.equal(modal.querySelector('input[type="number"]').value,"2400.00");
   assert.equal(button(modal,"Record payment and issue receipt").disabled,true);
   await click(modal.querySelector('input[type="checkbox"]'));await click(button(modal,"Record payment and issue receipt"));assert.match(modal.textContent,/same cash reference/);
   fail=false;await click(button(modal,"Record payment and issue receipt"));assert.equal(posted[0].paymentReference,posted[1].paymentReference);
   assert.equal(posted[1].paymentMethod,"cash");assert.equal(posted[1].cashReceived,true);assert.equal(posted[1].expectedBalance,2400);
   assert.equal(h.container.querySelector('[role="dialog"]'),null);assert.match(h.container.querySelector('[role="status"]').textContent,/RCPT-CASH/);
   assert.equal(button(h.container,"Settle in cash").disabled,true);await click(button(h.container,"Issued Receipts"));assert.match(h.container.textContent,/RCPT-CASH/);
 }finally{await h.close();}
});
