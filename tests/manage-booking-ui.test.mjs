
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/manage", pretendToBeVisual: true });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const button = (container, label) => [...container.querySelectorAll("button")].find(el => el.textContent.trim() === label);
const menuItem = label => [...document.querySelectorAll('[role="menuitem"]')].find(el => el.querySelector("span > span")?.textContent === label);
const dialog = () => document.querySelector('[role="dialog"]');
async function click(el) { assert.ok(el, "Expected control to exist"); assert.equal(el.disabled, false); await act(async () => el.click()); }
async function value(el, next) {
  assert.ok(el);
  await act(async () => {
    const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, next);
    el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}
async function key(el, name, extra = {}) { await act(async () => el.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true, ...extra }))); }
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const rows = [
  { reservation_id: "booking", reference_number: "MV-CONFIRMED", status: "confirmed" },
  { reservation_id: "reviewing", reference_number: "MV-REVIEW", status: "payment_submitted" },
  { reservation_id: "closed", reference_number: "MV-CLOSED", status: "cancelled", cancellation_snapshot: { outcome: "no_refund" } },
].map(row => ({ ...row, start_datetime: day(20) + "T08:00:00+08:00", end_datetime: day(20) + "T18:00:00+08:00", booking_mode: "day", adult_count: 3, child_count: 1, payment_deadline_at: null }));
function client() {
  const data = {
    guests: { email: "guest@example.com", phone_number: "09123456789" },
    reservations: rows,
    transactions: rows.map(row => ({ reservation_id: row.reservation_id, total_amount: 3000, paid_amount: 600, balance: 2400 })),
    reservation_services: [{ reservation_id: "booking", service_id: "service", quantity: 1, price_at_time: 100, services: { name: "Extra table" } }],
    services: [{ service_id: "service", name: "Extra table", price: 100 }, { service_id: "karaoke", name: "Karaoke", price: 500 }],
    ocular_visits: [{ visit_id: "visit", reference_number: "OC-VISIT", scheduled_date: day(12), time_slot_id: "slot", status: "confirmed", created_at: new Date().toISOString() }],
    ocular_time_slots: [{ slot_id: "slot", start_time: "10:00:00", end_time: "11:00:00" }],
  };
  return { auth: { getUser: async () => ({ data: { user: { id: "guest", email: "guest@example.com" } }, error: null }) },
    from(table) {
      const query = { select: () => query, eq: () => query, in: () => query, order: () => query,
        maybeSingle: async () => ({ data: data[table], error: null }),
        then: (resolve, reject) => Promise.resolve({ data: data[table], error: null }).then(resolve, reject) };
      return query;
    },
  };
}
async function mount(fetcher = async () => Response.json({ refunds: [], eligible: [] })) {
  const original = globalThis.fetch; globalThis.fetch = fetcher;
  const pushes = [], drafts = [];
  const Component = loadTsModule("app/manage/page.tsx", {
    "next/image": () => null,
    "next/navigation": { useRouter: () => ({ push: path => pushes.push(path) }) },
    "@/components/Navigation": () => null, "@/components/Footer": () => null,
    "@/lib/supabase/client": { createClient: client },
    "@/lib/stores/booking-store": { useBookingStore: selector => selector({ setBookingDraft: draft => drafts.push(draft) }) },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component)));
  return { container, pushes, drafts, close: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = original; } };
}
const options = reference => document.querySelector(`button[aria-label="Options for ${reference}"]`);
async function action(reference, label) { await click(options(reference)); await click(menuItem(label)); }
async function chooseDate(date) {
  for (let attempt = 0; attempt < 24 && !dialog().querySelector(`button[data-date="${date}"]`); attempt++) {
    await click(dialog().querySelector('[aria-label="Next month"]'));
  }
  await click(dialog().querySelector(`button[data-date="${date}"]`));
}

