import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const { logoBounds } = loadTsModule("lib/settings/logo-bounds.ts");
test("logo sizing excludes transparent margins while retaining artwork edges", () => {
  const pixels = new Uint8ClampedArray(10 * 10 * 4);
  for (let y = 4; y <= 5; y++) for (let x = 2; x <= 7; x++) pixels[(y * 10 + x) * 4 + 3] = 255;
  assert.deepEqual(logoBounds(pixels, 10, 10), { left: 1, top: 3, width: 8, height: 4 });
});
test("opaque logos retain the whole image and empty images have no artwork", () => {
  assert.deepEqual(logoBounds(new Uint8ClampedArray(4 * 4 * 4).fill(255), 4, 4), { left: 0, top: 0, width: 4, height: 4 });
  assert.equal(logoBounds(new Uint8ClampedArray(4 * 4 * 4), 4, 4), null);
});
