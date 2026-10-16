import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/manage" });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client"); after(() => dom.window.close());
const Component = loadTsModule("components/manage/GuestBookingEditor.tsx").default;
const service = "44444444-4444-4444-8444-444444444444", extra = "55555555-5555-4555-8555-555555555555";
const detail = { reservation: { reservation_id: "booking", booking_mode: "day", adult_count: 22, child_count: 0, start_datetime: "2027-06-14T08:00:00+08:00", end_datetime: "2027-06-14T16:00:00+08:00" },
  services: [{ service_id: service, quantity: 2, price_at_time: 100 }], catalogServices: [{ service_id: service, name: "Table", price: 999, is_active: false }, { service_id: extra, name: "Karaoke", price: 500, is_active: true }],
  bill: { total_amount: 8600, paid_amount: 1720, status: "partial" }, version: "a".repeat(64), packageRates: legacyRates, lockedReason: null, canChangeGuests: true, canReduceServices: true };
const button = (c, text) => [...c.querySelectorAll("button")].find(button => button.textContent.trim() === text);
const click = element => act(async () => { assert.ok(element); assert.equal(element.disabled, false); element.click(); });
async function input(el, value) { await act(async () => { const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value)); el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); }); }
async function mount({ loaded = detail, fetcher = async () => Response.json({ success: true }) } = {}) {
  const original = globalThis.fetch; globalThis.fetch = (url, options) => options?.method ? fetcher(url, options) : Promise.resolve(Response.json(loaded));
  const c = document.createElement("div"); document.body.append(c); const root = createRoot(c); const busy = [], saved = [];
  await act(async () => root.render(createElement(Component, { reservationId: "booking", onBusyChange: value => busy.push(value), onSaved: result => saved.push(result) })));
  return { c, busy, saved, close: async () => { await act(async () => root.unmount()); c.remove(); globalThis.fetch = original; } };
}

test("partial-payment edits preview headcount charges and allow reducing/removing every service before saving", async () => {
  let posted; const h = await mount({ fetcher: async (_url, options) => { posted = JSON.parse(options.body); return Response.json({ success: true, totalAmount: 8150 }); } });
  try {
    assert.equal(button(h.c, "Save Booking Changes").disabled, true);
    await input(h.c.querySelector('[aria-label="Adults"]'), 20);
    await input(h.c.querySelector('[aria-label="Quantity for Table"]'), 1);
    assert.match(h.c.querySelector('[aria-label="Updated bill preview"]').textContent, /8,250/);
    await click(h.c.querySelector('[aria-label="Remove Table"]')); assert.match(h.c.textContent, /Services are optional/);
    assert.match(h.c.querySelector('[aria-label="Updated bill preview"]').textContent, /8,150/);
    await click(button(h.c, "Save Booking Changes"));
    assert.deepEqual(posted, { adultCount: 20, childCount: 0, services: [], version: detail.version, expectedTotal: 8150 });
    assert.deepEqual(h.busy, [true, false]); assert.equal(h.saved[0].totalAmount, 8150);
    assert.equal(h.c.querySelector('input[type="date"]'), null); assert.equal(h.c.textContent.includes("Change package"), false);
  } finally { await h.close(); }
});

test("full-payment and during-stay restrictions retain additions and expose actionable reduction errors", async () => {
  const h = await mount({ loaded: { ...detail, bill: { ...detail.bill, paid_amount: 8600 }, canReduceServices: false } });
  try {
    assert.equal(h.c.querySelector('[aria-label="Remove Table"]').disabled, true);
    assert.equal(h.c.querySelector('[aria-label="Quantity for Table"]').min, "2");
    await input(h.c.querySelector('[aria-label="Adults"]'), 31); assert.match(h.c.querySelector('[role="alert"]').textContent, /no more than 30/);
    assert.equal(button(h.c, "Save Booking Changes").disabled, true);
    await input(h.c.querySelector('[aria-label="Adults"]'), 21); assert.equal(button(h.c, "Save Booking Changes").disabled, false);
    assert.match(h.c.textContent, /Excess paid/);
    await input(h.c.querySelector('[aria-label="New service"]'), extra); await click(button(h.c, "Add Service"));
    assert.equal(h.c.querySelector('[aria-label="Remove Karaoke"]').disabled, false);
  } finally { await h.close(); }
  const stay = await mount({ loaded: { ...detail, canChangeGuests: false, canReduceServices: false } });
  try { assert.equal(stay.c.querySelector('[aria-label="Adults"]').disabled, true); assert.equal(stay.c.querySelector('[aria-label="Remove Table"]').disabled, true); }
  finally { await stay.close(); }
});

test("stale billing blocks retries until reload and repeated clicks submit just one request", async () => {
  let finish, posts = 0; const h = await mount({ fetcher: async () => { posts++; return new Promise(resolve => { finish = () => resolve(Response.json({ message: "Bill changed. Reload." }, { status: 409 })); }); } });
  try {
    await click(h.c.querySelector('[aria-label="Remove Table"]')); const save = button(h.c, "Save Booking Changes");
    await act(async () => { save.click(); save.click(); }); assert.equal(posts, 1);
    await act(async () => finish()); assert.match(h.c.querySelector('[role="alert"]').textContent, /Bill changed/);
    assert.equal(button(h.c, "Save Booking Changes").disabled, true); await click(button(h.c, "Reload booking and bill"));
    assert.equal(h.c.querySelector('[aria-label="Quantity for Table"]').value, "2"); assert.equal(h.c.querySelector('[role="alert"]'), null);
  } finally { await h.close(); }
});
