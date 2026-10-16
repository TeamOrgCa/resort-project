import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement, useEffect } from "react";
import { create } from "zustand";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/booking/details" });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client"); after(() => dom.window.close());
const draft = { startDatetime: "2027-06-14T08:00:00+08:00", endDatetime: "2027-06-14T16:00:00+08:00", bookingMode: "day", unitId: "pool", adultCount: 4, childCount: 0,
  firstName: "Maria", lastName: "Cruz", email: "guest@example.com", phone: "09171234567", address: "Taytay", services: [], specialRequests: "", roomPrice: 7500, total: 7500, nights: 1, tax: 0, reservationId: "", reservationReference: "" };
async function mount(fetcher, saved = false) {
  const original = globalThis.fetch; globalThis.fetch = fetcher;
  const store = create(set => ({ bookingDraft: { ...draft, ...(saved ? { reservationId: "reservation", reservationReference: "MV-SAVED" } : {}) },
    setBookingDraft: patch => set(state => ({ bookingDraft: { ...state.bookingDraft, ...patch } })) }));
  const Component = loadTsModule("app/booking/details/page.tsx", {
    "next/link": ({ href, children, ...props }) => createElement("a", { href, ...props }, children),
    "@/components/Navigation": () => null, "@/components/Footer": () => null,
    "@/lib/stores/booking-store": { useBookingStore: store },
    "@/components/legal/PolicyAgreement": ({ accepted, onChange, onPolicyVersion }) => {
      useEffect(() => { onPolicyVersion(1); }, [onPolicyVersion]);
      return createElement("input", { type: "checkbox", "aria-label": "Accept terms", checked: accepted, onChange: event => onChange(event.target.checked) });
    },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component)));
  return { container, store, close: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = original; } };
}
const actions = container => container.querySelector('[aria-label="Booking actions"]');
const labels = container => [...actions(container).children].map(child => child.textContent.trim());
const click = el => act(async () => el.click());

test("booking review has exactly two actions and switches them only after a successful save", async () => {
  let finish, posts = 0;
  const h = await mount(async () => { posts++; return new Promise(resolve => { finish = () => resolve(Response.json({ success: true, reservation: { id: "reservation", referenceNumber: "MV-TEST", totalAmount: 7500, paymentDeadlineAt: "2027-06-14T01:00:00Z" } })); }); });
  try {
    assert.deepEqual(labels(h.container), ["Back to Edit", "Save Booking"]);
    assert.equal(actions(h.container).querySelector("a").getAttribute("href"), "/booking/form");
    const save = actions(h.container).querySelector("button"); assert.equal(save.disabled, true);
    await click(h.container.querySelector('[aria-label="Accept terms"]'));
    await act(async () => { save.click(); save.click(); }); assert.equal(posts, 1);
    assert.deepEqual(labels(h.container), ["Back to Edit", "Saving Booking..."]);
    assert.equal(actions(h.container).querySelector("a").getAttribute("aria-disabled"), "true");
    await act(async () => finish());
    assert.deepEqual(labels(h.container), ["Back to Home", "Continue to Payment"]);
    assert.deepEqual([...actions(h.container).querySelectorAll("a")].map(a => a.getAttribute("href")), ["/", "/booking/payment"]);
    const status = h.container.querySelector('[role="status"]'); assert.equal(status.nextElementSibling, actions(h.container));
    assert.match(status.textContent, /Booking saved successfully/); assert.match(status.textContent, /MV-TEST/); assert.match(status.textContent, /Submit payment by/);
    assert.equal(h.store.getState().bookingDraft.reservationId, "reservation"); assert.equal(actions(h.container).querySelector("button"), null);
  } finally { await h.close(); }
});

test("failed saves retain the edit/save actions and show the retry error directly above them", async () => {
  let fail = true;
  const h = await mount(async () => fail ? Response.json({ message: "That date was just booked." }, { status: 409 }) : Response.json({ success: true, reservation: { id: "reservation" } }));
  try {
    await click(h.container.querySelector('[aria-label="Accept terms"]')); await click(actions(h.container).querySelector("button"));
    assert.deepEqual(labels(h.container), ["Back to Edit", "Save Booking"]);
    assert.match(h.container.querySelector('[role="alert"]').textContent, /date was just booked/);
    assert.equal(h.container.querySelector('[role="alert"]').nextElementSibling, actions(h.container));
    assert.equal(h.store.getState().bookingDraft.reservationId, "");
    fail = false; await click(actions(h.container).querySelector("button")); assert.deepEqual(labels(h.container), ["Back to Home", "Continue to Payment"]);
  } finally { await h.close(); }
});

test("reopening an already saved booking shows its confirmation and only home/payment actions", async () => {
  let posts = 0; const h = await mount(async () => { posts++; throw Error("No second reservation should be created"); }, true);
  try {
    assert.deepEqual(labels(h.container), ["Back to Home", "Continue to Payment"]);
    assert.match(h.container.querySelector('[role="status"]').textContent, /MV-SAVED/);
    assert.equal(h.container.querySelector('[aria-label="Accept terms"]'), null); assert.equal(posts, 0);
  } finally { await h.close(); }
});
