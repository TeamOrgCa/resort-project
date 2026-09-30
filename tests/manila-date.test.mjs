import test from "node:test";
import assert from "node:assert/strict";
import { manilaDateKey } from "../lib/booking/manila-date.ts";

test("reservation date uses Manila calendar around UTC midnight", () => {
  assert.equal(manilaDateKey("2026-10-15T15:59:00Z"), "2026-10-15");
  assert.equal(manilaDateKey("2026-10-15T16:00:00Z"), "2026-10-16");
  assert.equal(manilaDateKey("2026-10-15T23:59:00+08:00"), "2026-10-15");
});
