"use client";

import { useId, useState } from "react";
import ManageIcon from "@/components/manage/ManageIcon";
import { formatManilaDate, manilaDateKey } from "@/lib/booking/manila-date";

const dateLabel = (date: string) => formatManilaDate(date, {
  month: "long", day: "numeric", year: "numeric",
});

type BookingDateCalendarProps = {
  value: string;
  onChange: (date: string) => void;
  title?: string;
  description?: string;
  minDate?: string;
  maxDate?: string;
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
  className?: string;
  appearance?: "compact" | "customer";
  isPartiallyAvailable?: (date: string) => boolean;
  allowUnavailableSelection?: boolean;
};

export default function BookingDateCalendar({ value, onChange, title = "Booking date", description = "Choose a date in Philippine time.",
  minDate, maxDate, initialDate, visibleMonth, minimumDateReason = "Before the earliest selectable date", getUnavailableReason, getDateHint, onMonthChange, disabled = false, disabledReason,
  emptyLabel = "Select a booking date.", footnote, className = "min-w-0 rounded-2xl border border-neutral/10 bg-white p-2 sm:p-5",
  appearance = "compact", isPartiallyAvailable, allowUnavailableSelection = false,
}: BookingDateCalendarProps) {
  const customer = appearance === "customer";
  const titleId = useId();
  const [localMonth, setMonth] = useState(() => (value || initialDate || minDate || manilaDateKey(new Date())).slice(0, 7));
  const month = visibleMonth || localMonth;
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const moveMonth = (direction: number) => {
    const next = new Date(Date.UTC(year, monthNumber - 1 + direction, 1)).toISOString().slice(0, 7);
    // An asynchronously loaded limit may put the visible month outside the
    // window. Always allow navigation back toward the valid dates.
    if (direction > 0 && maxDate && next > maxDate.slice(0, 7)) return;
    if (direction < 0 && minDate && next < minDate.slice(0, 7)) return;
    setMonth(next); onMonthChange?.(next);
  };

  return <section data-reservation-date={value} aria-labelledby={titleId} className={className}>
    {customer ? <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 sm:mb-8">
        <h2 id={titleId} className="text-xl font-bold text-neutral sm:text-3xl">{title}</h2>
        <div className="flex gap-2">
          {([-1, 1] as const).map(direction => <button key={direction} type="button" aria-label={direction < 0 ? "Previous month" : "Next month"}
            disabled={disabled || Boolean(direction < 0 ? minDate && month <= minDate.slice(0, 7) : maxDate && month >= maxDate.slice(0, 7))}
            onClick={() => moveMonth(direction)} className="flex h-11 w-11 items-center justify-center rounded-lg text-neutral transition-colors hover:bg-neutral/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30">
            <svg aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={direction < 0 ? "M15 19l-7-7 7-7" : "M9 5l7 7-7 7"} /></svg>
          </button>)}
        </div>
      </div>
      <p className="mb-4 text-sm text-neutral/70" aria-live="polite">{description}</p>
      <h3 aria-live="polite" className="mb-6 text-center text-lg font-semibold text-neutral sm:text-2xl">{formatManilaDate(`${month}-01`, { month: "long", year: "numeric" })}</h3>
    </> : <>
    <div className="mb-4">
      <div><h3 id={titleId} className="text-base font-semibold text-neutral">{title}</h3>
        <p className="mt-1 text-xs text-neutral/60">{description}</p></div>
    </div>
    <div className="mb-3 flex items-center gap-2">
      <button type="button" aria-label="Previous month" disabled={disabled || Boolean(minDate && month <= minDate.slice(0, 7))} onClick={() => moveMonth(-1)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-neutral hover:bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30"><ManageIcon name="arrow" className="h-5 w-5 rotate-180" /></button>
      <p aria-live="polite" className="min-w-0 flex-1 text-center text-sm font-semibold text-neutral sm:text-lg">{formatManilaDate(`${month}-01`, { month: "long", year: "numeric" })}</p>
      <button type="button" aria-label="Next month" disabled={disabled || Boolean(maxDate && month >= maxDate.slice(0, 7))} onClick={() => moveMonth(1)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-neutral hover:bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><ManageIcon name="arrow" className="h-5 w-5" /></button>
    </div>
    </>}
    <div className={`grid grid-cols-7 gap-1 sm:gap-2 ${customer ? "mb-4" : "mb-1 sm:mb-2"}`}>
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <span key={day} className={customer ? "py-2 text-center text-[10px] font-semibold text-neutral/70 sm:text-sm" : "py-2 text-center text-xs font-semibold text-neutral/60"}>{day}</span>)}
    </div>
    <div className="grid grid-cols-7 gap-1 sm:gap-2">
      {Array.from({ length: firstDay }, (_, index) => <span key={`empty-${index}`} aria-hidden="true" className={customer ? "aspect-square" : undefined} />)}
      {Array.from({ length: days }, (_, index) => {
        const date = `${month}-${String(index + 1).padStart(2, "0")}`;
        const reason = disabled && disabledReason ? disabledReason : minDate && date < minDate ? minimumDateReason : maxDate && date > maxDate ? `Beyond the advance booking limit (${maxDate})` : getUnavailableReason?.(date) ?? null;
        const hint = !reason || allowUnavailableSelection ? getDateHint?.(date) : undefined;
        const selected = date === value;
        const blocked = disabled || Boolean(reason) && !allowUnavailableSelection;
        return <button key={date} type="button" data-date={date} disabled={blocked} aria-pressed={selected}
          aria-label={`${dateLabel(date)}: ${reason ?? (selected ? "Selected" : "Select date")}${hint ? `. ${hint}` : ""}`} title={reason ?? hint ?? dateLabel(date)} onClick={() => { if (!blocked) onChange(date); }}
          className={`flex min-h-11 min-w-0 flex-col items-center justify-center rounded-lg font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${customer ? "aspect-square" : "text-sm sm:aspect-square"} ${blocked ? customer ? "cursor-not-allowed bg-neutral/20 text-neutral/40" : "cursor-not-allowed bg-neutral/5 text-neutral/30" : selected ? "bg-primary text-white" : reason ? "bg-neutral/10 text-neutral/60 hover:bg-neutral/20" : customer && isPartiallyAvailable?.(date) ? "bg-amber-50 text-amber-900 hover:bg-amber-100" : "text-neutral hover:bg-primary/10"}`}>
          {index + 1}
          {hint && <span className={allowUnavailableSelection ? "max-w-full break-words px-0.5 text-center text-[9px] leading-tight sm:text-xs" : "text-[9px] leading-tight"}>{hint}</span>}
        </button>;
      })}
    </div>
    {customer ? <div className="mt-8 flex flex-wrap gap-6 border-t border-neutral/10 pt-6 text-sm text-neutral/70">
      <span className="flex items-center gap-2"><span className="h-4 w-4 rounded bg-primary" />Selected</span>
      <span className="flex items-center gap-2"><span className="h-4 w-4 rounded bg-neutral/20" />Fully booked / Unavailable</span>
      {isPartiallyAvailable && <span className="flex items-center gap-2"><span className="h-4 w-4 rounded bg-amber-50" />{allowUnavailableSelection ? "Partially Available" : "Day or night available"}</span>}
      <span className="flex items-center gap-2"><span className="h-4 w-4 rounded border-2 border-neutral/30" />Available</span>
    </div> : <><div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-neutral/10 pt-4 text-xs text-neutral/60">
      <span className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-primary" />Selected</span>
      <span className="flex items-center gap-2"><span className="h-3 w-3 rounded border border-neutral/20" />Selectable</span>
      <span className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-neutral/10" />Unavailable</span>
    </div>
    <p role="status" className="mt-4 rounded-xl bg-base px-3 py-2 text-sm text-neutral">{value ? `Selected: ${dateLabel(value)}` : emptyLabel}</p></>}
    {footnote && <p className="mt-3 text-xs leading-relaxed text-neutral/60">{footnote}</p>}
  </section>;
}
