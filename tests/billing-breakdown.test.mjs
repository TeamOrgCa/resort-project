import test from "node:test";
import assert from "node:assert/strict";
import { buildBillingBreakdown } from "../lib/booking/billing-breakdown.ts";

const booking = {
  bookingMode: "day",
  startDatetime: "2026-10-10T00:00:00+08:00",
  endDatetime: "2026-10-10T08:00:00+08:00",
  adultCount: 2,
  childCount: 0,
  adultRate: 100,
  childRate: 0,
  units: [{ name: "Pool Villa", quantity: 1, pricePerPeriod: 7500 }],
  services: [{ name: "Extra mattress", quantity: 2, priceAtBooking: 300 }],
};

test("shows stored unit, guest, and service charges when they match the bill", () => {
  const breakdown = buildBillingBreakdown({ ...booking, recordedTotal: 8300 });
  assert.deepEqual(breakdown.lines.map(({ description, amount }) => [description, amount]), [
    ["Pool Villa", 7500],
    ["Adult guest charges", 200],
    ["Extra mattress", 600],
  ]);
  assert.equal(breakdown.lines.reduce((sum, line) => sum + line.amount, 0), breakdown.total);
});

test("uses the recorded package amount when snapshot rates do not match the bill", () => {
  const breakdown = buildBillingBreakdown({ ...booking, recordedTotal: 8000 });
  assert.equal(breakdown.lines[0].description, "Private pool package and guest charges");
  assert.match(breakdown.lines[0].detail, /Pool Villa/);
  assert.deepEqual(breakdown.lines.map(({ amount }) => amount), [7400, 600]);
  assert.equal(breakdown.lines.reduce((sum, line) => sum + line.amount, 0), breakdown.total);
});

test("uses the booking period count for longer stays", () => {
  const breakdown = buildBillingBreakdown({
    ...booking,
    endDatetime: "2026-10-11T16:00:00+08:00",
    recordedTotal: 16000,
  });
  assert.deepEqual(breakdown.lines.map(({ amount }) => amount), [15000, 400, 600]);
  assert.equal(breakdown.total, 16000);
});
