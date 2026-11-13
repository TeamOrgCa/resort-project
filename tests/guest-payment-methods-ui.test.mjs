import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/booking/payment", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "Node"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const button = (root, label) => [...root.querySelectorAll("button")].find(el => el.textContent.trim() === label);
const click = async el => { assert.ok(el); assert.equal(el.matches(":disabled"), false); await act(async () => el.click()); };
async function value(el, text) {
  assert.ok(el);
  await act(async () => {
    Object.getOwnPropertyDescriptor(el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype, "value").set.call(el, text);
    el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}
async function render(Component) {
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component)));
  return { container, close: async () => { await act(async () => root.unmount()); container.remove(); } };
}
const account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", secondAccount = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
async function mount(paid = 0) {
  const originalFetch = globalThis.fetch, originalUrl = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:proof-preview"; URL.revokeObjectURL = () => {};
  const posts = [], uploads = []; let release;
  globalThis.fetch = async (url, options) => {
    if (options?.method === "POST") {
      posts.push({ url, body: JSON.parse(options.body) });
      return new Promise(resolve => { release = () => resolve(Response.json({ success: true, payment: { status: "pending", amount: posts.at(-1).body.payment.amount }, reservation: { referenceNumber: "MV-TEST" } })); });
    }
    return Response.json({ success: true, catalog: {
      paymentMethods: [
        { payment_method_id: "gcash", name: "GCash", type: "ewallet", is_active: true },
        { payment_method_id: "bank", name: "Bank Transfer", type: "bank", is_active: true },
        { payment_method_id: "cash", name: "Cash", type: "cash", is_active: true },
        { payment_method_id: "cash-alias", name: "Cash", type: "other", is_active: true },
        { payment_method_id: "inactive", name: "Disabled method", type: "bank", is_active: false },
        { payment_method_id: "unconfigured", name: "Unconfigured method", type: "bank", is_active: true },
      ], paymentAccounts: [
        { account_id: "gcash-account", payment_method_id: "gcash", account_name: "GCash Resort", account_number: "09171234567", qr_image: "qr.png", is_active: true },
        { account_id: account, payment_method_id: "bank", account_name: "Resort Bank One", account_number: "000123456789", qr_image: null, is_active: true },
        { account_id: secondAccount, payment_method_id: "bank", account_name: "Resort Bank Two", account_number: "000987654321", qr_image: null, is_active: true },
        { account_id: "cash-account", payment_method_id: "cash", account_name: "Cash counter", account_number: "123456", qr_image: "cash.png", is_active: true },
      ],
    } });
  };
  const state = { bookingDraft: { reservationId: "reservation", reservationReference: "MV-TEST", firstName: "Guest", lastName: "User", total: 5000, paidAmount: paid, services: [], unitId: paid ? "balance-payment" : "pool", bookingMode: "day", roomPrice: 5000, nights: 1, adultCount: 2, childCount: 0, startDatetime: "2027-06-14T08:00:00+08:00", endDatetime: "2027-06-14T16:00:00+08:00" } };
  const Component = loadTsModule("app/booking/payment/page.tsx", {
    "next/link": ({ href, children, ...props }) => createElement("a", { href, ...props }, children), "next/image": () => null,
    "@/components/Navigation": () => null, "@/components/Footer": () => null, "@/components/PaymentQr": () => null, "@/components/booking/BookingGuide": () => null,
    "@/components/legal/PolicyAgreement": ({ accepted, onChange }) => createElement("label", null, "Accept terms", createElement("input", { type: "checkbox", checked: accepted, onChange: event => onChange(event.target.checked) })),
    "@/lib/stores/booking-store": { useBookingStore: selector => selector(state) },
    "@/lib/supabase/client": { createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "guest" } } }) },
      storage: { from: () => ({ upload: async (...args) => { uploads.push(args); return { error: null }; } }) },
      from: () => { const q = { select: () => q, eq: () => q, limit: () => q, maybeSingle: async () => ({ data: null, error: null }) }; return q; },
    }) },
  }).default;
  const h = await render(Component);
  return { ...h, posts, uploads, release: async () => act(async () => release()), close: async () => { await h.close(); globalThis.fetch = originalFetch; URL.createObjectURL = originalUrl; URL.revokeObjectURL = originalRevoke; } };
}
async function file(input) {
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [new window.File(["receipt"], "receipt.png", { type: "image/png" })] });
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

