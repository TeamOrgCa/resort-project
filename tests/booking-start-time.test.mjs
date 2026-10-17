import test from "node:test";
import assert from "node:assert/strict";
import { isBookingStartAllowed, isOcularSlotStartAllowed, isStaffBookingWindowAllowed } from "../lib/booking/start-time.ts";

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

test("staff entry accepts today's ongoing and imminent packages while guest entry retains its lead time", () => {
  const noon = Date.parse("2026-10-17T12:00:00+08:00");
  assert.equal(isStaffBookingWindowAllowed("2026-10-17T08:00:00+08:00", "2026-10-17T16:00:00+08:00", noon), true);
  assert.equal(isBookingStartAllowed("2026-10-17T08:00:00+08:00", noon), false);
  assert.equal(isStaffBookingWindowAllowed("2026-10-17T12:15:00+08:00", "2026-10-17T16:00:00+08:00", noon), true);
  assert.equal(isBookingStartAllowed("2026-10-17T12:15:00+08:00", noon), false);
  assert.equal(isStaffBookingWindowAllowed("2026-10-18T08:00:00+08:00", "2026-10-18T16:00:00+08:00", noon), true);
});

test("staff entry rejects ended windows, earlier Philippine arrival dates and invalid timestamps", () => {
  const midnight = Date.parse("2026-10-16T16:30:00Z"); // October 17, 00:30 in Manila.
  assert.equal(isStaffBookingWindowAllowed("2026-10-16T18:00:00+08:00", "2026-10-17T06:00:00+08:00", midnight), false);
  assert.equal(isStaffBookingWindowAllowed("2026-10-17T08:00:00+08:00", "2026-10-17T16:00:00+08:00", Date.parse("2026-10-17T16:00:00+08:00")), false);
  assert.equal(isStaffBookingWindowAllowed("bad", "2026-10-18T16:00:00+08:00", midnight), false);
  assert.equal(isStaffBookingWindowAllowed("2026-10-17T16:00:00+08:00", "2026-10-17T08:00:00+08:00", midnight), false);
});
