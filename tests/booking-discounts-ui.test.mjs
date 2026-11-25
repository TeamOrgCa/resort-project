import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/manage", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const button = (c, label) => [...c.querySelectorAll("button")].find(el => el.textContent.trim() === label);
async function change(el, value) {
  assert.ok(el);
  await act(async () => {
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value));
    el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}
async function click(el) { assert.ok(el); assert.equal(el.disabled, false); await act(async () => el.click()); }
async function mount(file, props, fetcher) {
  const previous = globalThis.fetch; globalThis.fetch = fetcher;
  const c = document.createElement("div"); document.body.append(c); const root = createRoot(c);
  const Component = loadTsModule(file, { "@/lib/supabase/client": { createClient: () => ({}) } }).default;
  await act(async () => root.render(createElement(Component, props)));
  return { c, close: async () => { await act(async () => root.unmount()); c.remove(); globalThis.fetch = previous; } };
}

test("customer promo input shows remaining availability and server exhaustion messages", async () => {
  const promo = { code: "LIMIT5", discount_type: "percent", discount_value: 10, remainingUses: 3 };
  const h = await mount("components/booking/PromoCodeInput.tsx", { promo, onChange: () => {} }, async () => Response.json({ message: "This promo code has reached its maximum number of successful reservations." }, { status: 409 }));
  try {
    assert.match(h.c.textContent, /3 uses currently available/);
    assert.match(h.c.textContent, /a use is counted on confirmation/);
    await click(button(h.c, "Apply code"));
    assert.match(h.c.querySelector('[role="alert"]').textContent, /maximum number of successful reservations/);
  } finally { await h.close(); }
});

test("staff verify an eligible count, compare promo savings, and save only the greater discount", async () => {
  const posts = [], saved = [];
  const h = await mount("components/admin/BookingDiscountPanel.tsx", { reservationId: "booking", onChanged: result => saved.push(result) }, async (url, options) => {
    if (url === "/api/promos/quote") return Response.json({ promo: { code: "SUMMER", discount_type: "fixed", discount_value: 1500 } });
    if (options?.method === "POST") { posts.push(JSON.parse(options.body)); return Response.json({ totalAmount: 9500, remainingBalance: 7500, message: "Discount and bill updated." }); }
    return Response.json({ headCount: 20, packagePrice: 10000, bill: { total_amount: 11000, paid_amount: 2000 }, locked: false });
  });
  try {
    const eligible = h.c.querySelector('[aria-label="Eligible PWD / senior guests"]'); assert.equal(eligible.max, "20");
    await change(eligible, 5); assert.match(h.c.textContent, /500\.00/);
    await change(h.c.querySelector('[aria-label="Promo code"]'), "SUMMER"); await click(button(h.c, "Apply code"));
    assert.match(h.c.textContent, /9,500\.00/); assert.doesNotMatch(h.c.textContent, /9,000\.00/);
    await change(h.c.querySelector('[aria-label="Discount verification reason"]'), "Verified five senior IDs");
    await click(button(h.c, "Update discount and bill"));
    assert.deepEqual(posts[0], { reservationId: "booking", eligibleGuests: 5, promoCode: "SUMMER", expectedTotal: 11000, reason: "Verified five senior IDs" });
    assert.equal(saved[0].totalAmount, 9500);
  } finally { await h.close(); }
});

test('transaction discount panel previews public swimming discounts against admission and excludes services', async () => {
  const h = await mount('components/admin/BookingDiscountPanel.tsx', { reservationId: 'public-booking' }, async () =>
    Response.json({ headCount: 3, packagePrice: 420, packagePriceLabel: 'Public swimming admission', bill: { total_amount: 620, paid_amount: 0 }, locked: false }));
  try {
    assert.match(h.c.textContent, /Public swimming admission.*420\.00/);
    await change(h.c.querySelector('[aria-label="Eligible PWD / senior guests"]'), 1);
    assert.match(h.c.textContent, /PWD \/ senior discount₱28\.00/);
    assert.match(h.c.textContent, /New total₱592\.00/);
  } finally { await h.close(); }
});

