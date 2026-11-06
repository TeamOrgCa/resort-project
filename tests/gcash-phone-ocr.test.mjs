import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { sendMoneyReceiptImage } from "./helpers/gcash-receipt-image.mjs";

const { maskedGcashPhoneCrop, retryMaskedGcashPhone } = loadTsModule("lib/server/gcash-phone-ocr.ts");
const phoneLine = { text: "+63 Qee eee 5095\n", bbox: { x0: 270, y0: 242, x1: 580, y1: 291 } };
const page = (lines = [phoneLine, { text: "Amount", bbox: { y0: 480 } }]) => ({ text: "Sent via GCash\nAmount 100.00", blocks: [{ paragraphs: [{ lines }] }] });

test("privacy dots are counted from native pixels and alpha channels do not change mask counts", async () => {
  const bytes = await sendMoneyReceiptImage({ phone: "+63 9•• ••• 5095" });
  for (const image of [bytes, await sharp(bytes).ensureAlpha().png().toBuffer()]) {
    const result = await maskedGcashPhoneCrop(image, page()); assert.ok(result); assert.equal(result.maskCount, 5); assert.equal(result.originalLine, phoneLine.text.trim());
    assert.equal((await sharp(result.prefix).metadata()).format, "png"); assert.equal((await sharp(result.suffix).metadata()).format, "png");
  }
});

test("missing geometry, ambiguous phone lines and non-Send-Money layouts cannot use the retry", async () => {
  const bytes = await sendMoneyReceiptImage({ phone: "+63 9•• ••• 5095" });
  for (const input of [{ text: "Sent via GCash", blocks: null }, page([phoneLine, phoneLine]), { ...page(), text: "GCash payment receipt" }]) assert.equal(await maskedGcashPhoneCrop(bytes, input), null);
});

test("a visible digit between mask groups is never discarded or replaced by a wildcard", async () => {
  const bytes = await sendMoneyReceiptImage({ phone: "+63 9••1•• 5095" });
  assert.equal(await maskedGcashPhoneCrop(bytes, page()), null);
});

test("masked phone retries retain native digit size and confidence requirements", async () => {
  const bytes = await sendMoneyReceiptImage({ phone: "+63 9•• ••• 5095" });
  const input = { ...page(), confidence: 95, text: `Sent via GCash\n${phoneLine.text}Amount 100.00` };
  const resultPage = (text, confidence = 95, height = 60) => ({ text, confidence: 95, blocks: [{ paragraphs: [{ lines: [{
    text, baseline: { x0: 0, x1: 200, y0: 0, y1: 0 },
    words: [{ text, confidence, bbox: { x0: 0, x1: 100, y0: 0, y1: height } }],
  }] }] }] });
  const retry = (prefix, suffix) => {
    const results = [prefix, suffix];
    return retryMaskedGcashPhone(bytes, input, { recognize: async () => ({ data: results.shift() }) });
  };
  for (const [prefix, suffix] of [
    [resultPage("+63 9", 50), resultPage("5095")],
    [resultPage("+63 9"), resultPage("5095", 50)],
    [resultPage("+63 9", 95, 30), resultPage("5095")],
    [resultPage("+63 9"), resultPage("5095", 95, 30)],
    [resultPage("+63 9"), resultPage("509A")],
  ]) assert.equal(await retry(prefix, suffix), input);

  const result = await retry(resultPage("+63 9"), resultPage("5095"));
  assert.match(result.text, /\+63 9\*{5}5095/);
  assert.equal(result.confidence, input.confidence);
  const words = result.blocks[0].paragraphs[0].lines[0].words;
  assert.deepEqual(words.map(word => word.text), ["+63 9", "5095"]);
  assert.ok(words.every(word => word.confidence === 95 && word.bbox.y1 - word.bbox.y0 === 20));
  assert.ok(words[1].bbox.x0 > words[0].bbox.x0);
});
