export const MIN_BOOKING_LEAD_MINUTES = 30;
export const BOOKING_LEAD_MESSAGE = "Choose a start time at least 30 minutes from now (Manila time).";
export const STAFF_BOOKING_WINDOW_MESSAGE = "Choose a package whose scheduled start time is still in the future (Philippine time).";

export const isBookingStartAllowed = (start: Date | string, now = Date.now()) => {
  const timestamp = start instanceof Date ? start.getTime() : new Date(start).getTime();
  return Number.isFinite(timestamp) && timestamp >= now + MIN_BOOKING_LEAD_MINUTES * 60_000;
};

// Compare absolute instants; package timestamps are built with the PHT offset.
// Staff may book an imminent slot, but never one that has already started.
export const isStaffBookingWindowAllowed = (start: string, end: string, now = Date.now()) => {
  const starts = Date.parse(start), ends = Date.parse(end);
  return Number.isFinite(starts) && Number.isFinite(ends) && Number.isFinite(now)
    && starts > now && ends > starts;
};

export const isOcularSlotStartAllowed = (date: string, startTime: string, now = Date.now()) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}/.test(startTime)
    && isBookingStartAllowed(`${date}T${startTime.slice(0, 5)}:00+08:00`, now);
