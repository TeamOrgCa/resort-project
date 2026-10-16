"use client";

import { isWindowAvailable } from "./availability";
import { manilaDateKey } from "./manila-date";
import { moveReservationToDate } from "./reservation-edit";
import { BOOKING_LEAD_MESSAGE, isBookingStartAllowed } from "./start-time";
import { useBookingAvailability } from "./use-booking-availability";

export function useGuestRescheduleAvailability(start: string, end: string, month: string, selectedDate: string, enabled: boolean) {
  const duration = Date.parse(end) - Date.parse(start);
  const months = new Set<string>();
  if (/^\d{4}-\d{2}$/.test(month) && duration > 0) {
    // Load every month a displayed date's full stay could touch, including overnight stays.
    const first = new Date(`${month}-01T00:00:00Z`);
    const lastStart = new Date(first); lastStart.setUTCMonth(lastStart.getUTCMonth() + 1); lastStart.setUTCDate(0);
    // The endpoint already includes the next day for overnight packages.
    const lastEnd = new Date(lastStart.getTime() + Math.max(0, Math.ceil(duration / 86_400_000) - 1) * 86_400_000).toISOString().slice(0, 7);
    for (let i = 0; i < 14 && first.toISOString().slice(0, 7) <= lastEnd; i++) {
      months.add(first.toISOString().slice(0, 7)); first.setUTCMonth(first.getUTCMonth() + 1);
    }
  }
  if (selectedDate && duration > 0) {
    months.add(selectedDate.slice(0, 7));
    if (duration > 86_400_000) {
      const moved = moveReservationToDate({ start_datetime: start, end_datetime: end }, selectedDate);
      months.add(manilaDateKey(moved.endDatetime).slice(0, 7));
    }
  }
  const availability = useBookingAvailability([...months], enabled);
  // This public response contains windows only. Ignore the guest's unchanged original
  // window for this preview; the submission API checks ownership and conflicts again.
  const reservations = availability.reservations.filter(window =>
    Date.parse(window.start_datetime) !== Date.parse(start) || Date.parse(window.end_datetime) !== Date.parse(end));

  function dateIssue(date: string, requireReady = true): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return "Choose a valid date.";
    if (!(duration > 0)) return "Unable to determine the original booking times. Contact the resort.";
    if (date === manilaDateKey(start)) return "Current reservation date";
    const moved = moveReservationToDate({ start_datetime: start, end_datetime: end }, date);
    if (!isBookingStartAllowed(moved.startDatetime, availability.now)) return BOOKING_LEAD_MESSAGE;
    if (!availability.ready) return availability.error ?? (requireReady ? "Loading available dates..." : null);
    if (!isWindowAvailable(moved.startDatetime, moved.endDatetime, reservations)) return "Already reserved for your package or time slot.";
    const lastDay = manilaDateKey(new Date(Date.parse(moved.endDatetime) - 1));
    if (availability.blockedDates.some(block => block.start_date <= lastDay && block.end_date >= date)) return "Closed for maintenance.";
    return null;
  }

  return { ...availability, dateIssue, calendarDateIssue: (date: string) => dateIssue(date, false) };
}