test("cashier bill adjustment refreshes the collectible balance before recording payment", async () => {
  let changed = false, refreshes = 0;
  const h = await mount("components/admin/transactions/RecordPaymentDialog.tsx", {
    initialReservationId: "booking", bills: [{ reservation_id: "booking", balance: 11000, reservation_status: "confirmed" }], references: {}, methods: [], onClose: () => {}, onSaved: () => {}, onBillUpdated: () => refreshes++,
  }, async (_url, options) => {
    if (options?.method === "POST") { changed = true; return Response.json({ totalAmount: 10500, remainingBalance: 10500, message: "Discount saved" }); }
    return Response.json({ headCount: 20, packagePrice: 10000, bill: { total_amount: changed ? 10500 : 11000, paid_amount: 0, discount_amount: changed ? 500 : 0, discount_eligible_guests: changed ? 5 : 0 }, locked: false });
  });
  try {
    await change(h.c.querySelector('[aria-label="Eligible PWD / senior guests"]'), 5);
    await change(h.c.querySelector('[aria-label="Discount verification reason"]'), "Verified eligibility");
    await click(button(h.c, "Update discount and bill"));
    const amount = [...h.c.querySelectorAll("label")].find(el => el.textContent.startsWith("Amount applied")).querySelector("input");
    assert.equal(amount.value, "10500.00"); assert.equal(amount.max, "10500"); assert.equal(refreshes, 1);
  } finally { await h.close(); }
});

test("guests can answer a refund destination request from the Refunds tab", async () => {
  const replies = []; let submitted = false;
  const refund = { refund_id: "refund", reservation_id: "booking", reference_number: "MV-TEST", amount: 500, status: "approved", request_kind: "cancellation", requested_at: new Date().toISOString(), destination_requested_at: new Date().toISOString() };
  const h = await mount("components/GuestRefundStatus.tsx", { standalone: true }, async (_url, options) => {
    if (options?.method === "PATCH") { replies.push(JSON.parse(options.body)); submitted = true; return Response.json({ success: true }); }
    return Response.json({ refunds: [{ ...refund, destination_submitted_at: submitted ? new Date().toISOString() : null }], eligible: [], paymentMethods: [{ name: "GCash" }] });
  });
  try {
    assert.match(h.c.textContent, /Your refund payment details are needed/);
    await change(h.c.querySelector("select"), "GCash");
    const inputs = h.c.querySelectorAll("input"); await change(inputs[0], "Guest Name"); await change(inputs[1], "09171234567");
    await act(async () => h.c.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    assert.deepEqual(replies[0], { refundId: "refund", method: "GCash", accountName: "Guest Name", accountNumber: "09171234567" });
    assert.match(h.c.textContent, /Refund payment details sent/);
  } finally { await h.close(); }
});

test("refund staff can notify an account holder when verified payout details are missing", async () => {
  const posts = []; let requested = false;
  const h = await mount("components/admin/transactions/RefundRequestsPanel.tsx", {}, async (url, options) => {
    if (options?.method === "POST") { posts.push({ url, body: JSON.parse(options.body) }); requested = true; return Response.json({ message: "Guest notified" }); }
    return Response.json({ refunds: [{ refund_id: "refund", reservation_id: "booking", guest_id: "guest", amount: 500, status: "approved", workflow_version: 2, requested_at: new Date().toISOString(), destination_requested_at: requested ? new Date().toISOString() : null }], reservations: [], payments: [], bills: [], paymentMethods: [], permissions: { canPay: true } });
  });
  try {
    await click(button(h.c, "View / process"));
    await click(button(h.c, "Notify guest to provide refund payment details"));
    assert.deepEqual(posts, [{ url: "/api/admin/refunds/destination", body: { refundId: "refund" } }]);
    assert.match(h.c.textContent, /Awaiting the guest's reply/);
    assert.equal(button(h.c, "Send payment details reminder").disabled, true);
  } finally { await h.close(); }
});
