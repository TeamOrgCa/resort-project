import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin" });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const timestamp = "2026-10-16T16:30:00Z";

test("invoice, payment and receipt details show October 17 for the same October 16 UTC instant", () => {
  const original = process.env.TZ;
  const Modal = loadTsModule("components/admin/transactions/InvoiceDetailsModal.tsx").default;
  try {
    for (const zone of ["UTC", "America/Los_Angeles"]) {
      process.env.TZ = zone;
      const markup = renderToStaticMarkup(createElement(Modal, { isOpen: true, onClose: () => {}, invoiceDetails: {
        invoice: { invoice_id: "invoice", total_amount: 1000, created_at: timestamp },
        reservation: { reference_number: "MV-TEST", status: "confirmed", booking_type: "online", start_datetime: timestamp, end_datetime: "2026-10-17T08:00:00Z" },
        transaction: { total_amount: 1000, paid_amount: 1000, balance: 0, status: "paid" },
        latestReceipt: { receipt_number: "RCPT-TEST", issued_at: timestamp, is_active: true },
        verifiedPayments: [{ payment_id: "payment", reference_number: "0012345678901", amount: 1000, status: "verified", paid_at: timestamp }],
        nights: 1, unitBreakdown: [], serviceBreakdown: [], unitsSubtotal: 1000, servicesSubtotal: 0, computedTotal: 1000,
      } }));
      assert.match(markup, /Oct 17, 2026/); assert.match(markup, /12:30 AM/);
      assert.doesNotMatch(markup, /Oct 16, 2026/);
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test("staff account dates and policy publication history use Philippine time on a UTC device", async () => {
  const originalZone = process.env.TZ, originalFetch = globalThis.fetch;
  process.env.TZ = "UTC";
  globalThis.fetch = async url => Response.json(url.includes("booking-policy") ? {
    policy: { version: 2, created_at: timestamp, cancellation_text: "Cancellation policy", refund_text: "Refund policy", guest_cancellation_notice_hours: 48 },
    history: [{ version: 1, created_at: timestamp }],
  } : { success: true, rows: [{ id: "admin", full_name: "Test Admin", email: "admin@example.com", role: "admin", is_active: true, last_login_at: timestamp, created_at: timestamp }] });
  try {
    for (const filename of ["app/admin/(portal)/users/page.tsx", "components/admin/PolicyEditor.tsx"]) {
      const Page = loadTsModule(filename, {
        "@/components/admin/users/GuestAccountsPanel": () => null,
        "@/components/admin/users/RolePermissionsEditor": () => null,
      }).default;
      const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
      try {
        await act(async () => root.render(createElement(Page)));
        assert.match(container.textContent, /Oct 17, 2026/);
        assert.match(container.textContent, /12:30 AM/);
        assert.doesNotMatch(container.textContent, /Oct 16, 2026/);
      } finally { await act(async () => root.unmount()); container.remove(); }
    }
  } finally {
    globalThis.fetch = originalFetch; if (originalZone === undefined) delete process.env.TZ; else process.env.TZ = originalZone;
  }
});
