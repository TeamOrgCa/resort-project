export const MANILA_TIME_ZONE = "Asia/Manila";

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MANILA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});
const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MANILA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3,
  hourCycle: "h23", timeZoneName: "longOffset",
});

/** Serialize an instant with its explicit Philippine offset; never shift the saved instant. */
export function manilaTimestamp(value: Date | string = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid timestamp.");
  const parts = timestampFormatter.formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}.${part("fractionalSecond")}${part("timeZoneName").replace("GMT", "")}`;
}

export const manilaDateTimeLocal = (value: Date | string): string => manilaTimestamp(value).slice(0, 16);

export function isValidManilaDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00+08:00`);
  return Number.isFinite(date.getTime()) && manilaDateKey(date) === value;
}

// DATE values are calendar dates in the resort's timezone, not UTC instants.
function displayDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatManilaDateTime(value: Date | string | null | undefined, options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }, fallback = "-"): string {
  return displayDate(value)?.toLocaleString("en-PH", { ...options, timeZone: MANILA_TIME_ZONE }) ?? fallback;
}

export function formatManilaDate(value: Date | string | null | undefined, options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" }, fallback = "-"): string {
  return displayDate(value)?.toLocaleDateString("en-PH", { ...options, timeZone: MANILA_TIME_ZONE }) ?? fallback;
}

export function formatManilaTime(value: Date | string | null | undefined, options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }, fallback = "-"): string {
  return displayDate(value)?.toLocaleTimeString("en-PH", { ...options, timeZone: MANILA_TIME_ZONE }) ?? fallback;
}

/** Noon in Manila (04:00 UTC) has the same date in both zones, independent of the device timezone. */
export const manilaCalendarDate = (date: string): Date => new Date(`${date}T12:00:00+08:00`);

export function manilaMonthDate(value: Date | string, monthOffset = 0, day = 1): Date {
  const [year, month] = manilaDateKey(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + monthOffset, day, 4));
}

export function manilaDateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid reservation datetime.");
  const parts = formatter.formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isManilaWeekend(value: Date | string): boolean {
  const date = value instanceof Date ? value : new Date(value);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "short" }).format(date);
  return day === "Fri" || day === "Sat" || day === "Sun";
}

export function manilaHour(value: Date | string): number {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0)
    + Number(parts.find((part) => part.type === "minute")?.value ?? 0) / 60;
}
