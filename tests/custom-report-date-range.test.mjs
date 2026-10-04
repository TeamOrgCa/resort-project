import assert from "node:assert/strict";
import test from "node:test";
import { customBucketIndex, customTrendBuckets, InvalidDateRangeError, parseCustomDateRange } from "../lib/server/custom-date-range.ts";
import { fetchAllPages } from "../lib/server/fetch-all-pages.ts";

test("custom range includes both Manila calendar dates and excludes the following day", () => {
  const range = parseCustomDateRange("2026-10-01", "2026-10-04");
  assert.equal(range.start.toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-10-04T16:00:00.000Z");
  assert.ok(customBucketIndex("2026-10-04T15:59:59.999Z", range) >= 0);
  assert.equal(customBucketIndex("2026-10-04T16:00:00.000Z", range), -1);
  assert.equal(customTrendBuckets(range).count, 4);
});

test("custom buckets cover long ranges without losing a day", () => {
  const range = parseCustomDateRange("2026-10-01", "2026-10-10");
  const buckets = customTrendBuckets(range);
  assert.equal(buckets.count, 7);
  assert.equal(buckets.boundaries[0].getTime(), range.start.getTime());
  assert.equal(buckets.boundaries.at(-1).getTime(), range.end.getTime());
  for (let day = 1; day <= 10; day++) {
    assert.ok(customBucketIndex(`2026-10-${String(day).padStart(2, "0")}T12:00:00+08:00`, range) >= 0);
  }
});

test("invalid and reversed calendar ranges are rejected", () => {
  assert.throws(() => parseCustomDateRange("2026-02-30", "2026-03-01"), InvalidDateRangeError);
  assert.throws(() => parseCustomDateRange("2026-10-04", "2026-10-01"), InvalidDateRangeError);
});

test("report fetch collects beyond one PostgREST page", async () => {
  const source = Array.from({ length: 1001 }, (_, id) => ({ id }));
  const rows = await fetchAllPages((from, to) => Promise.resolve({ data: source.slice(from, to + 1), error: null }));
  assert.equal(rows.length, 1001);
  assert.equal(rows.at(-1).id, 1000);
  const cappedRows = await fetchAllPages((from) => Promise.resolve({ data: source.slice(from, from + 100), error: null }));
  assert.equal(cappedRows.length, 1001);
});
