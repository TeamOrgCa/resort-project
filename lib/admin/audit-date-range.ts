import { manilaDateKey } from "@/lib/booking/manila-date";
import { InvalidDateRangeError, parseCustomDateRange } from "@/lib/server/custom-date-range";

export const AUDIT_PERIODS = { today: "Today", "this-week": "This week", "this-month": "This month", custom: "Custom date range" } as const;
export type AuditPeriod = keyof typeof AUDIT_PERIODS;

/** Presets are Philippine calendar periods. This week is the current Monday–Sunday. */
export function auditDateRange(period: AuditPeriod, startDate?: unknown, endDate?: unknown, now = new Date()) {
  if (!Object.hasOwn(AUDIT_PERIODS, period)) throw new InvalidDateRangeError("Choose Today, This week, This month or Custom date range.");
  if (period === "custom") return parseCustomDateRange(startDate, endDate);
  const today = manilaDateKey(now), midnight = Date.parse(`${today}T00:00:00+08:00`), day = 86_400_000;
  if (period === "today") return parseCustomDateRange(today, today);
  if (period === "this-week") {
    const monday = midnight - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) * day;
    return parseCustomDateRange(manilaDateKey(new Date(monday)), manilaDateKey(new Date(monday + 6 * day)));
  }
  const [year, month] = today.split("-").map(Number);
  return parseCustomDateRange(`${today.slice(0, 7)}-01`, manilaDateKey(new Date(Date.UTC(year, month, 1, -8) - day)));
}
