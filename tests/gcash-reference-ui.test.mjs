import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/booking/payment" });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

test("GCash reference entry blocks letters, keeps leading zeroes and normalizes pasted separators", async () => {
  const originalFetch = globalThis.fetch, posts = [];
  globalThis.fetch = async (url, options) => {
    if (options?.method === "POST") posts.push(url);
    return Response.json({ success: true, catalog: {
      paymentMethods: [{ payment_method_id: "gcash", name: "GCash", type: "ewallet", is_active: true }],
      paymentAccounts: [{ account_id: "account", payment_method_id: "gcash", account_name: "Resort", qr_image: "qr.png" }],
    } });
  };
  const state = { bookingDraft: { reservationId: "reservation", reservationReference: "MV-TEST", total: 5000, services: [], unitId: "pool", bookingMode: "day" } };
  const Component = loadTsModule("app/booking/payment/page.tsx", {
    "next/link": ({ href, children, ...props }) => createElement("a", { href, ...props }, children),
    "next/image": () => null,
    "@/components/Navigation": () => null, "@/components/Footer": () => null,
    "@/components/PaymentQr": () => null, "@/components/legal/PolicyAgreement": () => null,
    "@/lib/stores/booking-store": { useBookingStore: selector => selector(state) },
    "@/lib/supabase/client": { createClient: () => ({ from() {
      const q = { select: () => q, eq: () => q, limit: () => q, maybeSingle: async () => ({ data: null, error: null }) }; return q;
    } }) },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Component)));
    const sender = container.querySelector("#gcash-sender-name"); assert.ok(sender);
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(sender, "José 123 O’Neil 😀 Jr.");
      sender.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    assert.equal(sender.value, "José  O’Neil  Jr.");
    const field = container.querySelector("#gcash-reference-number"); assert.ok(field);
    assert.equal(field.labels[0].textContent, "Reference Number *");
    assert.equal(field.inputMode, "numeric");
    const input = async value => act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(field, value);
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await input("0012-3456 78901");
    assert.equal(field.value, "0012345678901"); assert.equal(field.checkValidity(), true);
    for (const value of ["0012345678901A", "ABC1234567890123", "1e12345678", "123456789012345678901"]) {
      await input(value);
      assert.equal(field.value, "0012345678901", "invalid input must not change the reference");
      assert.equal(field.getAttribute("aria-invalid"), "true");
      assert.match(container.querySelector("#gcash-reference-error").textContent, /digits/);
      await act(async () => container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
      assert.equal(posts.length, 0);
    }
    await input("1234567"); assert.equal(field.checkValidity(), false);
    await input("00000000123456789012");
    assert.equal(field.value, "00000000123456789012"); assert.equal(field.checkValidity(), true);
    assert.equal(field.hasAttribute("aria-invalid"), false); assert.equal(container.querySelector("#gcash-reference-error"), null);
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(sender, "123😀");
      sender.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    assert.equal(sender.value, "");
    await act(async () => container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    assert.match(container.textContent, /Enter a sender name/);
    assert.equal(posts.length, 0);
  } finally {
    await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch;
  }
});