test("booking actions open a focused dialog without inline details and restore the page on close", async () => {
  const h = await mount();
  try {
    assert.equal(dialog(), null); assert.equal(h.container.textContent.includes("Booked services"), false);
    const trigger = options("MV-CONFIRMED"); await click(trigger);
    assert.equal(document.activeElement, menuItem("View")); await key(document.activeElement, "ArrowDown"); assert.equal(document.activeElement, menuItem("Edit services"));
    await key(document.activeElement, "Escape"); assert.equal(document.querySelector('[role="menu"]'), null); assert.equal(document.activeElement, trigger);
    await action("MV-CONFIRMED", "View");
    assert.ok(dialog()); assert.equal(h.container.contains(dialog()), false); assert.equal(document.body.style.overflow, "hidden");
    assert.match(dialog().textContent, /Booking details/); assert.match(dialog().textContent, /Extra table/);
    assert.equal(document.activeElement.getAttribute("aria-label"), "Close booking dialog");
    const last = button(dialog(), "Close"); last.focus(); await key(last, "Tab"); assert.equal(document.activeElement.getAttribute("aria-label"), "Close booking dialog");
    await key(document.activeElement, "Escape"); assert.equal(dialog(), null); assert.equal(document.body.style.overflow, ""); assert.equal(document.activeElement, trigger);
    await action("MV-CONFIRMED", "Pay balance"); assert.deepEqual(h.pushes, ["/booking/payment"]); assert.equal(h.drafts[0].reservationId, "booking");
  } finally { await h.close(); }
});

test("service errors and recalculated amounts remain visible in the selected dialog, which cannot close during save", async () => {
  const calls = []; let rejectSave = true, resolveSave;
  const h = await mount(async (url, options) => {
    if (!options?.method) return Response.json({ refunds: [], eligible: [] });
    calls.push({ url, body: JSON.parse(options.body) });
    if (rejectSave) return Response.json({ message: "Service not available" }, { status: 409 });
    return new Promise(resolve => { resolveSave = () => resolve(Response.json({ success: true, message: "Services saved", totalAmount: 3600, paidAmount: 600, remainingBalance: 3000 })); });
  });
  try {
    await action("MV-CONFIRMED", "Edit services");
    await value(dialog().querySelector('[aria-label="New service"]'), "karaoke");
    await click(button(dialog(), "Add Service"));
    await value(dialog().querySelector('[aria-label="Quantity for Extra table"]'), "2");
    await click(button(dialog(), "Save Service Changes")); assert.match(dialog().querySelector('[role="alert"]').textContent, /Service not available/);
    assert.deepEqual(calls[0].body, { reservationId: "booking", services: [{ serviceId: "service", quantity: 2 }, { serviceId: "karaoke", quantity: 1 }] });
    rejectSave = false; await click(button(dialog(), "Save Service Changes"));
    assert.equal(dialog().getAttribute("aria-busy"), "true"); assert.equal(button(dialog(), "Close").disabled, true);
    await key(dialog(), "Escape"); assert.ok(dialog()); await act(async () => resolveSave());
    assert.match(dialog().textContent, /Services saved/); assert.match(dialog().textContent, /Booking details/);
    assert.match(dialog().textContent, /3,600/); assert.match(dialog().textContent, /Karaoke/);
    await click(button(dialog(), "Close"));
    assert.match(h.container.querySelector('[aria-label="Booking MV-CONFIRMED"]').textContent, /3,600/);
    await action("MV-REVIEW", "View"); assert.equal(dialog().textContent.includes("Services saved"), false);
  } finally { await h.close(); }
});

