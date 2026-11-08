import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

test("OCR is enabled by default; disabling it retains upload validation and never claims a verified result", async () => {
  const ocr = loadTsModule("lib/server/gcash-ocr.ts");
  assert.equal(ocr.ENABLE_RECEIPT_OCR, true);
  assert.equal(ocr.ENABLE_BETA_RECEIPT_REUSE, true);
  // The test loader's CommonJS export lets this exercise the same branch as editing the code toggle.
  ocr.ENABLE_RECEIPT_OCR = false;
  const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: "white" } }).png().toBuffer();
  let bytes = png;
  const client = { storage: { from: () => ({ download: async () => ({ data: new Blob([bytes]), error: null }) }) } };
  const input = { userId: "guest", proofPath: "guest/proof.png", methodName: "GCash", methodType: "ewallet", amount: 1000, minimumAmount: 200, reference: "1234567890123" };
  const result = await ocr.inspectPaymentProof(client, input);
  assert.equal(result.status, "skipped"); assert.equal(result.amount, 1000); assert.equal(result.reference, input.reference);
  assert.equal(result.paidAt, undefined); assert.match(result.notes, /Staff must verify/);
  assert.equal(await ocr.inspectPaymentProof(client, { ...input, proofPath: "another/proof.png" }), null);
  assert.equal(await ocr.inspectPaymentProof(client, { ...input, proofPath: "guest/proof.pdf" }), null);
  bytes = Buffer.from("not an image"); assert.equal(await ocr.inspectPaymentProof(client, input), null);
});

test("beta reuse keeps real OCR active and retains the extracted old date and original reference", async () => {
  const ocr = loadTsModule("lib/server/gcash-ocr.ts");
  ocr.ENABLE_BETA_RECEIPT_REUSE = true;
  const lines = ["GCash", "Payment sent successfully", "Amount Sent", "PHP 1,500.00", "Reference No. 1234567890123", "Sent to MarVille Resort", "09171231234", "Oct 13, 2020 09:15 AM"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1000"><rect width="100%" height="100%" fill="white"/>${lines.map((line, i) => `<text x="70" y="${100 + i * 100}" font-family="Arial" font-size="42" fill="black">${line}</text>`).join("")}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const client = { storage: { from: () => ({ download: async () => ({ data: new Blob([png]), error: null }) }) } };
  const result = await ocr.inspectPaymentProof(client, { userId: "guest", proofPath: "guest/proof.png", methodName: "GCash", methodType: "ewallet", amount: 1500, minimumAmount: 1000, reference: "9999999999999", recipientName: "MarVille Resort", recipientNumber: "09171231234" });
  assert.equal(result.status, "consistent", result.notes); assert.equal(result.betaTest, true);
  assert.equal(result.reference, "1234567890123"); assert.equal(result.paidAt, "2020-10-13T01:15:00.000Z");
  assert.match(result.notes, /BETA TEST/);
});
