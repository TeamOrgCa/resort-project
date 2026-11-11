import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const { resolveDateRange, withinDateRange } = loadTsModule("lib/admin/date-range.ts");

test("transaction presets follow Philippine midnight, Monday weeks and calendar months", () => {
  const now = "2026-11-10T16:30:00Z"; // November 11 in Manila.
  const today = resolveDateRange("today", "", "", now);
  assert.equal(today.start, Date.parse("2026-11-11T00:00:00+08:00"));
  assert.equal(today.end, Date.parse("2026-11-12T00:00:00+08:00"));
  assert.equal(withinDateRange("2026-11-10T15:59:59.999Z", today), false);
  assert.equal(withinDateRange("2026-11-10T16:00:00Z", today), true);
  assert.equal(withinDateRange("2026-11-11T15:59:59.999Z", today), true);
  assert.equal(withinDateRange("2026-11-11T16:00:00Z", today), false);
  const week = resolveDateRange("week", "", "", now);
  assert.equal(week.start, Date.parse("2026-11-09T00:00:00+08:00"));
  assert.equal(week.end, Date.parse("2026-11-16T00:00:00+08:00"));
  assert.deepEqual(resolveDateRange("week", "", "", "2026-11-15T12:00:00+08:00"), week);
  const month = resolveDateRange("month", "", "", "2026-12-31T23:59:00+08:00");
  assert.equal(month.start, Date.parse("2026-12-01T00:00:00+08:00"));
  assert.equal(month.end, Date.parse("2027-01-01T00:00:00+08:00"));
  const leap = resolveDateRange("month", "", "", "2028-02-29T12:00:00+08:00");
  assert.equal(leap.end - leap.start, 29 * 86400000);
});

test("custom dates include both days, invalid ranges match nothing, overall includes undated records", () => {
  const range = resolveDateRange("custom", "2026-11-01", "2026-11-03");
  assert.equal(withinDateRange("2026-11-03T23:59:59+08:00", range), true);
  assert.equal(withinDateRange("2026-11-04T00:00:00+08:00", range), false);
  assert.equal(withinDateRange(null, range), false);
  assert.equal(withinDateRange("invalid", range), false);
  for (const [start, end] of [["", ""], ["2026-11-03", "2026-11-01"], ["2026-02-30", "2026-03-01"]]) {
    const invalid = resolveDateRange("custom", start, end);
    assert.ok(invalid.error); assert.equal(withinDateRange("2026-11-11T00:00:00Z", invalid), false);
  }
  assert.equal(withinDateRange(null, resolveDateRange("overall", "", "")), true);
});
