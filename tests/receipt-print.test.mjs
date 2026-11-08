import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

test("printable receipts render a separate document with branding and historical amounts", () => {
  const originalDocument = globalThis.document;
  const body = {};
  globalThis.document = { body };
  let portalTarget;
  try {
    const { default: Modal } = loadTsModule("components/admin/transactions/KeyValueDetailsModal.tsx", {
      "react-dom": { createPortal: (element, target) => { portalTarget = target; return element; } },
      "@/components/content/SiteContent": {
        useSiteContent: () => ({ "resort.name": "Updated Resort", "resort.address": "Taytay", "resort.email": "guest@example.com" }),
        contentText: (settings, key) => settings[key],
      },
    });
    const markup = renderToStaticMarkup(createElement(Modal, { details: {
      title: "Receipt Details", kind: "receipt", fields: [
        { label: "Receipt No.", value: "RCPT-123" }, { label: "Receipt Status", value: "Archived" },
        { label: "Reservation Status", value: "Cancelled" }, { label: "Payment Status", value: "Verified" },
        { label: "Payment for", value: "Reservation down payment — Day swimming" }, { label: "Payment Method", value: "GCash" },
        { label: "Amount Paid", value: "₱500.00" }, { label: "Transaction Total at Time", value: "₱2,000.00" },
        { label: "Balance After Payment", value: "₱1,500.00" }, { label: "Billed To", value: "<script>literal guest name</script>" },
        { label: "Proof Path", value: "private/path.jpg" },
      ],
    }, onClose: () => {} }));
    assert.equal(portalTarget, body);
    assert.match(markup, /id="billing-receipt-print"/);
    assert.match(markup, /Updated Resort/);
    assert.match(markup, /Payment Receipt/);
    assert.match(markup, /Print receipt/);
    assert.match(markup, /RCPT-123/);
    assert.doesNotMatch(markup, /Receipt Status|Reservation Status|Payment Status|Archived|Cancelled|Proof Path|private\/path/);
    assert.match(markup, /Guest Name/);
    assert.match(markup, /Payment for/); assert.match(markup, /Reservation down payment/); assert.match(markup, /GCash/);
    assert.match(markup, /₱500\.00/);
    assert.match(markup, /₱1,500\.00/);
    assert.match(markup, /&lt;script&gt;literal guest name&lt;\/script&gt;/);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
