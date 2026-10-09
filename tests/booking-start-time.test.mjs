import test from "node:test";
import assert from "node:assert/strict";
import { isBookingStartAllowed, isOcularSlotStartAllowed } from "../lib/booking/start-time.ts";

test("same-day Manila stay starts require the full 30-minute lead", () => {
  const noonManila = Date.parse("2026-10-09T12:00:00+08:00");
  assert.equal(isBookingStartAllowed("2026-10-09T08:00:00+08:00", noonManila), false);
  assert.equal(isBookingStartAllowed("2026-10-09T12:29:59+08:00", noonManila), false);
  assert.equal(isBookingStartAllowed("2026-10-09T12:30:00+08:00", noonManila), true);
  assert.equal(isBookingStartAllowed("2026-10-09T18:00:00+08:00", noonManila), true);
});

test("ocular slots use Manila dates and start times even across UTC midnight", () => {
  const nearMidnightUtc = Date.parse("2026-10-08T16:00:00Z"); // October 9, midnight in Manila
  assert.equal(isOcularSlotStartAllowed("2026-10-08", "23:00:00", nearMidnightUtc), false);
  assert.equal(isOcularSlotStartAllowed("2026-10-09", "00:29:00", nearMidnightUtc), false);
  assert.equal(isOcularSlotStartAllowed("2026-10-09", "00:30:00", nearMidnightUtc), true);
});
