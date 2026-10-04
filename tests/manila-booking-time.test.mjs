import test from "node:test";
import assert from "node:assert/strict";
import { isManilaWeekend, manilaDateKey, manilaHour } from "../lib/booking/manila-date.ts";

test("uses Manila calendar dates at the weekday and weekend boundary", () => {
  assert.equal(manilaDateKey("2026-10-01T15:59:00Z"), "2026-10-01");
  assert.equal(isManilaWeekend("2026-10-01T15:59:00Z"), false);
  assert.equal(manilaDateKey("2026-10-01T16:00:00Z"), "2026-10-02");
  assert.equal(isManilaWeekend("2026-10-01T16:00:00Z"), true);
});

test("uses Manila clock time for custom package selection", () => {
  assert.equal(manilaHour("2026-10-01T10:30:00Z"), 18.5);
});
