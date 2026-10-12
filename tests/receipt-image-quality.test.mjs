import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const { inspectReceiptImage, inspectReceiptReadability, hasCameraExif } = loadTsModule("lib/server/receipt-image-quality.ts");
const sample = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1000"><rect width="100%" height="100%" fill="white"/><rect width="100%" height="180" fill="#007cff"/><text x="50" y="100" font-size="50" fill="white">GCash</text><text x="50" y="300" font-size="38">Amount Sent PHP 1,500.00</text><text x="50" y="420" font-size="32">Reference No. 1234567890123</text></svg>`);

test("clear PNG, JPEG and WebP screenshots pass image checks", async () => {
  for (const format of ["png", "jpeg", "webp"]) {
    const image = await sharp(sample).toFormat(format).toBuffer();
    assert.deepEqual(await inspectReceiptImage(image), { accepted: true }, format);
  }
});

test("ordinary screenshot software/orientation metadata does not imply camera capture", async () => {
  const image = await sharp(sample).jpeg().withExif({ IFD0: { Software: "Screenshot tool", Orientation: "1" } }).toBuffer();
  assert.equal(hasCameraExif((await sharp(image).metadata()).exif), false);
  assert.deepEqual(await inspectReceiptImage(image), { accepted: true });
});

test("camera metadata rejects a receipt photo even when its pixels are perfectly readable", async () => {
  const image = await sharp(sample).jpeg().withExif({ IFD0: { Make: "Apple", Model: "iPhone" } }).toBuffer();
  assert.equal(hasCameraExif((await sharp(image).metadata()).exif), true);
  const result = await inspectReceiptImage(image);
  assert.equal(result.accepted, false);
  assert.match(result.reason, /camera-capture/);
});

test("metadata-free photo-like texture is rejected", async () => {
  const pixels = Buffer.alloc(720 * 1000 * 3);
  // Reproducible sensor/moire-like texture, without EXIF or a format shortcut.
  let state = 42;
  for (let i = 0; i < pixels.length; i++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; pixels[i] = 210 + state % 46; }
  const image = await sharp(pixels, { raw: { width: 720, height: 1000, channels: 3 } }).png().toBuffer();
  const result = await inspectReceiptImage(image);
  assert.equal(result.accepted, false);
  assert.match(result.reason, /photo-like texture/);
});

test("small, damaged and disguised unsupported images fail closed", async () => {
  const small = await sharp(sample).resize(240, 333).png().toBuffer();
  const gif = await sharp(sample).gif().toBuffer();
  for (const image of [small, gif, Buffer.from("not an image")]) assert.equal((await inspectReceiptImage(image)).accepted, false);
});

test("truncated or malicious EXIF pointers do not throw", () => {
  for (const bytes of [Buffer.from("Exif\0\0II"), Buffer.from([73, 73, 42, 0, 255, 255, 255, 255]), Buffer.alloc(100)]) {
    assert.equal(hasCameraExif(bytes), false);
  }
});

function page({ confidence = 95, numberConfidence = 96, height = 25, tilt = 0, numbers = true } = {}) {
  return { confidence, blocks: [{ paragraphs: [{ lines: [0, 1].map(i => ({
    baseline: { x0: 50, x1: 550, y0: 200 + i * 80, y1: 200 + i * 80 + tilt },
    words: [{ text: numbers ? i ? "1234567890123" : "1,500.00" : "Amount", confidence: numberConfidence, bbox: { x0: 50, x1: 250, y0: 200 + i * 80, y1: 200 + i * 80 + height } }],
  })) }] }] };
}

test("readable horizontal receipt text and digits pass OCR quality checks", () => {
  assert.deepEqual(inspectReceiptReadability(page()), { accepted: true });
});

test("unclear or tiny numeric fields and missing OCR geometry are rejected", () => {
  for (const result of [page({ confidence: 50 }), page({ numberConfidence: 60 }), page({ height: 8 }), page({ numbers: false }), { confidence: 95, blocks: null }]) {
    assert.equal(inspectReceiptReadability(result).accepted, false);
  }
});

test("multiple slanted receipt lines are rejected as a photographed screen", () => {
  const result = inspectReceiptReadability(page({ tilt: 30 }));
  assert.equal(result.accepted, false);
  assert.match(result.reason, /tilted/);
});

test("camera receipts are rejected before starting the OCR worker", async () => {
  const image = await sharp(sample).jpeg().withExif({ IFD0: { Make: "Samsung", Model: "Phone camera" } }).toBuffer();
  let workers = 0;
  const { inspectPaymentProof } = loadTsModule("lib/server/gcash-ocr.ts", { "tesseract.js": { createWorker: async () => { workers++; throw new Error("Must not run OCR"); } } });
  const storage = { storage: { from: () => ({ download: async () => ({ data: new Blob([image]), error: null }) }) } };
  const result = await inspectPaymentProof(storage, { userId: "guest", proofPath: "guest/receipt.jpg", methodName: "GCash", methodType: "ewallet", amount: 1500, minimumAmount: 1000, reference: "1234567890123" });
  assert.equal(result.status, "rejected");
  assert.match(result.notes, /camera-capture/);
  assert.equal(workers, 0);
});