test("reschedule requests retain the original time and duration, and show approval status inside the dialog", async () => {
  let posted;
  const h = await mount(async (url, options) => {
    if (!options?.method) return Response.json({ refunds: [], eligible: [] });
    posted = { url, body: JSON.parse(options.body) };
    return Response.json({ success: true, totalAdditional: 500, rescheduleFee: 500, rateAdjustment: 0 });
  });
  try {
    await action("MV-CONFIRMED", "Reschedule");
    assert.equal(dialog().querySelector('input[type="date"]'), null);
    assert.equal(button(dialog(), "Submit Reschedule Request").disabled, true);
    assert.equal(dialog().querySelector(`button[data-date="${day(20)}"]`).disabled, true);
    await click(dialog().querySelector('[aria-label="Next month"]'));
    await click(dialog().querySelector('[aria-label="Previous month"]'));
    assert.equal(posted, undefined);
    await chooseDate(day(25));
    assert.equal(dialog().querySelector(`button[data-date="${day(25)}"]`).getAttribute("aria-pressed"), "true");
    await click(button(dialog(), "Submit Reschedule Request"));
    assert.equal(posted.url, "/api/reservations/reschedule"); assert.equal(posted.body.reservationId, "booking");
    assert.equal(new Date(posted.body.newEndDatetime) - new Date(posted.body.newStartDatetime), 10 * 3600000);
    assert.equal(posted.body.newStartDatetime, day(25) + "T00:00:00.000Z");
    assert.match(dialog().textContent, /Request sent for review/); assert.match(dialog().textContent, /Reschedule Requested/);
    assert.match(dialog().textContent, /500/); assert.equal(dialog().textContent.includes("Submit Reschedule Request"), false);
  } finally { await h.close(); }
});

test("closed and payment-review reservations keep their action restrictions in the menu", async () => {
  const h = await mount();
  try {
    await click(options("MV-CLOSED"));
    for (const label of ["Edit services", "Reschedule", "Pay balance", "Cancel reservation"]) assert.equal(menuItem(label).disabled, true, label);
    assert.match(menuItem("Edit services").textContent, /closed/); await key(document.activeElement, "Escape");
    await click(options("MV-REVIEW")); assert.equal(menuItem("Edit services").disabled, true); assert.equal(menuItem("Pay balance").disabled, true);
    assert.match(menuItem("Pay balance").textContent, /being reviewed/); assert.equal(menuItem("View").disabled, false);
    await key(document.activeElement, "Escape"); await value(h.container.querySelector('[type="search"]'), "CLOSED");
    assert.equal(h.container.querySelectorAll("article").length, 1);
  } finally { await h.close(); }
});

test("late guest reschedules explain the Philippine deadline and disable requests in the calendar dialog", async () => {
  const previous = { ...rows[0] };
  Object.assign(rows[0], { start_datetime: day(2) + "T08:00:00+08:00", end_datetime: day(2) + "T18:00:00+08:00" });
  let posts = 0; const h = await mount(async (_url, options) => { if (options?.method) posts++; return Response.json({ refunds: [], eligible: [] }); });
  try {
    await action("MV-CONFIRMED", "Reschedule");
    assert.match(dialog().textContent, /Contact the resort for a staff-reviewed exception/);
    assert.match(dialog().textContent, /deadline was/); assert.match(dialog().textContent, /PHP 300/);
    assert.equal(button(dialog(), "Submit Reschedule Request").disabled, true);
    for (const date of dialog().querySelectorAll("button[data-date]")) assert.equal(date.disabled, true);
    assert.equal(posts, 0);
  } finally { Object.assign(rows[0], previous); await h.close(); }
});

test("ocular visit edits show their saved schedule in a dialog and cancellation uses its confirmation", async () => {
  const calls = [];
  const h = await mount(async (url, options) => {
    if (!options?.method) return Response.json({ refunds: [], eligible: [] });
    calls.push({ url, body: JSON.parse(options.body) }); return Response.json({ success: true, message: "Visit updated" });
  });
  try {
    await click([...h.container.querySelectorAll("button")].find(b => b.textContent.includes("Ocular visits")));
    await action("OC-VISIT", "Edit visit"); await value(dialog().querySelector('[aria-label="Scheduled Date"]'), day(16));
    await click(button(dialog(), "Save Changes"));
    assert.deepEqual(calls[0], { url: "/api/ocular-visits/reschedule", body: { visitId: "visit", scheduledDate: day(16), timeSlotId: "slot" } });
    assert.match(dialog().textContent, /Visit updated/); assert.match(dialog().textContent, /Ocular visit details/);
    await click(button(dialog(), "Close")); await action("OC-VISIT", "Cancel visit");
    assert.match(dialog().textContent, /Cancel Ocular Visit/); await click(button(dialog(), "Confirm Cancel"));
    assert.equal(calls[1].url, "/api/ocular-visits/cancel"); assert.equal(dialog(), null); assert.match(h.container.textContent, /has been cancelled/);
  } finally { await h.close(); }
});

