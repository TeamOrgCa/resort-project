import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const { inspectManualPaymentProof } = loadTsModule("lib/server/manual-payment-proof.ts");
const { isCashMethod, normalizeManualPaymentReference, isValidManualAccountIdentifier } = loadTsModule("lib/booking/payment-method.ts");

test("manual references preserve leading zeroes and reject punctuation that cannot be reconciled safely", () => {
  assert.equal(normalizeManualPaymentReference("  00-ab12 345  "), "00AB12345");
  for (const input of ["short", "---123", "12345!", "abcdef\n123", "a".repeat(101)]) assert.equal(normalizeManualPaymentReference(input), null);
  assert.equal(isCashMethod({ name: " Cash ", type: "other" }), true);
  assert.equal(isCashMethod({ name: "At counter", type: " CASH " }), true);
  assert.equal(isValidManualAccountIdentifier("guest@example.com"), true);
  assert.equal(isValidManualAccountIdentifier("000123456789"), true);
});

test("non-GCash proof accepts decodable images without receipt OCR and rejects forged, missing or unowned files", async () => {
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer();
  let reads = 0;
  const client = data => ({ storage: { from: () => ({ download: async () => { reads++; return { data, error: null }; } }) } });
  assert.equal(await inspectManualPaymentProof(client(new Blob([png])), "guest", "guest/proof.png"), true);
  assert.equal(await inspectManualPaymentProof(client(new Blob([Buffer.from("<svg onload='bad'/>")])), "guest", "guest/proof.png"), false);
  assert.equal(await inspectManualPaymentProof(client(null), "guest", "guest/proof.png"), false);
  assert.equal(await inspectManualPaymentProof(client({ size: 8 * 1024 * 1024 + 1 }), "guest", "guest/proof.png"), false);
  const prior = reads;
  for (const path of ["other/proof.png", "guest/../proof.png", "guest/proof.svg", "guest/proof.pdf"]) assert.equal(await inspectManualPaymentProof(client(new Blob([png])), "guest", path), false);
  assert.equal(reads, prior);
});
