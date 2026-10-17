import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { create } from "zustand";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/booking/form" });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

test("booking blocks invalid contacts and carries the normalized Philippine number into review", async () => {
  const originalFetch = globalThis.fetch, pushes = [];
  globalThis.fetch = async () => Response.json({ success: true, catalog: { units: [{ unit_id: "pool", name: "Pool", base_price: 7500 }], services: [] } });
  const store = create(set => ({ bookingDraft: {
    bookingMode: "night", startDatetime: "2027-06-14T18:00:00+08:00", endDatetime: "2027-06-15T06:00:00+08:00",
    firstName: "Maria", lastName: "Cruz", email: "guest@example.com", address: "Taytay", phone: "09171234567",
    unitId: "pool", adultCount: 2, childCount: 0, services: [],
  }, setBookingDraft: patch => set(state => ({ bookingDraft: { ...state.bookingDraft, ...patch } })) }));
  const Component = loadTsModule("app/booking/form/page.tsx", {
    "next/link": ({ href, children, ...props }) => createElement("a", { href, ...props }, children),
    "next/navigation": { useRouter: () => ({ push: path => pushes.push(path) }) },
    "@/components/Navigation": () => null, "@/components/Footer": () => null,
    "@/lib/stores/booking-store": { useBookingStore: store },
    "@/lib/supabase/client": { createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) },
    "@/lib/booking/use-package-rates": { usePackageRates: () => ({ schedule: { version: 1, rates: legacyRates }, error: null }) },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Component)));
    const phone = container.querySelector("#booking-phone");
    assert.equal(phone.value, "9171234567"); assert.match(phone.parentElement.textContent, /\+63/);
    const review = [...container.querySelectorAll("button")].find(button => button.textContent.includes("Review Full Details"));
    assert.equal(review.disabled, false);
    for (const next of ["0917abc4567", "+649171234567", "0917123456", "+63 917 123 4567"]) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(phone, next);
        phone.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
      await act(async () => review.click());
      if (next === "+63 917 123 4567") {
        assert.deepEqual(pushes, ["/booking/details"]);
        assert.equal(store.getState().bookingDraft.phone, "+639171234567");
        assert.equal(store.getState().bookingDraft.checkIn, "2027-06-14");
        assert.equal(store.getState().bookingDraft.checkOut, "2027-06-15", "early departures must keep their Philippine date");
      } else {
        assert.deepEqual(pushes, []);
        assert.match(container.querySelector('[role="alert"]').textContent, /valid Philippine mobile number/);
      }
    }
  } finally {
    await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch;
  }
});
