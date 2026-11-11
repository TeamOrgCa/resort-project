import { isValidManilaDate, manilaDateKey } from "@/lib/booking/manila-date";

export type DatePreset = "today" | "week" | "month" | "overall" | "custom";
export type DateRange = { start: number | null; end: number | null; error: string | null };
const DAY = 86_400_000;

/** Inclusive Philippine start date, exclusive end instant (including custom end days). */
export function resolveDateRange(preset: DatePreset, customStart: string, customEnd: string, now: Date | string = new Date()): DateRange {
  if (preset === "overall") return { start: null, end: null, error: null };
  if (preset === "custom") {
    if (!isValidManilaDate(customStart) || !isValidManilaDate(customEnd)) return { start: null, end: null, error: "Choose both a start date and an end date." };
    if (customEnd < customStart) return { start: null, end: null, error: "The end date must be on or after the start date." };
    return { start: Date.parse(`${customStart}T00:00:00+08:00`), end: Date.parse(`${customEnd}T00:00:00+08:00`) + DAY, error: null };
  }
  const today = manilaDateKey(now);
  const midnight = Date.parse(`${today}T00:00:00+08:00`);
  if (preset === "today") return { start: midnight, end: midnight + DAY, error: null };
  if (preset === "week") {
    const day = new Date(`${today}T00:00:00Z`).getUTCDay();
    const start = midnight - ((day + 6) % 7) * DAY;
    return { start, end: start + 7 * DAY, error: null };
  }
  const [year, month] = today.split("-").map(Number);
  return { start: Date.UTC(year, month - 1, 1, -8), end: Date.UTC(year, month, 1, -8), error: null };
}

export function withinDateRange(value: string | null | undefined, range?: DateRange): boolean {
  if (!range) return true;
  if (range.error) return false;
  if (range.start === null && range.end === null) return true;
  if (!value) return false;
  const instant = Date.parse(value);
  return Number.isFinite(instant) && (range.start === null || instant >= range.start) && (range.end === null || instant < range.end);
}
