import test from "node:test";
import assert from "node:assert/strict";
import { formatManilaDate, formatManilaDateTime, formatManilaTime, isValidManilaDate, manilaCalendarDate, manilaDateKey, manilaDateTimeLocal, manilaMonthDate, manilaTimestamp } from "../lib/booking/manila-date.ts";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

test("reservation date uses Manila calendar around UTC midnight", () => {
  assert.equal(manilaDateKey("2026-10-15T15:59:00Z"), "2026-10-15");
  assert.equal(manilaDateKey("2026-10-15T16:00:00Z"), "2026-10-16");
  assert.equal(manilaDateKey("2026-10-15T23:59:00+08:00"), "2026-10-15");
});

test("admin date displays keep the Philippine date and clock across device timezones", () => {
  const original = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Manila"]) {
      process.env.TZ = zone;
      assert.equal(manilaDateKey("2026-10-16T16:30:00Z"), "2026-10-17");
      assert.match(formatManilaDateTime("2026-10-16T16:30:00Z"), /Oct 17, 2026.*12:30 AM/);
      assert.match(formatManilaDateTime("2026-10-17T00:30:00+08:00"), /Oct 17, 2026.*12:30 AM/);
      assert.equal(formatManilaTime("2026-10-16T16:30:00Z"), "12:30 AM");
      assert.equal(formatManilaDate("2026-10-16T15:59:59Z"), "Oct 16, 2026");
      assert.equal(formatManilaDate("2026-10-16T16:00:00Z"), "Oct 17, 2026");
      assert.equal(formatManilaDate("2026-12-31T16:00:00Z"), "Jan 1, 2027");
      assert.equal(formatManilaDate("2026-10-17"), "Oct 17, 2026");
      assert.equal(manilaDateKey(manilaCalendarDate("2026-10-17")), "2026-10-17");
      assert.equal(formatManilaDate(null), "-");
      assert.equal(formatManilaDateTime("invalid", undefined, "Unavailable"), "Unavailable");
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test("receipt numbers follow the Philippine issue date around midnight and New Year", () => {
  const { generateReceiptNumber } = loadTsModule("lib/booking/receipt-number.ts");
  assert.equal(generateReceiptNumber("abcdef00-0000", new Date("2026-10-16T15:59:59Z")), "RCPT-20261016-ABCDEF");
  assert.equal(generateReceiptNumber("abcdef00-0000", new Date("2026-10-16T16:00:00Z")), "RCPT-20261017-ABCDEF");
  assert.equal(generateReceiptNumber("abcdef00-0000", new Date("2026-12-31T16:00:00Z")), "RCPT-20270101-ABCDEF");
});

test("admin package dates build the same Manila window in every device timezone", () => {
  const original = process.env.TZ, { buildBookingWindow } = loadTsModule("lib/booking/policy.ts");
  try {
    for (const zone of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = zone;
      const window = buildBookingWindow({ bookingMode: "night", date: "2026-10-17" });
      assert.equal(window.startDatetime, "2026-10-17T10:00:00.000Z");
      assert.equal(window.endDatetime, "2026-10-17T22:00:00.000Z");
      assert.equal(window.checkIn, "2026-10-17"); assert.equal(window.checkOut, "2026-10-18");
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test("event timestamps and wall-clock inputs retain the same instant with a Philippine offset", () => {
  const original = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = zone;
      for (const [utc, expected] of [
        ["2026-10-16T16:00:00.123Z", "2026-10-17T00:00:00.123+08:00"],
        ["2026-12-31T16:30:59.999Z", "2027-01-01T00:30:59.999+08:00"],
      ]) {
        assert.equal(manilaTimestamp(utc), expected);
        assert.equal(Date.parse(manilaTimestamp(utc)), Date.parse(utc));
        assert.equal(manilaDateTimeLocal(utc), expected.slice(0, 16));
      }
      assert.equal(manilaDateKey(manilaMonthDate("2026-12-31", 1)), "2027-01-01");
      assert.equal(manilaDateKey(manilaMonthDate("2024-02-01", 1, 0)), "2024-02-29");
      assert.equal(isValidManilaDate("2024-02-29"), true);
      for (const value of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-10-17T00:00:00Z", null]) assert.equal(isValidManilaDate(value), false);
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test("booking drafts derive arrival and departure dates from Philippine time rather than UTC substrings", () => {
  const { useBookingStore } = loadTsModule("lib/stores/booking-store.ts", {
    "zustand/middleware": { persist: initializer => initializer, createJSONStorage: () => null },
  });
  useBookingStore.getState().setBookingWindow("night", "2026-10-17T10:00:00.000Z", "2026-10-17T22:00:00.000Z");
  assert.equal(useBookingStore.getState().bookingDraft.checkIn, "2026-10-17");
  assert.equal(useBookingStore.getState().bookingDraft.checkOut, "2026-10-18");
});
