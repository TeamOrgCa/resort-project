import test from "node:test";
import assert from "node:assert/strict";
import { positiveRateAdjustment, rescheduleNoticeFee } from "../lib/booking/reschedule-charge-policy.ts";

test("notice fee follows the original booking's remaining notice", () => {
  const originalStart = "2026-10-20T08:00:00+08:00";
  const start = Date.parse(originalStart);
  assert.equal(rescheduleNoticeFee(originalStart, start - 6 * 86_400_000), 50);
  assert.equal(rescheduleNoticeFee(originalStart, start - 3 * 86_400_000), 100);
  assert.equal(rescheduleNoticeFee(originalStart, start - 2 * 86_400_000), 300);
  assert.equal(rescheduleNoticeFee(originalStart, start - 12 * 3_600_000), 500);
});

test("higher chosen-date rates add a charge without creating an automatic refund", () => {
  assert.equal(positiveRateAdjustment(7500, 8000), 500);
  assert.equal(positiveRateAdjustment(8000, 7500), 0);
});
