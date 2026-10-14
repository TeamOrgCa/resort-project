"use client";

import { useId, useState } from "react";
import ManageIcon from "./ManageIcon";

const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-PH", {
  timeZone: "UTC", month: "long", day: "numeric", year: "numeric",
});

export default function RescheduleCalendar({ value, onChange, minDate, originalDate }: {
  value: string; onChange: (date: string) => void; minDate: string; originalDate: string;
}) {
  const titleId = useId();
  const [month, setMonth] = useState(() => (value || (originalDate < minDate ? minDate : originalDate)).slice(0, 7));
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const moveMonth = (direction: number) => setMonth(new Date(Date.UTC(year, monthNumber - 1 + direction, 1)).toISOString().slice(0, 7));

  return <section aria-labelledby={titleId} className="min-w-0 rounded-2xl border border-neutral/10 bg-white p-2 sm:p-5">
    <div className="mb-4">
      <div><h3 id={titleId} className="text-base font-semibold text-neutral">New check-in date</h3>
        <p className="mt-1 text-xs text-neutral/60">Choose a different date in Philippine time.</p></div>
    </div>
    <div className="mb-3 flex items-center gap-2">
      <button type="button" aria-label="Previous month" disabled={month <= minDate.slice(0, 7)} onClick={() => moveMonth(-1)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-neutral hover:bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30"><ManageIcon name="arrow" className="h-5 w-5 rotate-180" /></button>
      <p aria-live="polite" className="min-w-0 flex-1 text-center text-sm font-semibold text-neutral sm:text-lg">{new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString("en-PH", { timeZone: "UTC", month: "long", year: "numeric" })}</p>
      <button type="button" aria-label="Next month" onClick={() => moveMonth(1)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-neutral hover:bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><ManageIcon name="arrow" className="h-5 w-5" /></button>
    </div>
    <div className="grid grid-cols-7 gap-1 sm:gap-2">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <span key={day} className="py-2 text-center text-xs font-semibold text-neutral/60">{day}</span>)}
      {Array.from({ length: firstDay }, (_, index) => <span key={`empty-${index}`} aria-hidden="true" />)}
      {Array.from({ length: days }, (_, index) => {
        const date = `${month}-${String(index + 1).padStart(2, "0")}`;
        const reason = date < minDate ? "Too early for the original start time" : date === originalDate ? "Current reservation date" : null;
        const selected = date === value;
        return <button key={date} type="button" data-date={date} disabled={Boolean(reason)} aria-pressed={selected}
          aria-label={`${dateLabel(date)}: ${reason ?? (selected ? "Selected" : "Select date")}`} title={reason ?? dateLabel(date)} onClick={() => onChange(date)}
          className={`flex min-h-11 min-w-0 items-center justify-center rounded-lg text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:aspect-square ${reason ? "cursor-not-allowed bg-neutral/5 text-neutral/30" : selected ? "bg-primary text-white" : "text-neutral hover:bg-primary/10"}`}>
          {index + 1}
        </button>;
      })}
    </div>
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-neutral/10 pt-4 text-xs text-neutral/60">
      <span className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-primary" />Selected</span>
      <span className="flex items-center gap-2"><span className="h-3 w-3 rounded border border-neutral/20" />Selectable</span>
      <span className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-neutral/10" />Unavailable</span>
    </div>
    <p role="status" className="mt-4 rounded-xl bg-base px-3 py-2 text-sm text-neutral">{value ? `Selected: ${dateLabel(value)}` : "Select a new date to continue."}</p>
    <p className="mt-3 text-xs leading-relaxed text-neutral/60">Availability is checked when you submit. The original start time and duration stay the same. Staff approval is required before your schedule changes.</p>
  </section>;
}
