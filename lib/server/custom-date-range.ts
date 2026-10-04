export type CustomDateRange = { startDate: string; endDate: string; start: Date; end: Date };
export class InvalidDateRangeError extends Error {}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function manilaTodayExclusiveEnd(): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return new Date(new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00+08:00`).getTime() + 86_400_000);
}
const realDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** Date inputs are Manila calendar days; end is exclusive for database queries. */
export function parseCustomDateRange(startDate: unknown, endDate: unknown): CustomDateRange {
  if (typeof startDate !== "string" || typeof endDate !== "string" ||
      !datePattern.test(startDate) || !datePattern.test(endDate) ||
      !realDate(startDate) || !realDate(endDate)) {
    throw new InvalidDateRangeError("Choose a valid start and end date.");
  }
  const start = new Date(`${startDate}T00:00:00+08:00`);
  const finalDay = new Date(`${endDate}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(finalDay.getTime()) ||
      endDate < startDate || finalDay.getTime() - start.getTime() > 5 * 366 * 86_400_000) {
    throw new InvalidDateRangeError("Choose a valid date range of up to five years.");
  }
  const end = new Date(finalDay.getTime() + 86_400_000);
  return { startDate, endDate, start, end };
}

export function customTrendBuckets(range: CustomDateRange) {
  const days = Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000);
  const count = Math.min(days, 7);
  const boundaries = Array.from({ length: count + 1 }, (_, index) =>
    new Date(range.start.getTime() + Math.floor(index * days / count) * 86_400_000));
  const formatter = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });
  const labels = Array.from({ length: count }, (_, index) => {
    const first = boundaries[index];
    const last = new Date(boundaries[index + 1].getTime() - 1);
    const startLabel = formatter.format(first);
    const endLabel = formatter.format(last);
    return startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
  });
  return { count, boundaries, labels };
}

export function customBucketIndex(value: string, range: CustomDateRange): number {
  const time = new Date(value).getTime();
  if (Number.isNaN(time) || time < range.start.getTime() || time >= range.end.getTime()) return -1;
  const days = Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000);
  const count = Math.min(days, 7);
  const dayOffset = Math.floor((time - range.start.getTime()) / 86_400_000);
  for (let index = 0; index < count; index++) {
    if (dayOffset < Math.floor((index + 1) * days / count)) return index;
  }
  return -1;
}
