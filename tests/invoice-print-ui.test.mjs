import assert from "node:assert/strict";
import test, { after } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/transactions" });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const Modal = loadTsModule("components/admin/transactions/InvoiceDetailsModal.tsx", {
  "@/components/content/SiteContent": {
    useSiteContent: () => ({ "resort.name": "MarVille Resort Complex" }),
    contentText: (settings, key) => settings[key] ?? "",
  },
}).default;
const details = {
  invoice: { invoice_id: "INV-123", reservation_id: "r1", total_amount: 2000, created_at: "2026-11-19T16:30:00Z" },
  reservation: { reference_number: "MV-123", status: "confirmed", booking_type: "online", start_datetime: "2026-11-20T02:00:00Z", end_datetime: "2026-11-20T10:00:00Z" },
  transaction: { total_amount: 2200, paid_amount: 400, balance: 1800, status: "partial" },
  nights: 1, unitBreakdown: [{ name: "Pool <script>literal</script>", quantity: 1, pricePerNight: 1800, lineTotal: 1800 }],
  serviceBreakdown: [{ name: "Extra mattress", quantity: 2, priceAtTime: 100, lineTotal: 200 }],
  unitsSubtotal: 1800, servicesSubtotal: 200, computedTotal: 2000,
  verifiedPayments: [{ payment_id: "p1", reference_number: "00012345", amount: 400, status: "verified", paid_at: "2026-11-19T16:30:00Z" }],
  latestReceipt: { payment_id: "p1", receipt_number: "RCPT-123", issued_at: "2026-11-19T16:30:00Z" },
};

test("Print invoice opens printing with a separate branded document and cleans it up on close", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); let prints = 0, closes = 0;
  window.print = () => { prints++; };
  const props = { isOpen: true, isLoading: false, error: null, invoiceDetails: details, onClose: () => { closes++; } };
  try {
    await act(async () => root.render(createElement(Modal, props)));
    const print = [...container.querySelectorAll("button")].find(b => b.textContent === "Print invoice");
    assert.equal(print.disabled, false);
    const documentNode = document.getElementById("billing-invoice-print");
    assert.equal(documentNode.parentElement, document.body);
    assert.equal(container.contains(documentNode), false);
    assert.match(documentNode.textContent, /MarVille Resort Complex/);
    assert.match(documentNode.textContent, /INV-123/); assert.match(documentNode.textContent, /MV-123/);
    assert.match(documentNode.textContent, /Nov 20, 2026/); assert.match(documentNode.textContent, /12:30 AM/);
    assert.match(documentNode.textContent, /Extra mattress/); assert.match(documentNode.textContent, /00012345/);
    assert.match(documentNode.textContent, /RCPT-123/);
    assert.match(documentNode.textContent, /Invoice amount at issue₱2,000\.00/);
    assert.match(documentNode.textContent, /Current billing total₱2,200\.00/);
    assert.match(documentNode.textContent, /Outstanding balance₱1,800\.00/);
    assert.match(documentNode.textContent, /Pool <script>literal<\/script>/);
    assert.equal(documentNode.querySelector("script"), null);
    assert.equal(documentNode.querySelector("button"), null);
    await act(async () => print.click()); assert.equal(prints, 1);
    await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "Close").click());
    assert.equal(closes, 1);
    await act(async () => root.render(createElement(Modal, { ...props, isOpen: false })));
    assert.equal(document.getElementById("billing-invoice-print"), null);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("invoices cannot print while loading, missing, or failed; stale data is excluded from printing", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); let prints = 0; window.print = () => { prints++; };
  try {
    for (const state of [{ isLoading: true, invoiceDetails: details }, { error: "Unable to load", invoiceDetails: details }, { invoiceDetails: null }]) {
      await act(async () => root.render(createElement(Modal, { isOpen: true, isLoading: false, error: null, onClose() {}, ...state })));
      const print = [...container.querySelectorAll("button")].find(b => b.textContent === "Print invoice");
      assert.equal(print.disabled, true);
      assert.equal(document.getElementById("billing-invoice-print"), null);
      await act(async () => print.click());
    }
    assert.equal(prints, 0);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("an invoice with no transaction or payments does not invent a paid balance", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Modal, { isOpen: true, isLoading: false, error: null, onClose() {}, invoiceDetails: { ...details, transaction: null, verifiedPayments: [], latestReceipt: null, unitBreakdown: [], serviceBreakdown: [] } })));
    const printable = document.getElementById("billing-invoice-print");
    assert.match(printable.textContent, /No itemized charges recorded/);
    assert.match(printable.textContent, /No verified payments recorded/);
    assert.doesNotMatch(printable.querySelector('[aria-label="Invoice billing summary"]').textContent, /Outstanding balance|Verified amount paid|Current billing total/);
  } finally { await act(async () => root.unmount()); container.remove(); }
});
