"use client";

import BookingDateCalendar from "@/components/booking/BookingDateCalendar";

export default function RescheduleCalendar({ value, onChange, minDate, originalDate, disabled = false }: {
  value: string; onChange: (date: string) => void; minDate: string; originalDate: string; disabled?: boolean;
}) {
  return <BookingDateCalendar value={value} onChange={onChange} minDate={minDate} disabled={disabled}
    initialDate={originalDate < minDate ? minDate : originalDate}
    title="New check-in date" description="Choose a different date in Philippine time."
    minimumDateReason="Too early for the original start time"
    getUnavailableReason={date => date === originalDate ? "Current reservation date" : null}
    emptyLabel="Select a new date to continue."
    footnote="Availability is checked when you submit. The original start time and duration stay the same. Staff approval is required before your schedule changes." />;
}
