"use client";

import BookingDateCalendar from "@/components/booking/BookingDateCalendar";

export default function RescheduleCalendar({ value, onChange, minDate, maxDate, originalDate, disabled = false,
  getUnavailableReason, onMonthChange, error, onRetry, month, loading = false, disabledReason, publicSwimming = false,
}: {
  value: string; onChange: (date: string) => void; minDate: string; originalDate: string; disabled?: boolean;
  maxDate?: string;
  publicSwimming?: boolean;
  getUnavailableReason?: (date: string) => string | null; onMonthChange?: (month: string) => void;
  error?: string | null; onRetry?: () => void;
  month?: string; loading?: boolean;
  disabledReason?: string;
}) {
  const hasAvailableDate = !month || Array.from({ length: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate() }, (_, index) =>
    `${month}-${String(index + 1).padStart(2, "0")}`).some(date => date >= minDate && (!maxDate || date <= maxDate) && date !== originalDate && !getUnavailableReason?.(date));
  return <><BookingDateCalendar value={value} onChange={onChange} minDate={minDate} maxDate={maxDate} disabled={disabled} disabledReason={disabledReason}
    onMonthChange={onMonthChange} visibleMonth={month}
    initialDate={originalDate < minDate ? minDate : originalDate}
    title="New check-in date" description="Choose a different date in Philippine time."
    minimumDateReason="Too early for the original start time"
    getUnavailableReason={date => date === originalDate ? "Current reservation date" : getUnavailableReason?.(date) ?? null}
    emptyLabel="Select a new date to continue."
    footnote={publicSwimming ? "Choose the same public session according to its configured access mode, booking window and cutoff. Private bookings, maintenance and full sessions are unavailable. The booked admission rates and duration stay the same." : "Booked time slots, maintenance dates and dates beyond the advance booking limit are unavailable. Available reschedules apply automatically when confirmed. Your package, start time and duration stay the same."} />
    {!disabled && !loading && !error && !hasAvailableDate && <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{maxDate && month && month >= maxDate.slice(0, 7)
      ? "No available dates within the advance booking limit this month. Check an earlier month or contact the resort."
      : "No available dates this month. Use the Next month arrow to check another month."}</p>}
    {loading && !disabled && <p role="status" className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Checking available time slots. You can select a date; submission stays disabled until availability is confirmed.</p>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}
      <button type="button" disabled={disabled} onClick={onRetry} className="ml-2 min-h-11 underline">Retry availability</button></p>}
  </>;
}
