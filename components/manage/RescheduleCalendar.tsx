"use client";

import BookingDateCalendar from "@/components/booking/BookingDateCalendar";

export default function RescheduleCalendar({ value, onChange, minDate, originalDate, disabled = false,
  getUnavailableReason, onMonthChange, error, onRetry, month, loading = false, disabledReason,
}: {
  value: string; onChange: (date: string) => void; minDate: string; originalDate: string; disabled?: boolean;
  getUnavailableReason?: (date: string) => string | null; onMonthChange?: (month: string) => void;
  error?: string | null; onRetry?: () => void;
  month?: string; loading?: boolean;
  disabledReason?: string;
}) {
  const hasAvailableDate = !month || Array.from({ length: new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate() }, (_, index) =>
    `${month}-${String(index + 1).padStart(2, "0")}`).some(date => date >= minDate && date !== originalDate && !getUnavailableReason?.(date));
  return <><BookingDateCalendar value={value} onChange={onChange} minDate={minDate} disabled={disabled} disabledReason={disabledReason}
    onMonthChange={onMonthChange} visibleMonth={month}
    initialDate={originalDate < minDate ? minDate : originalDate}
    title="New check-in date" description="Choose a different date in Philippine time."
    minimumDateReason="Too early for the original start time"
    getUnavailableReason={date => date === originalDate ? "Current reservation date" : getUnavailableReason?.(date) ?? null}
    emptyLabel="Select a new date to continue."
    footnote="Booked time slots and maintenance dates are unavailable. Availability is checked again when you submit. Your package, start time and duration stay the same; staff approval is required." />
    {!disabled && !loading && !error && !hasAvailableDate && <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">No available dates this month. Use the Next month arrow to check another month.</p>}
    {loading && !disabled && <p role="status" className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Checking available time slots. You can select a date; submission stays disabled until availability is confirmed.</p>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}
      <button type="button" disabled={disabled} onClick={onRetry} className="ml-2 min-h-11 underline">Retry availability</button></p>}
  </>;
}
