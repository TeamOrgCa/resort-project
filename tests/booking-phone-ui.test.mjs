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

async function bookingFetch(url) {
  if (url.startsWith("https://psgc.cloud/api/")) return Response.json(url.endsWith("/provinces")
    ? [{ code: "0405800000", name: "Rizal" }]
    : [{ code: "0405813000", name: "Taytay", type: "Mun" }, { code: "0405805000", name: "Cainta", type: "Mun" }]);
  return Response.json({ success: true, catalog: { units: [{ unit_id: "pool", name: "Pool", base_price: 7500,unit_img:"https://images.example.com/pool.jpg",capacity:4 },{unit_id:"garden",name:"Garden Room",base_price:8000,unit_img:"https://images.example.com/garden.jpg",capacity:2,description:"Air-conditioned garden room"}], services: [{ service_id: "mattress", name: "Extra mattress", description: "Fresh linen included", image_url: "https://images.example.com/mattress.jpg", price: 500,max_quantity:3 }] } });
}

test("booking blocks invalid contacts and carries the normalized Philippine number into review", async () => {
  const originalFetch = globalThis.fetch, pushes = [];
  globalThis.fetch = bookingFetch;
  const store = create(set => ({ bookingDraft: {
    bookingMode: "night", startDatetime: "2027-06-14T18:00:00+08:00", endDatetime: "2027-06-15T06:00:00+08:00",
    firstName: "Maria", lastName: "Cruz", email: "guest@example.com", address: "Block 2, Main Street, Taytay, Rizal, 1920", phone: "09171234567",
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
    assert.match(container.textContent, /Fresh linen included/);
    assert.ok(container.querySelector('img[src="https://images.example.com/mattress.jpg"]'));
    assert.equal(container.querySelector('select[name="roomType"]'),null);
    assert.equal(container.querySelector('input[name="roomType"][value="pool"]').checked,true);
    assert.ok(container.querySelector('img[src="https://images.example.com/garden.jpg"]'));
    await act(async()=>container.querySelector('img[src="https://images.example.com/garden.jpg"]').click());
    assert.equal(container.querySelector('input[name="roomType"][value="garden"]').checked,true);
    await act(async () => container.querySelector('input[aria-label="Add Extra mattress"]').click());
    const phone = container.querySelector("#booking-phone");
    assert.equal(phone.value, "9171234567"); assert.match(phone.parentElement.textContent, /\+63/);
    const review = [...container.querySelectorAll("button")].find(button => button.textContent.includes("Review Full Details"));
    assert.equal(review.disabled, false);
    const quantity=container.querySelector('[aria-label="Quantity for Extra mattress"]');assert.equal(quantity.min,"1");assert.equal(quantity.max,"3");
    const plus=container.querySelector('[aria-label="Increase Extra mattress quantity"]');
    await act(async()=>{plus.click();});await act(async()=>{plus.click();});assert.equal(quantity.value,"3");assert.equal(plus.disabled,true);
    for(const value of ["4","0","1.5",""]){
      await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set.call(quantity,value);quantity.dispatchEvent(new window.Event("input",{bubbles:true}));});
      assert.equal(review.disabled,true);assert.ok(container.querySelector('[role="alert"]'));
    }
    await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set.call(quantity,"2");quantity.dispatchEvent(new window.Event("input",{bubbles:true}));});
    assert.equal(review.disabled,false);assert.match(container.textContent,/Line total:.*1,000\.00/);
    for (const next of ["0917abc4567", "+649171234567", "0917123456", "+63 917 123 4567"]) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(phone, next);
        phone.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
      await act(async () => review.click());
      if (next === "+63 917 123 4567") {
        assert.deepEqual(pushes, ["/booking/details"]);
        assert.equal(store.getState().bookingDraft.phone, "+639171234567");
        assert.equal(store.getState().bookingDraft.services[0].id, "mattress");
        assert.equal(store.getState().bookingDraft.services[0].price, 500);
        assert.equal(store.getState().bookingDraft.services[0].quantity,2);assert.equal(store.getState().bookingDraft.total,legacyRates.weekday.night.baseRate+1000);
        assert.equal(store.getState().bookingDraft.unitId,"garden");assert.equal(store.getState().bookingDraft.roomName,"Garden Room");
        assert.equal(store.getState().bookingDraft.roomPrice,legacyRates.weekday.night.baseRate);
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

test("booking autofills the complete registration address from profile or auth metadata and carries it into review", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = bookingFetch;
  try {
    for (const useProfile of [true, false]) {
      const address = "Block 2, Main Street, Taytay, Rizal, 1920";
      const pushes = [];
      const store = create(set => ({ bookingDraft: {
        bookingMode: "night", startDatetime: "2027-06-14T18:00:00+08:00", endDatetime: "2027-06-15T06:00:00+08:00",
        firstName: "", lastName: "", email: "", address: "", phone: "", unitId: "pool", adultCount: 2, childCount: 0, services: [],
      }, setBookingDraft: patch => set(state => ({ bookingDraft: { ...state.bookingDraft, ...patch } })) }));
      const profile = { first_name: "Maria", last_name: "Cruz", phone_number: "+639171234567", address };
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: useProfile ? profile : null }) };
      const Component = loadTsModule("app/booking/form/page.tsx", {
        "next/link": ({ href, children, ...props }) => createElement("a", { href, ...props }, children),
        "next/navigation": { useRouter: () => ({ push: path => pushes.push(path) }) },
        "@/components/Navigation": () => null, "@/components/Footer": () => null,
        "@/lib/stores/booking-store": { useBookingStore: store },
        "@/lib/supabase/client": { createClient: () => ({
          auth: { getUser: async () => ({ data: { user: { id: "guest", email: "guest@example.com", user_metadata: { ...profile, address: useProfile ? "Old metadata address" : address } } } }) },
          from: () => query,
        }) },
        "@/lib/booking/use-package-rates": { usePackageRates: () => ({ schedule: { version: 1, rates: legacyRates }, error: null }) },
      }).default;
      const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
      try {
        await act(async () => root.render(createElement(Component)));
        for (const [name, expected] of Object.entries({ streetAddress: "Block 2, Main Street", province: "Rizal", city: "Taytay", zipCode: "1920" })) {
          assert.equal(container.querySelector(`[name="${name}"]`).value, expected);
        }
        const input = (name, value) => act(async () => {
          const field = container.querySelector(`[name="${name}"]`), select = field.tagName === "SELECT";
          Object.getOwnPropertyDescriptor(select ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype, "value").set.call(field, value);
          field.dispatchEvent(new window.Event(select ? "change" : "input", { bubbles: true }));
        });
        const review = [...container.querySelectorAll("button")].find(button => button.textContent.includes("Review Full Details"));
        await input("zipCode", "190");
        await act(async () => review.click());
        assert.deepEqual(pushes, []);
        assert.match(container.querySelector('[role="alert"]').textContent, /exactly 4 digits/);
        await input("city", "Cainta");
        await input("streetAddress", "Unit 7, Main Street");
        await input("zipCode", "1900");
        await act(async () => review.click());
        assert.deepEqual(pushes, ["/booking/details"]);
        assert.equal(store.getState().bookingDraft.address, "Unit 7, Main Street, Cainta, Rizal, 1900");
      } finally { await act(async () => root.unmount()); container.remove(); }
    }
  } finally { globalThis.fetch = originalFetch; }
});
