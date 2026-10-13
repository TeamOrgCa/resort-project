import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { androidSendMoneyReceiptImage } from "./helpers/gcash-receipt-image.mjs";

const { retryGcashNumericLines } = loadTsModule("lib/server/gcash-readability.ts");
const { inspectReceiptReadability } = loadTsModule("lib/server/receipt-image-quality.ts");
function receiptPage(text, confidence = 50, height = 24) {
  return { text, confidence: 92, blocks: [{ paragraphs: [{ lines: [{ text,
    bbox: { x0: 72, x1: 648, y0: 692, y1: 692 + height }, baseline: { x0: 72, x1: 648, y0: 692 + height, y1: 692 + height },
    words: [{ text, confidence, bbox: { x0: 72, x1: 648, y0: 692, y1: 692 + height } }],
  }] }] }] };
}
const text = "Ref No. 0046 080 000001 Oct 13, 2026 7:14 PM";
function retryResult({ confidence = 95, height = 48, replacement = text } = {}) {
  const result = receiptPage(replacement, confidence, height);
  result.blocks[0].paragraphs[0].lines[0].words[0].bbox = { x0: 16, x1: 1168, y0: 16, y1: 16 + height };
  return { data: result };
}

test("uncertain transaction lines are retried from cropped pixels and coordinates remain native", async () => {
  const png = await androidSendMoneyReceiptImage({ date: "Oct 13, 2026 7:14 PM" });
  let calls = 0;
  const result = await retryGcashNumericLines(png, receiptPage(text), { recognize: async bytes => {
    calls++; const size = await sharp(bytes).metadata(); assert.equal(size.width, 1184); assert.equal(size.height, 80);
    return retryResult();
  } });
  assert.equal(calls, 1); assert.equal(result.text, text);
  assert.equal(inspectReceiptReadability(result, { gcash: true }).accepted, true);
  const word = result.blocks[0].paragraphs[0].lines[0].words[0];
  assert.equal(word.bbox.y1 - word.bbox.y0, 24);
  assert.equal(word.bbox.x0, 72); assert.equal(word.bbox.y0, 692);
});

test("low-confidence or too-small retry numbers never replace the original uncertain field", async () => {
  const png = await androidSendMoneyReceiptImage({ date: "Oct 13, 2026 7:14 PM" });
  for (const options of [{ confidence: 60 }, { height: 20 }]) {
    const result = await retryGcashNumericLines(png, receiptPage(text), { recognize: async () => retryResult(options) });
    assert.equal(inspectReceiptReadability(result, { gcash: true }).accepted, false);
    assert.equal(result.blocks[0].paragraphs[0].lines[0].words[0].confidence, 50);
  }
  let calls = 0;
  const result = await retryGcashNumericLines(png, receiptPage(text, 50, 8), { recognize: async () => { calls++; return retryResult(); } });
  assert.equal(calls, 0); assert.equal(inspectReceiptReadability(result, { gcash: true }).accepted, false);
});

test("decorative numbers do not cause focused retries and OCR supplies every replacement digit", async () => {
  const png = await androidSendMoneyReceiptImage({ date: "Oct 13, 2026 7:14 PM" });
  let calls = 0;
  await retryGcashNumericLines(png, receiptPage("279g (gCO2e)"), { recognize: async () => { calls++; return retryResult(); } });
  assert.equal(calls, 0);
  const changed = text.replace("000001", "000002");
  const result = await retryGcashNumericLines(png, receiptPage(text), { recognize: async () => retryResult({ replacement: changed }) });
  assert.equal(result.text, changed); // Subsequent exact reference matching must reject this.
});

test("actual OCR rereads a spaced Android footer without losing reference zeroes", async () => {
  const { createWorker, PSM } = await import("tesseract.js");
  const { join } = await import("node:path");
  const png = await androidSendMoneyReceiptImage({ date: "Oct 13, 2026 7:14 PM" });
  const worker = await createWorker("eng", 1, { workerPath: join(process.cwd(), "node_modules/tesseract.js/src/worker-script/node/index.js"), langPath: join(process.cwd(), "assets/ocr"), gzip: false, cacheMethod: "none" });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    const result = await retryGcashNumericLines(png, receiptPage(text), worker);
    assert.equal(inspectReceiptReadability(result, { gcash: true }).accepted, true);
    assert.match(result.text, /0046\s*080\s*000001/);
    assert.match(result.text, /Oct\s*13/);
  } finally { await worker.terminate(); }
});
