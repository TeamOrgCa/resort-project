import test, { after } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { renderToString } from "react-dom/server";
import { JSDOM } from "jsdom";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/booking", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "SVGElement", "ShadowRoot", "MutationObserver", "KeyboardEvent", "AbortController", "AbortSignal"]) globalThis[key] = dom.window[key];
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: true });
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLElement.prototype.getBoundingClientRect = function () { return new window.DOMRect(20, 100, 280, 80); };
window.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [this.getBoundingClientRect()]; };
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

test("booking guide renders without starting Driver during SSR", () => {
  const Guide = loadTsModule("components/booking/BookingGuide.tsx", { "driver.js": { driver: () => { throw Error("SSR must not start the tour"); } } }).default;
  const html = renderToString(createElement(Guide, { page: "dates" }));
  assert.match(html, /Start booking guide for this page/);
  assert.doesNotMatch(html, /driver-popover/);
});

const title = () => document.querySelector(".driver-popover-title")?.textContent;
const click = async selector => { const element = document.querySelector(selector); assert.ok(element, `${selector}: ${document.body.innerHTML}`); await act(async () => element.click()); };
async function mount(props, mocks = {}) {
  const Guide = loadTsModule("components/booking/BookingGuide.tsx", mocks).default;
  const host = document.createElement("div"); document.body.append(host);
  host.innerHTML = '<form><input name="guest" value="Maria"><section data-booking-guide="booking-type">Stay or ocular</section><section data-booking-guide="dates-calendar">Dates</section><section data-booking-guide="ocular-times" hidden>Hidden times</section><button data-booking-guide="dates-continue" type="submit">Continue to Reservation</button></form><div id="guide-host"></div>';
  let submitted = 0; host.querySelector("form").addEventListener("submit", event => { event.preventDefault(); submitted++; });
  const root = createRoot(host.querySelector("#guide-host"));
  await act(async () => root.render(createElement(Guide, props)));
  return { host, submitted: () => submitted, async render(next) { await act(async () => root.render(createElement(Guide, next))); },
    async close() { await act(async () => root.unmount()); host.remove(); } };
}

test("real Driver tour supports Next, Back, Finish and replay without changing or submitting the booking", async () => {
  const h = await mount({ page: "dates" });
  try {
    assert.equal(document.querySelector(".driver-popover"), null);
    await click('[aria-label="Start booking guide for this page"]');
    assert.match(title(), /plan your resort booking/);
    assert.equal(document.querySelector(".driver-popover-progress-text").textContent, "1 of 4");
    await click(".driver-popover-next-btn"); assert.equal(title(), "Stay or a quick resort visit?");
    await click(".driver-popover-prev-btn"); assert.match(title(), /plan your resort booking/);
    await click(".driver-popover-next-btn"); await click(".driver-popover-next-btn");
    assert.equal(title(), "Find an available date");
    await click(".driver-popover-next-btn"); assert.equal(title(), "Next: guest details");
    // The highlighted submit control remains protected during the walkthrough.
    await click('[data-booking-guide="dates-continue"]');
    assert.equal(h.submitted(), 0);
    assert.equal(h.host.querySelector("input").value, "Maria");
    await click(".driver-popover-next-btn");
    assert.equal(document.querySelector(".driver-popover"), null);
    assert.equal(document.activeElement, h.host.querySelector('[aria-label="Start booking guide for this page"]'));
    await click('[aria-label="Start booking guide for this page"]'); assert.match(title(), /plan your resort booking/);
    await click(".driver-popover-close-btn");
    assert.equal(document.querySelector(".driver-popover"), null);
  } finally { await h.close(); }
});

test("ocular guide skips hidden time slots, Escape closes, and changing page tears down the active tour", async () => {
  const h = await mount({ page: "ocular" });
  try {
    await click('[aria-label="Start booking guide for this page"]');
    assert.match(title(), /resort viewing/);
    assert.equal(document.querySelector(".driver-popover-progress-text").textContent, "1 of 3");
    await act(async () => {
      document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.dispatchEvent(new window.KeyboardEvent("keyup", { key: "Escape", bubbles: true }));
    });
    assert.equal(document.querySelector(".driver-popover"), null);
    await click('[aria-label="Start booking guide for this page"]');
    await h.render({ page: "guest" });
    assert.equal(document.querySelector(".driver-popover"), null);
    assert.equal(document.body.classList.contains("driver-active"), false);
    await click('[aria-label="Start booking guide for this page"]'); assert.equal(title(), "Tell us about your group");
    await h.close();
    assert.equal(document.querySelector(".driver-popover"), null);
    assert.equal(document.body.classList.contains("driver-active"), false);
  } finally { if (h.host.isConnected) await h.close(); }
});

test("busy booking actions block the guide and a failed startup can be retried", async () => {
  let attempts = 0;
  const h = await mount({ page: "payment", disabled: true }, { "driver.js": { driver: () => { attempts++; throw Error("Load failed"); } } });
  try {
    await click('[aria-label="Start booking guide for this page"]'); assert.equal(attempts, 0);
    await h.render({ page: "payment", disabled: false });
    await click('[aria-label="Start booking guide for this page"]');
    assert.match(h.host.querySelector('[role="status"]').textContent, /couldn't load/);
    await click('[aria-label="Start booking guide for this page"]'); assert.equal(attempts, 2);
  } finally { await h.close(); }
});

test("saved review and balance-payment guides use the correct next actions", () => {
  const { bookingGuide } = loadTsModule("components/booking/booking-guide.ts");
  assert.match(bookingGuide("review", true).title, /booking is saved/);
  assert.equal(bookingGuide("review", true).steps.at(-1).popover.title, "Next: payment");
  assert.match(bookingGuide("payment", false, true).description, /saved reservation/);
  assert.match(bookingGuide("payment", false, true).steps[0].popover.description, /outstanding balance/);
  assert.match(bookingGuide("payment-complete").description, /approved or is awaiting review/);
});
