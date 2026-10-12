import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

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
