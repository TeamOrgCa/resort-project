export const MIN_BOOKING_LEAD_MINUTES = 30;
export const BOOKING_LEAD_MESSAGE = "Choose a start time at least 30 minutes from now (Manila time).";
export const STAFF_BOOKING_WINDOW_MESSAGE = "Choose a package for today or a future date that has not ended (Manila time).";

export const isBookingStartAllowed = (start: Date | string, now = Date.now()) => {
  const timestamp = start instanceof Date ? start.getTime() : new Date(start).getTime();
  return Number.isFinite(timestamp) && timestamp >= now + MIN_BOOKING_LEAD_MINUTES * 60_000;
};

// Staff can record today's walk-in against an in-progress package. Keep the
// scheduled clocks intact; payment verification and actual check-in are separate.
export const isStaffBookingWindowAllowed = (start: string, end: string, now = Date.now()) => {
  const starts = Date.parse(start), ends = Date.parse(end);
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || !Number.isFinite(now) || starts >= ends || ends <= now) return false;
  const manilaDay = (timestamp: number) => new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10);
  return manilaDay(starts) >= manilaDay(now);
};

export const isOcularSlotStartAllowed = (date: string, startTime: string, now = Date.now()) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}/.test(startTime)
    && isBookingStartAllowed(`${date}T${startTime.slice(0, 5)}:00+08:00`, now);
