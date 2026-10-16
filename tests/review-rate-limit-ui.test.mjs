import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/reviews" });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client"); after(() => dom.window.close());
const button = (c, label) => [...c.querySelectorAll("button")].find(e => e.textContent.trim() === label);
async function value(el, text) { await act(async () => { Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, "value").set.call(el, text); el.dispatchEvent(new window.Event("input", { bubbles: true })); }); }
test("review rate-limit errors appear in a popup with the retry time and retain the written review", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => options?.method === "POST" ? Response.json({ error: "Wait 10 minutes between reviews.", retryAfter: 600, code: "REVIEW_RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "600" } }) : String(_url).includes("/eligibility") ? Response.json({ eligible: true, reservations: [] }) : Response.json({ reviews: [] });
  const Component = loadTsModule("app/reviews/page.tsx", {
    "@/components/Navigation": () => null, "@/components/Footer": () => null, "next/image": () => null,
    "next/link": ({ href, children }) => createElement("a", { href }, children),
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Component)));
    await act(async () => button(container, "Write a Review").click());
    await value(container.querySelector('input[placeholder="Summarize your experience"]'), "Another visit");
    const text = "We enjoyed the swimming pool and helpful staff during another wonderful family visit.";
    await value(container.querySelector("textarea"), text);
    assert.match(container.textContent, /maximum of 3 reviews in 24 hours/);
    await act(async () => container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    const dialog = document.querySelector('[role="alertdialog"]'); assert.ok(dialog); assert.match(dialog.textContent, /Try again after/); assert.match(dialog.textContent, /Philippine time/);
    assert.equal(container.querySelector("textarea").value, text);
    await act(async () => dialog.querySelector("button").click()); assert.equal(document.querySelector('[role="alertdialog"]'), null);
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; }
});

test("review form remains closed until completed-stay eligibility is confirmed", async () => {
  const originalFetch = globalThis.fetch; let eligible = false;
  globalThis.fetch = async url => String(url).includes("/eligibility") ? Response.json({ eligible, message: "Complete a stay before reviewing.", reservations: [{ reservation_id: "stay", reference_number: "MV-COMPLETED", end_datetime: "2026-10-17T06:00:00+08:00" }] }) : Response.json({ reviews: [] });
  const Component = loadTsModule("app/reviews/page.tsx", { "@/components/Navigation": () => null, "@/components/Footer": () => null, "next/image": () => null, "next/link": ({ href, children }) => createElement("a", { href }, children) }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Component)));
    await act(async () => button(container, "Write a Review").click());
    assert.equal(container.querySelector("form"), null); assert.match(container.querySelector('[role="alert"]').textContent, /Complete a stay/);
    eligible = true; await act(async () => button(container, "Write a Review").click());
    assert.ok(container.querySelector("form")); assert.match(container.querySelector("#review-completed-stay").textContent, /MV-COMPLETED/);
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; }
});
