export const MIN_BOOKING_LEAD_MINUTES = 30;
export const BOOKING_LEAD_MESSAGE = "Choose a start time at least 30 minutes from now (Manila time).";

export const isBookingStartAllowed = (start: Date | string, now = Date.now()) => {
  const timestamp = start instanceof Date ? start.getTime() : new Date(start).getTime();
  return Number.isFinite(timestamp) && timestamp >= now + MIN_BOOKING_LEAD_MINUTES * 60_000;
};

export const isOcularSlotStartAllowed = (date: string, startTime: string, now = Date.now()) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}/.test(startTime)
    && isBookingStartAllowed(`${date}T${startTime.slice(0, 5)}:00+08:00`, now);
