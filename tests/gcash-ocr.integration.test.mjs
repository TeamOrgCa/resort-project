import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { androidSendMoneyReceiptImage, sendMoneyReceiptImage } from "./helpers/gcash-receipt-image.mjs";

test("bundled OCR reads amount, labelled reference and Philippine timestamp from a complete receipt image", async () => {
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "2-digit", year: "numeric" }).format(new Date());
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date());
  const lines = ["GCash", "Payment sent successfully", "Amount Sent", "PHP 1,500.00", "Reference No. 1234567890123", "Sent to MarVille Resort", "09171231234", `${date} ${time}`];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1000"><rect width="100%" height="100%" fill="white"/>${lines.map((line, i) => `<text x="70" y="${100 + i * 100}" font-family="Arial" font-size="42" fill="black">${line}</text>`).join("")}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const { inspectPaymentProof } = loadTsModule("lib/server/gcash-ocr.ts");
  const storage = { storage: { from: () => ({ download: async () => ({ data: new Blob([png], { type: "image/png" }), error: null }) }) } };
  const result = await inspectPaymentProof(storage, { userId: "guest", proofPath: "guest/receipt.png", methodName: "GCash", methodType: "ewallet", amount: 1500, minimumAmount: 1000,
    reference: "1234567890123", recipientName: "MarVille Resort", recipientNumber: "09171231234" });
  assert.equal(result.status, "consistent", result.notes);
  assert.equal(result.amount, 1500); assert.equal(result.reference, "1234567890123"); assert.ok(result.paidAt);
});

test("OCR handles Send Money graphic success, masked recipient and two-column reference/date footer", async () => {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true }).format(now);
  const { inspectPaymentProof } = loadTsModule("lib/server/gcash-ocr.ts");
  for (const phone of ["+63 9** *** 5095", "+63 9•• ••• 5095"]) {
    const png = await sendMoneyReceiptImage({ date: `${date} ${time}`, phone });
    const storage = { storage: { from: () => ({ download: async () => ({ data: new Blob([png], { type: "image/png" }), error: null }) }) } };
    const result = await inspectPaymentProof(storage, { userId: "guest", proofPath: "guest/receipt.png", methodName: "GCash", methodType: "ewallet", amount: 100, minimumAmount: 100, reference: "6046080000001", recipientNumber: "09171235095" });
    assert.equal(result.status, "consistent", `${phone}: ${result.notes}`); assert.equal(result.amount, 100); assert.equal(result.reference, "6046080000001"); assert.ok(result.paidAt);
  }
});

test("the masked-phone OCR retry cannot replace a wrong visible recipient suffix", async () => {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true }).format(now);
  const png = await sendMoneyReceiptImage({ phone: "+63 9•• ••• 5094", date: `${date} ${time}` });
  const { inspectPaymentProof } = loadTsModule("lib/server/gcash-ocr.ts");
  const storage = { storage: { from: () => ({ download: async () => ({ data: new Blob([png]), error: null }) }) } };
  const result = await inspectPaymentProof(storage, { userId: "guest", proofPath: "guest/receipt.png", methodName: "GCash", methodType: "ewallet", amount: 100, minimumAmount: 100, reference: "6046080000001", recipientNumber: "09171235095" });
  assert.equal(result.status, "unreadable"); assert.match(result.notes, /recipient could not be matched/);
});

test("OCR reads the Android layout with a full recipient phone and a spaced reference with leading zeroes", async () => {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true }).format(now);
  const png = await androidSendMoneyReceiptImage({ date: `${date} ${time}` });
  const { inspectPaymentProof } = loadTsModule("lib/server/gcash-ocr.ts");
  const storage = { storage: { from: () => ({ download: async () => ({ data: new Blob([png], { type: "image/png" }), error: null }) }) } };
  const result = await inspectPaymentProof(storage, { userId: "guest", proofPath: "guest/android-receipt.png", methodName: "GCash", methodType: "ewallet", amount: 200, minimumAmount: 100, reference: "0046 080 000001", recipientNumber: "09171235095" });
  assert.equal(result.status, "consistent", result.notes);
  assert.equal(result.amount, 200); assert.equal(result.reference, "0046080000001"); assert.ok(result.paidAt);
});

