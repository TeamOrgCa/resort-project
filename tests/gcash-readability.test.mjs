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

test("centered grouped references retry digits separately when the labelled line remains uncertain", async () => {
  const png = await androidSendMoneyReceiptImage({ centeredFooter: true, date: "Nov 09, 2026 3:09 PM" });
  for (const confident of [true, false]) {
    const original = receiptPage("Ref No. 0047 061 749617");
    const line = original.blocks[0].paragraphs[0].lines[0];
    line.words = [
      { text: "Ref No.", confidence: 95, bbox: { x0: 72, x1: 210, y0: 692, y1: 716 } },
      { text: "0047", confidence: 60, bbox: { x0: 220, x1: 320, y0: 692, y1: 716 } },
      { text: "061", confidence: 60, bbox: { x0: 330, x1: 410, y0: 692, y1: 716 } },
      { text: "749617", confidence: 60, bbox: { x0: 420, x1: 600, y0: 692, y1: 716 } },
    ];
    let calls = 0;
    const result = await retryGcashNumericLines(png, original, { recognize: async bytes => {
      calls++;
      if (calls <= 2) return retryResult({ confidence: 60 });
      const size = await sharp(bytes).metadata();
      const scale = size.width / 396;
      const retry = retryResult({ replacement: "0047 061 749617", confidence: confident ? 95 : 60 });
      retry.data.blocks[0].paragraphs[0].lines[0].words[0].bbox = { x0: 8 * scale, x1: 388 * scale, y0: 8 * scale, y1: 32 * scale };
      return retry;
    } });
    assert.equal(inspectReceiptReadability(result, { gcash: true }).accepted, confident);
    assert.equal(calls, confident ? 3 : 4);
    assert.equal(result.text, original.text, "label, spacing and leading zeroes are retained");
    if (confident) {
      const word = result.blocks[0].paragraphs[0].lines[0].words[0];
      assert.equal(word.bbox.x0, 220);
      assert.equal(word.bbox.y1 - word.bbox.y0, 24);
    }
  }
});
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

test("a clear two-column footer gets a second scale when the first retry leaves uncertain digits", async () => {
  const png = await androidSendMoneyReceiptImage({ date: "Oct 13, 2026 7:14 PM" });
  const sizes = [];
  const result = await retryGcashNumericLines(png, receiptPage(text), { recognize: async bytes => {
    sizes.push((await sharp(bytes).metadata()).width);
    if (sizes.length === 1) return retryResult({ confidence: 73 });
    const retry = retryResult({ confidence: 95, height: 72 });
    retry.data.blocks[0].paragraphs[0].lines[0].words[0].bbox = { x0: 24, x1: 1752, y0: 24, y1: 96 };
    return retry;
  } });
  assert.deepEqual(sizes, [1184, 1776]);
  assert.equal(result.text, text);
  assert.equal(inspectReceiptReadability(result, { gcash: true }).accepted, true);
  const word = result.blocks[0].paragraphs[0].lines[0].words[0];
  assert.equal(word.bbox.x0, 72); assert.equal(word.bbox.y0, 692);
  assert.equal(word.bbox.y1 - word.bbox.y0, 24, "3x coordinates must be scaled back to native pixels");
});

test("a separated reference/date footer retries only the uncertain date column", async () => {
  const png = await androidSendMoneyReceiptImage();
  const original = receiptPage("Ref No. 0046080000001 Nov 7, 2026 7:15 AM");
  const line = original.blocks[0].paragraphs[0].lines[0];
  line.words = [
    { text: "Ref No. 0046080000001", confidence: 95, bbox: { x0: 72, x1: 330, y0: 692, y1: 716 } },
    { text: "Nov", confidence: 95, bbox: { x0: 440, x1: 480, y0: 692, y1: 716 } },
    { text: "7, 2026 7:15 AM", confidence: 28, bbox: { x0: 485, x1: 648, y0: 692, y1: 716 } },
  ];
  let calls = 0;
  const result = await retryGcashNumericLines(png, original, { recognize: async bytes => {
    calls++;
    assert.equal((await sharp(bytes).metadata()).width, 448);
    return retryResult({ replacement: "Nov 7, 2026 7:15 AM" });
  } });
  assert.equal(calls, 1);
  assert.equal(inspectReceiptReadability(result, { gcash: true }).accepted, true);
  assert.match(result.text, /0046080000001/);
  const lines = result.blocks[0].paragraphs[0].lines;
  assert.equal(lines.length, 2);
  assert.equal(lines[0].words[0].confidence, 95);
});

test("the second scale cannot turn tiny native digits into readable transaction evidence", async () => {
  const png = await androidSendMoneyReceiptImage({ date: "Oct 13, 2026 7:14 PM" });
  let calls = 0;
  const result = await retryGcashNumericLines(png, receiptPage(text), { recognize: async () => {
    calls++;
    return calls === 1 ? retryResult({ confidence: 60 }) : retryResult({ confidence: 95, height: 30 });
  } });
  assert.equal(calls, 2, "retries stay bounded");
  assert.equal(inspectReceiptReadability(result, { gcash: true }).accepted, false);
  assert.equal(result.blocks[0].paragraphs[0].lines[0].words[0].confidence, 50);
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