test("View refunds opens the Refunds tab filtered to the selected reservation", async () => {
  const h = await mount(async () => Response.json({ refunds: [
    { refund_id: "a", reservation_id: "booking", reference_number: "MV-CONFIRMED", amount: 100, status: "pending", request_kind: "overpayment", requested_at: new Date().toISOString() },
    { refund_id: "b", reservation_id: "closed", reference_number: "MV-CLOSED", amount: 200, status: "refunded", request_kind: "cancellation", requested_at: new Date().toISOString() },
  ], eligible: [] }));
  try {
    const scrolls = [];
    h.container.querySelector("main > div").scrollIntoView = options => scrolls.push(options);
    assert.equal(h.container.querySelector('[aria-label="Refund requests"]'), null);
    await action("MV-CONFIRMED", "View"); await click(button(dialog(), "View refunds")); assert.equal(dialog(), null);
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    assert.equal(document.activeElement, button(h.container, "Refunds"));
    assert.equal(scrolls[0].block, "start");
    assert.equal(button(h.container, "Refunds").getAttribute("aria-pressed"), "true");
    const refunds = h.container.querySelector('[aria-label="Refund requests"]');
    assert.match(refunds.textContent, /awaiting payment-record review/); assert.equal(refunds.textContent.includes("MV-CLOSED"), false);
    await value(h.container.querySelector('[type="search"]'), ""); assert.match(refunds.textContent, /MV-CLOSED/);
    await value(h.container.querySelector('[type="search"]'), "missing"); assert.match(refunds.textContent, /No matching refunds/);
  }
  finally { await h.close(); }
});


test("booking cancellation opens its financial preview and then the cancelled reservation dialog with the new refund", async () => {
  let cancelled = false, posted;
  const preview = { reservationId: "booking", reference: "MV-CONFIRMED", initiator: "guest", totalAmount: 3000,
    verifiedPaid: 3000, previousRefunds: 0, netPaid: 3000, depositBase: 3000, depositAmount: 600, deduction: 600,
    refundableAmount: 2400, allowed: true, outcome: "pending_refund", rule: "Initial 20% deposit retained", quote: "a".repeat(32) };
  const h = await mount(async (url, options) => {
    if (url.startsWith("/api/reservations/cancel")) {
      if (options?.method === "POST") { posted = JSON.parse(options.body); cancelled = true; return Response.json({ ...preview, refundId: "refund", message: "Refund request created", emailSent: true }); }
      return Response.json({ preview });
    }
    return Response.json({ eligible: [], refunds: cancelled ? [{ refund_id: "refund", reservation_id: "booking", reference_number: "MV-CONFIRMED", amount: 2400, status: "pending", request_kind: "cancellation", requested_at: new Date().toISOString() }] : [] });
  });
  try {
    await action("MV-CONFIRMED", "Cancel reservation"); assert.match(dialog().textContent, /Retained deposit/); assert.equal(button(dialog(), "Confirm cancellation").disabled, true);
    await click(dialog().querySelector('[type="checkbox"]')); await click(button(dialog(), "Confirm cancellation"));
    assert.equal(posted.reservationId, "booking"); assert.equal(posted.quote, preview.quote);
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 1); assert.match(dialog().textContent, /Booking details/);
    assert.match(dialog().textContent, /refund request was created automatically/);
    assert.match(dialog().textContent, /Payment collectionClosed/); assert.equal(button(dialog(), "Continue to Payment"), undefined);
    await click(button(dialog(), "View refunds")); assert.equal(dialog(), null);
    assert.match(h.container.querySelector('[aria-label="Refund requests"]').textContent, /2,400/);
  } finally { await h.close(); }
});


