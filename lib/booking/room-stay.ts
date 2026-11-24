import { isValidManilaDate, manilaDateKey } from "./manila-date";

export type RoomDurationHours = 3 | 12;

export const ROOM_BOOKING_LEAD_MINUTES = 60;
export const ROOM_CHECK_IN_TIMES = Array.from({ length: 48 }, (_, index) =>
  `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`);
export const ROOM_BOOKING_LEAD_MESSAGE = "Choose a check-in time in 30-minute intervals, at least one hour from now (Philippine time).";

export function isRoomCheckInAligned(start: string | Date) {
  const timestamp = start instanceof Date ? start.getTime() : Date.parse(start);
  // Philippine time is UTC+8, also aligned with these absolute half-hour slots.
  return Number.isFinite(timestamp) && timestamp % (30 * 60_000) === 0;
}

export function isRoomBookingStartAllowed(start: string | Date, now = Date.now()) {
  const timestamp = start instanceof Date ? start.getTime() : Date.parse(start);
  return isRoomCheckInAligned(start) && timestamp >= now + ROOM_BOOKING_LEAD_MINUTES * 60_000;
}

export function buildRoomStayWindow(date: string, startTime: string, duration: RoomDurationHours) {
  if (!isValidManilaDate(date) || !/^([01]\d|2[0-3]):(00|30)$/.test(startTime) || (duration !== 3 && duration !== 12)) return null;
  const start = new Date(`${date}T${startTime}:00+08:00`);
  const end = new Date(start.getTime() + duration * 3_600_000);
  return {
    startTime,
    endTime: new Date(end.getTime() + 8 * 3_600_000).toISOString().slice(11, 16),
    startDatetime: start.toISOString(),
    endDatetime: end.toISOString(),
    customEndDate: manilaDateKey(end),
  };
}
