import { manilaDateKey } from "../booking/manila-date";
import { customTrendBuckets, InvalidDateRangeError, parseCustomDateRange } from "../server/custom-date-range";
import type { ReportDateRange, ReportPeriod } from "./types";

const DAY = 86_400_000;
const dateFormat = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });
export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  Daily: "Last 7 days · daily", Weekly: "Last 4 weeks · weekly", Monthly: "Last 6 months · monthly", Custom: "Custom date range",
};
export function parseReportPeriod(value: string | null): ReportPeriod {
  if (value === null) return "Daily";
  if (value === "Daily" || value === "Weekly" || value === "Monthly" || value === "Custom") return value;
  throw new InvalidDateRangeError("Choose a supported report period.");
}

/** Calendar windows and labels always use Philippine time; the last day is inclusive. */
export function reportWindow(period: ReportPeriod, range?: ReportDateRange, now = new Date()) {
  let boundaries: Date[];
  if (period === "Custom") {
    const custom = parseCustomDateRange(range?.startDate, range?.endDate);
    boundaries = customTrendBuckets(custom).boundaries;
  } else {
    const today = manilaDateKey(now);
    const end = new Date(new Date(`${today}T00:00:00+08:00`).getTime() + DAY);
    if (period === "Monthly") {
      const [year, month] = today.split("-").map(Number);
      boundaries = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(year, month - 6 + i, 1) - 8 * 3_600_000));
      boundaries.push(end);
    } else {
      const count = period === "Daily" ? 7 : 4;
      const step = period === "Daily" ? DAY : 7 * DAY;
      const start = end.getTime() - count * step;
      boundaries = Array.from({ length: count + 1 }, (_, i) => new Date(start + i * step));
    }
  }
  const labels = boundaries.slice(0, -1).map((start, i) => {
    const last = new Date(boundaries[i + 1].getTime() - 1);
    if (period === "Monthly") return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", year: "numeric" }).format(start);
    return manilaDateKey(start) === manilaDateKey(last) ? dateFormat.format(start) : `${dateFormat.format(start)} – ${dateFormat.format(last)}`;
  });
  return { start: boundaries[0], end: boundaries.at(-1)!, startDate: manilaDateKey(boundaries[0]), endDate: manilaDateKey(new Date(boundaries.at(-1)!.getTime() - 1)), boundaries, labels };
}

export function reportBucket(value: string, window: ReturnType<typeof reportWindow>): number {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time) || time < window.start.getTime() || time >= window.end.getTime()) return -1;
  return window.boundaries.findIndex((start, i) => i < window.boundaries.length - 1 && time >= start.getTime() && time < window.boundaries[i + 1].getTime());
}
