import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const { receiptDiscountFields } = loadTsModule("lib/booking/billing-discount.ts");

test("receipt payment summaries and print copies include saved promo or PWD savings", () => {
  const originalDocument = globalThis.document; globalThis.document = { body: {} };
  try {
    const Modal = loadTsModule("components/admin/transactions/KeyValueDetailsModal.tsx", {
      "react-dom": { createPortal: element => element },
      "@/components/content/SiteContent": { useSiteContent: () => ({}), contentText: () => "" },
    }).default;
    const snapshot = {amount:1000,kind:"promo",promoCode:"SAVE10",promoType:"percent",promoValue:10,eligibleGuests:2,headCount:10,packagePrice:10000};
    for (const discount of [snapshot, {...snapshot,amount:400,kind:"pwd_senior"}]) {
      const fields = [...receiptDiscountFields(discount,9000),{label:"Booking Total at Payment",value:"PHP 9,000.00"}];
      const markup=renderToStaticMarkup(createElement(Modal,{details:{title:"Receipt",kind:"receipt",fields},onClose(){}}));
      assert.match(markup,/Total before discount/); assert.match(markup,/Discount amount/);
      assert.match(markup,/Booking Total at Payment/); assert.match(markup,/9,000\.00/);
      if(discount.kind==="promo") {assert.match(markup,/SAVE10/);assert.match(markup,/10,000\.00/);assert.match(markup,/-₱1,000\.00/);}
      else {assert.match(markup,/2 of 10 guests eligible/);assert.doesNotMatch(markup,/SAVE10/);}
    }
    assert.deepEqual(receiptDiscountFields(null,9000),[]);
    assert.deepEqual(receiptDiscountFields({...snapshot,amount:0,kind:"none"},9000),[]);
  } finally { if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument; }
});

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
    assert.match(markup, /class="receipt-document receipt-branded"/);
    assert.match(markup, /aria-label="Receipt details"/);
    assert.match(markup, /aria-label="Payment summary"/);
    assert.match(markup, /receipt-balance-row/);
    assert.match(markup, /Where the Sun Never Sets/);
    assert.match(markup, /at the time of payment/);
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

test("public access receipts use the same branded document with collection details", () => {
  const oldDocument = globalThis.document; globalThis.document = { body: {} };
  try {
    const Modal = loadTsModule("components/admin/transactions/KeyValueDetailsModal.tsx", {
      "react-dom": { createPortal: element => element },
      "@/components/content/SiteContent": { useSiteContent: () => ({}), contentText: (_content, key) => key === "resort.name" ? "MarVille Resort Complex" : "" },
    }).default;
    const markup = renderToStaticMarkup(createElement(Modal, { details: { title: "Public Access Receipt", kind: "receipt", fields: [
      { label: "Guest Name", value: "Ana Santos" }, { label: "Collection Ref", value: "PA-123" },
      { label: "Access Type", value: "Public swimming" }, { label: "Payment for", value: "Two adult admissions" },
      { label: "Collection Total", value: "PHP 400.00" }, { label: "Balance After Payment", value: "PHP 0.00" },
    ] }, onClose() {} }));
    assert.match(markup, /PA-123/); assert.match(markup, /Public swimming/); assert.match(markup, /Two adult admissions/);
    assert.match(markup, /Payment summary/); assert.match(markup, /PHP 400\.00/); assert.match(markup, /PHP 0\.00/);
    assert.doesNotMatch(markup, /Settle payment/);
  } finally { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; }
});