test("the Refunds tab shows empty/error states and submits an eligible excess refund only once", async () => {
  for (const scenario of ["empty", "error", "eligible"]) {
    let requests = 0, submitted = false, posted, fail = scenario === "error";
    const h = await mount(async (url, options) => {
      if (options?.method === "POST") { requests++; submitted = true; posted = JSON.parse(options.body); return Response.json({ message: "Refund requested successfully" }); }
      if (fail) return Response.json({ message: "Could not load refunds" }, { status: 503 });
      return Response.json({ refunds: submitted ? [{ refund_id: "excess", reservation_id: "booking", reference_number: "MV-CONFIRMED", amount: 500, status: "pending", request_kind: "overpayment", requested_at: new Date().toISOString() }] : [],
        eligible: scenario === "eligible" && !submitted ? [{ reservation_id: "booking", reference_number: "MV-CONFIRMED", amount: 500 }] : [] });
    });
    try {
      await click(button(h.container, "Refunds")); assert.equal(h.container.querySelectorAll("article").length, 0);
      if (scenario === "empty") assert.match(h.container.textContent, /No refunds to show/);
      if (scenario === "error") {
        assert.match(h.container.querySelector('[role="alert"]').textContent, /Could not load refunds/);
        fail = false; await click(button(h.container, "Try again")); assert.match(h.container.textContent, /No refunds to show/);
      }
      if (scenario === "eligible") {
        await click(button(h.container, "Request excess refund")); assert.equal(requests, 1); assert.deepEqual(posted, { reservationId: "booking" });
        assert.equal(button(h.container, "Request excess refund"), undefined); assert.match(h.container.textContent, /Refund requested successfully/);
      }
    } finally { await h.close(); }
  }
});


test("the custom calendar handles leap days and month boundaries while disabling past and current dates", async () => {
  const Calendar = loadTsModule("components/manage/RescheduleCalendar.tsx").default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container); let selected = "";
  const render = () => root.render(createElement(Calendar, { value: selected, onChange: date => { selected = date; render(); }, minDate: "2028-02-07", originalDate: "2028-02-10" }));
  try {
    await act(async () => render()); assert.equal(container.querySelector('[aria-label="Previous month"]').disabled, true);
    assert.equal(container.querySelector('[data-date="2028-02-06"]').disabled, true); assert.equal(container.querySelector('[data-date="2028-02-10"]').disabled, true);
    await click(container.querySelector('[data-date="2028-02-29"]')); assert.equal(selected, "2028-02-29");
    assert.equal(container.querySelector('[data-date="2028-02-29"]').getAttribute("aria-pressed"), "true");
    await click(container.querySelector('[aria-label="Next month"]')); assert.ok(container.querySelector('[data-date="2028-03-01"]'));
    await click(container.querySelector('[aria-label="Previous month"]')); assert.equal(container.querySelector('[data-date="2028-02-29"]').getAttribute("aria-pressed"), "true");
  } finally { await act(async () => root.unmount()); container.remove(); }
});


test("options menus stay within short phone viewports and dismiss when the viewport changes", async () => {
  const width = Object.getOwnPropertyDescriptor(window, "innerWidth"), height = Object.getOwnPropertyDescriptor(window, "innerHeight");
  const h = await mount();
  try {
    for (const [w, hgt] of [[320, 568], [390, 844], [667, 375]]) {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: hgt });
      const trigger = options("MV-CONFIRMED");
      trigger.getBoundingClientRect = () => ({ right: w - 12, top: hgt - 56, bottom: hgt - 12 });
      await click(trigger); const menu = document.querySelector('[role="menu"]');
      assert.ok(Number.parseFloat(menu.style.left) >= 8); assert.ok(Number.parseFloat(menu.style.top) >= 8);
      assert.ok(Number.parseFloat(menu.style.top) + Number.parseFloat(menu.style.maxHeight) <= hgt - 8);
      await act(async () => menu.dispatchEvent(new window.Event("scroll"))); assert.ok(document.querySelector('[role="menu"]'));
      await act(async () => window.dispatchEvent(new window.Event("resize"))); assert.equal(document.querySelector('[role="menu"]'), null);
      assert.equal(trigger.getAttribute("aria-expanded"), "false");
    }
  } finally { Object.defineProperty(window, "innerWidth", width); Object.defineProperty(window, "innerHeight", height); await h.close(); }
});
