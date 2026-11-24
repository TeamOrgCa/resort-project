import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const { buildRoomStayWindow, isRoomBookingStartAllowed, ROOM_CHECK_IN_TIMES } = loadTsModule("lib/booking/room-stay.ts");
const { validateBookingWindow } = loadTsModule("lib/booking/policy.ts");

test("3-hour and 12-hour stays use half-hour check-in slots across month and year boundaries", () => {
  for (const duration of [3, 12]) {
    for (const startTime of ["00:00", "00:30", "06:00", "15:30", "23:30"]) {
      const window = buildRoomStayWindow("2027-12-31", startTime, duration);
      assert.ok(window);
      assert.equal(Date.parse(window.endDatetime) - Date.parse(window.startDatetime), duration * 3_600_000);
      assert.equal(validateBookingWindow({ bookingMode: "custom", ...window, customStartTime: window.startTime, customEndTime: window.endTime }).valid, true);
      if (startTime === "23:30") assert.equal(window.customEndDate, "2028-01-01");
    }
  }
});

test("room time validation rejects mismatched clocks and preserves the hours for other custom bookings", () => {
  const room = buildRoomStayWindow("2027-12-31", "23:30", 12);
  assert.equal(validateBookingWindow({ ...room, bookingMode: "custom", customStartTime: "23:58", customEndTime: room.endTime }).valid, false);
  assert.equal(validateBookingWindow({ bookingMode: "custom", startDatetime: "2027-12-31T04:00:00+08:00", endDatetime: "2027-12-31T08:00:00+08:00", customStartTime: "04:00", customEndTime: "08:00" }).valid, false);
});

test("room check-in requires an hour's lead and rejects past, stale and off-grid timestamps", () => {
  const now = Date.parse("2027-12-31T09:00:00+08:00");
  assert.equal(ROOM_CHECK_IN_TIMES.length, 48);
  assert.deepEqual(ROOM_CHECK_IN_TIMES.slice(20, 23), ["10:00", "10:30", "11:00"]);
  assert.equal(isRoomBookingStartAllowed("2027-12-31T10:00:00+08:00", now), true);
  assert.equal(isRoomBookingStartAllowed("2027-12-31T10:00:00+08:00", now + 1), false);
  for (const time of ["08:30:00", "09:00:00", "09:30:00", "10:15:00", "10:30:01", "10:30:00.001"]) {
    assert.equal(isRoomBookingStartAllowed(`2027-12-31T${time}+08:00`, now), false, time);
  }
  for (const time of ["10:15", "23:59", "24:00", "invalid"]) assert.equal(buildRoomStayWindow("2027-12-31", time, 3), null);
});
