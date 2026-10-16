"use client";

import { useId, useState } from "react";
import ManageIcon from "@/components/manage/ManageIcon";
import { manilaDateKey } from "@/lib/booking/manila-date";

const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-PH", {
  timeZone: "UTC", month: "long", day: "numeric", year: "numeric",
});

type BookingDateCalendarProps = {
  value: string;
  onChange: (date: string) => void;
  title?: string;
  description?: string;
  minDate?: string;
  initialDate?: string;
  visibleMonth?: string;
  minimumDateReason?: string;
  getUnavailableReason?: (date: string) => string | null;
  getDateHint?: (date: string) => string;
  onMonthChange?: (month: string) => void;
  disabled?: boolean;
  disabledReason?: string;
  emptyLabel?: string;
  footnote?: string;
};

export default function BookingDateCalendar({ value, onChange, title = "Booking date", description = "Choose a date in Philippine time.",
  minDate, initialDate, visibleMonth, minimumDateReason = "Before the earliest selectable date", getUnavailableReason, getDateHint, onMonthChange, disabled = false, disabledReason,
  emptyLabel = "Select a booking date.", footnote,
}: BookingDateCalendarProps) {
  const titleId = useId();
  const [localMonth, setMonth] = useState(() => (value || initialDate || minDate || manilaDateKey(new Date())).slice(0, 7));
  const month = visibleMonth || localMonth;
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const moveMonth = (direction: number) => {
    const next = new Date(Date.UTC(year, monthNumber - 1 + direction, 1)).toISOString().slice(0, 7);
    setMonth(next); onMonthChange?.(next);
  };

  return <section aria-labelledby={titleId} className="min-w-0 rounded-2xl border border-neutral/10 bg-white p-2 sm:p-5">
    <div className="mb-4">
      <div><h3 id={titleId} className="text-base font-semibold text-neutral">{title}</h3>
        <p className="mt-1 text-xs text-neutral/60">{description}</p></div>
    </div>
    <div className="mb-3 flex items-center gap-2">
      <button type="button" aria-label="Previous month" disabled={disabled || Boolean(minDate && month <= minDate.slice(0, 7))} onClick={() => moveMonth(-1)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-neutral hover:bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30"><ManageIcon name="arrow" className="h-5 w-5 rotate-180" /></button>
      <p aria-live="polite" className="min-w-0 flex-1 text-center text-sm font-semibold text-neutral sm:text-lg">{new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString("en-PH", { timeZone: "UTC", month: "long", year: "numeric" })}</p>
      <button type="button" aria-label="Next month" disabled={disabled} onClick={() => moveMonth(1)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-neutral hover:bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><ManageIcon name="arrow" className="h-5 w-5" /></button>
    </div>
    <div className="grid grid-cols-7 gap-1 sm:gap-2">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <span key={day} className="py-2 text-center text-xs font-semibold text-neutral/60">{day}</span>)}
      {Array.from({ length: firstDay }, (_, index) => <span key={`empty-${index}`} aria-hidden="true" />)}
      {Array.from({ length: days }, (_, index) => {
        const date = `${month}-${String(index + 1).padStart(2, "0")}`;
        const reason = disabled && disabledReason ? disabledReason : minDate && date < minDate ? minimumDateReason : getUnavailableReason?.(date) ?? null;
        const hint = !reason ? getDateHint?.(date) : undefined;
        const selected = date === value;
        return <button key={date} type="button" data-date={date} disabled={disabled || Boolean(reason)} aria-pressed={selected}
          aria-label={`${dateLabel(date)}: ${reason ?? (selected ? "Selected" : "Select date")}${hint ? `. ${hint}` : ""}`} title={reason ?? hint ?? dateLabel(date)} onClick={() => { if (!disabled && !reason) onChange(date); }}
          className={`flex min-h-11 min-w-0 flex-col items-center justify-center rounded-lg text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:aspect-square ${disabled || reason ? "cursor-not-allowed bg-neutral/5 text-neutral/30" : selected ? "bg-primary text-white" : "text-neutral hover:bg-primary/10"}`}>
          {index + 1}
          {hint && <span className="text-[9px] leading-tight">{hint}</span>}
        </button>;
      })}
    </div>
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-neutral/10 pt-4 text-xs text-neutral/60">
      <span className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-primary" />Selected</span>
      <span className="flex items-center gap-2"><span className="h-3 w-3 rounded border border-neutral/20" />Selectable</span>
      <span className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-neutral/10" />Unavailable</span>
    </div>
    <p role="status" className="mt-4 rounded-xl bg-base px-3 py-2 text-sm text-neutral">{value ? `Selected: ${dateLabel(value)}` : emptyLabel}</p>
    {footnote && <p className="mt-3 text-xs leading-relaxed text-neutral/60">{footnote}</p>}
  </section>;
}
