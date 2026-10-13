import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { sendMoneyReceiptImage } from "./helpers/gcash-receipt-image.mjs";

const { maskedGcashPhoneCrop } = loadTsModule("lib/server/gcash-phone-ocr.ts");
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