test("Android JPEG reads a thin success check and tightly packed masked recipient digits", async () => {
  const receipt = await androidSendMoneyReceiptImage({ amount: "100.00", phone: "+63 9•••••5095", date: "Oct 23, 2026 1:06 PM" });
  const jpeg = await sharp(receipt).resize({ width: 904 }).jpeg({ quality: 85 }).toBuffer();
  const assessment = loadTsModule("lib/booking/gcash-receipt.ts");
  const { inspectPaymentProof } = loadTsModule("lib/server/gcash-ocr.ts", {
    "@/lib/booking/gcash-receipt": { ...assessment, assessGcashText: (text, input) => assessment.assessGcashText(text, { ...input, now: Date.parse("2026-10-23T06:00:00Z") }) },
  });
  const storage = { storage: { from: () => ({ download: async () => ({ data: new Blob([jpeg], { type: "image/jpeg" }), error: null }) }) } };
  const input = { userId: "guest", proofPath: "guest/android-receipt.jpg", methodName: "GCash", methodType: "ewallet", amount: 100, minimumAmount: 100, reference: "0046080000001", recipientNumber: "09171235095" };
  const result = await inspectPaymentProof(storage, input);
  assert.equal(result.status, "consistent", result.notes);
  assert.equal(result.amount, 100); assert.equal(result.reference, "0046080000001"); assert.equal(result.paidAt, "2026-10-23T05:06:00.000Z");
  const wrongRecipient = await inspectPaymentProof(storage, { ...input, recipientNumber: "09171235094" });
  assert.equal(wrongRecipient.status, "unreadable"); assert.match(wrongRecipient.notes, /recipient could not be matched/);
});

test("Android JPEG ignores simulated low-confidence carbon OCR and retries uncertain reference digits", async () => {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true }).format(now);
  const png = await androidSendMoneyReceiptImage({ amount: "100.00", date: `${date} ${time}` });
  const jpeg = await sharp(png).resize({ width: 864 }).jpeg({ quality: 85 }).toBuffer();
  const tesseract = await import("tesseract.js");
  let alteredBadge = false, retriedFooter = false;
  const { inspectPaymentProof } = loadTsModule("lib/server/gcash-ocr.ts", { "tesseract.js": { ...tesseract, createWorker: async (...args) => {
    const worker = await tesseract.createWorker(...args);
    const recognize = worker.recognize.bind(worker);
    worker.recognize = async (...inputs) => {
      const result = await recognize(...inputs);
      if (Buffer.from(inputs[0]).equals(jpeg)) {
        const paragraph = result.data.blocks[0].paragraphs[0];
        // Simulate OCR detecting the small badge, which page segmentation may omit.
        paragraph.lines.push({ text: "279g (gCO2e)\n", bbox: { x0: 132, x1: 450, y0: 1480, y1: 1488 }, baseline: { x0: 132, x1: 450, y0: 1488, y1: 1488 },
          words: [{ text: "279g", confidence: 35, bbox: { x0: 132, x1: 200, y0: 1480, y1: 1488 } }] });
        result.data.text += "279g (gCO2e)\n"; alteredBadge = true;
        for (const block of result.data.blocks) for (const paragraph of block.paragraphs) for (const line of paragraph.lines) {
          if (/^Ref No\./.test(line.text)) for (const word of line.words) if (/^0046$/.test(word.text)) word.confidence = 55;
        }
      } else {
        retriedFooter = true;
      }
      return result;
    };
    return worker;
  } } });
  const storage = { storage: { from: () => ({ download: async () => ({ data: new Blob([jpeg], { type: "image/jpeg" }), error: null }) }) } };
  const input = { userId: "guest", proofPath: "guest/android-receipt.jpg", methodName: "GCash", methodType: "ewallet", amount: 100, minimumAmount: 100, reference: "0046080000001", recipientNumber: "09171235095" };
  const result = await inspectPaymentProof(storage, input);
  assert.equal(result.status, "consistent", result.notes); assert.equal(alteredBadge, true); assert.equal(retriedFooter, true);
  assert.equal(result.amount, 100); assert.equal(result.reference, "0046080000001");
  const wrongReference = await inspectPaymentProof(storage, { ...input, reference: "0046080000002" });
  assert.equal(wrongReference.status, "mismatch"); assert.match(wrongReference.notes, /reference number differs/);
});