for (const paid of [0, 1000]) test(`guest ${paid ? "balance payment" : "checkout"} supports non-QR bank accounts and submits once for manual review`, async () => {
  const h = await mount(paid);
  try {
    assert.equal([...h.container.querySelectorAll("#payment-method option")].some(el => /^(Cash|Disabled method|Unconfigured method)$/.test(el.textContent)), false);
    await value(h.container.querySelector("#payment-method"), "bank"); assert.match(h.container.textContent, /requires cashier approval/);
    await value(h.container.querySelector('[aria-label="Receiving account"]'), secondAccount);
    assert.match(h.container.textContent, /Resort Bank Two/);
    await value(h.container.querySelector("#gcash-sender-name"), "Guest User");
    await value(h.container.querySelector("#payment-sender-account"), "guest@example.com");
    await value(h.container.querySelector("#gcash-reference-number"), "ab-001234");
    await file(h.container.querySelector('input[type="file"]')); await click(h.container.querySelector('input[type="checkbox"]'));
    assert.equal(button(h.container, "Confirm Payment").matches(":disabled"), false);
    await act(async () => { for (let i = 0; i < 2; i++) h.container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
    assert.equal(h.posts.length, 1); assert.equal(h.uploads.length, 1); assert.equal(button(h.container, "Processing...").matches(":disabled"), true);
    const payload = h.posts[0].body.payment; assert.equal(payload.paymentMethodId, "bank"); assert.equal(payload.receivingAccountId, secondAccount);
    assert.equal(payload.accountNumber, "guest@example.com"); assert.equal(payload.referenceNumber, "ab-001234");
    assert.equal(payload.amount, paid ? 4000 : 1000); assert.equal(payload.type, paid ? "full" : "downpayment");
    await h.release(); assert.match(h.container.textContent, /Payment Submitted!/); assert.match(h.container.textContent, /awaiting cashier review/);
    assert.match(h.container.textContent, /Expected balance after approval/); assert.doesNotMatch(h.container.textContent, /Payment Approved!/);
  } finally { await h.close(); }
});

test("switching methods clears old references and proof and restores strict GCash validation", async () => {
  const h = await mount();
  try {
    await value(h.container.querySelector("#gcash-reference-number"), "invalid-gcash"); assert.ok(h.container.querySelector("#gcash-reference-error"));
    await value(h.container.querySelector("#payment-method"), "bank"); assert.equal(h.container.querySelector("#gcash-reference-error"), null);
    const reference = h.container.querySelector("#gcash-reference-number"); assert.equal(reference.inputMode, "text");
    await value(reference, "BANK-001234"); assert.equal(reference.value, "BANK-001234"); await file(h.container.querySelector('input[type="file"]'));
    await value(h.container.querySelector("#payment-method"), "gcash"); assert.equal(reference.value, ""); assert.equal(reference.inputMode, "numeric");
    assert.equal(h.container.textContent.includes("Selected file: receipt.png"), false);
    await value(reference, "000123456789"); assert.equal(reference.value, "000123456789");
    await value(reference, "BANK123456"); assert.equal(reference.value, "000123456789"); assert.ok(h.container.querySelector("#gcash-reference-error"));
  } finally { await h.close(); }
});

test("cashier review requires loading the proof and acknowledging actual received funds for another method", async () => {
  const Review = loadTsModule("components/admin/transactions/PaymentReviewModal.tsx", { "next/image": props => createElement("img", Object.fromEntries(Object.entries(props).filter(([key]) => key !== "unoptimized"))) }).default;
  const calls = [];
  function Wrapper() {
    const [reviewed, setReviewed] = useState(false), [decision, setDecision] = useState(null);
    return createElement(Review, { payment: { reference_number: "BANK001234", amount: 1000, payment_type: "downpayment", status: "pending", ocr_status: "not_applicable", receipt_paid_at: null, proof_path: "guest/proof.png", payment_methods: { name: "Bank Transfer" }, receiving_account: { account_name: "Resort Bank", account_number: "000123456789" } }, reservationReference: "MV-TEST", proofUrl: "https://example.com/proof.png", canReview: true, decision, screenshotReviewed: reviewed, onScreenshotReviewed: setReviewed, onDecision: setDecision, onConfirm: () => calls.push("approved"), onClose: () => {} });
  }
  const h = await render(Wrapper);
  try {
    assert.match(h.container.textContent, /Bank Transfer/); assert.match(h.container.textContent, /Resort Bank - 000123456789/);
    assert.equal(button(h.container, "Approve").disabled, true);
    await act(async () => h.container.querySelector("img").dispatchEvent(new window.Event("load")));
    assert.equal(button(h.container, "Approve").disabled, true);
    await click(h.container.querySelector('input[type="checkbox"]')); await click(button(h.container, "Approve"));
    await click(button(h.container, "Confirm approval")); assert.deepEqual(calls, ["approved"]);
  } finally { await h.close(); }
});
