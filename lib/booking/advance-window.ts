import { manilaDateKey } from "./manila-date";

export const DEFAULT_ADVANCE_BOOKING_DAYS = 365;
export const ADVANCE_BOOKING_KEY = "reservation.maximum_advance_booking_days";
export function advanceBookingDays(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 3650 ? value : DEFAULT_ADVANCE_BOOKING_DAYS;
}
export function maximumBookingDate(days: number, now = Date.now()): string {
  const today = new Date(`${manilaDateKey(new Date(now))}T00:00:00Z`);
  today.setUTCDate(today.getUTCDate() + advanceBookingDays(days));
  return today.toISOString().slice(0, 10);
}
export function advanceBookingIssue(date: string, maxDate: string): string | null {
  return date.slice(0, 10) > maxDate ? `Bookings are available only through ${maxDate} (Philippine time).` : null;
}
