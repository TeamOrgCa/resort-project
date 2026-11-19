import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const { calendarAvailability } = loadTsModule("lib/booking/calendar-availability.ts");
const date = "2027-03-20";
const now = hour => Date.parse(`${date}T${hour}:00:00+08:00`);
const row = (status, extra = {}) => ({ status, start_datetime: `${date}T08:00:00+08:00`, end_datetime: "2027-03-21T06:00:00+08:00", ...extra });

test("empty past dates and elapsed package starts are never labelled fully booked", () => {
  assert.equal(calendarAvailability("2027-03-19", [], [], now("07")).label, "Past date");
  assert.equal(calendarAvailability(date, [], [], now("19")).label, "Booking start times passed");
  assert.equal(calendarAvailability(date, [], [], now("10")).label, "Night available · Day start time passed");
  assert.equal(calendarAvailability(date, [], [], now("07")).label, "Day and night available");
  assert.equal(calendarAvailability("2027-03-21", [], [], now("23")).label, "Day and night available");
});

test("only active overlapping reservations consume availability; expired holds and closed records do not", () => {
  for (const status of ["pending", "payment_submitted", "confirmed", "reschedule_requested"]) {
    assert.equal(calendarAvailability(date, [row(status)], [], now("07")).label, "Fully booked");
  }
  for (const status of ["completed", "cancelled", "expired", "no_show", "rejected"]) {
    assert.equal(calendarAvailability(date, [row(status)], [], now("07")).label, "Day and night available");
  }
  assert.equal(calendarAvailability(date, [row("pending", { payment_deadline_at: `${date}T06:00:00+08:00` })], [], now("07")).label, "Day and night available");
  assert.equal(calendarAvailability(date, [row("confirmed", { end_datetime: `${date}T16:00:00+08:00` })], [], now("07")).label, "Night available · Day booked");
});

test("maintenance is labelled separately and overnight boundary times do not block an empty day", () => {
  const block = { status: "active", start_date: date, end_date: date };
  assert.equal(calendarAvailability(date, [], [block], now("07")).label, "Maintenance blocked");
  assert.equal(calendarAvailability(date, [], [{ ...block, status: "released" }], now("07")).label, "Day and night available");
  const morning = { ...block, start_datetime: `${date}T08:00:00+08:00`, end_datetime: `${date}T12:00:00+08:00` };
  assert.equal(calendarAvailability(date, [], [morning], now("07")).label, "Night available · Day maintenance");
  const previousNight = row("confirmed", { start_datetime: "2027-03-19T18:00:00+08:00", end_datetime: `${date}T08:00:00+08:00` });
  assert.equal(calendarAvailability(date, [previousNight], [], now("07")).label, "Day and night available");
});

test("maintenance is identified separately from bookings and respects partial time windows", () => {
  const block = { status: "active", start_date: date, end_date: date };
  assert.equal(calendarAvailability(date, [], [block], now("07")).label, "Maintenance blocked");
  assert.equal(calendarAvailability(date, [], [{ ...block, start_datetime: `${date}T08:00:00+08:00`, end_datetime: `${date}T16:00:00+08:00` }], now("07")).label, "Night available · Day maintenance");
  assert.equal(calendarAvailability(date, [], [{ ...block, status: "released" }], now("07")).label, "Day and night available");
});
