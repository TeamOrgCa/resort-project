import { manilaDateKey } from "./manila-date";

const DAY_MS = 86_400_000;
export const RESCHEDULE_POLICY_TEXT = "Peak months: March-May and September-December require 14 days' notice; other months require 7 days. Shorter notice requires an authorized staff exception.";
export const RESCHEDULE_FEE_TEXT = "Notice fees: PHP 50 for 6 or more days, PHP 100 for 3-5 days, PHP 300 for 1-2 days, and PHP 500 on or after the original swimming date.";

export function reschedulePolicy(originalStart: string, now = Date.now()) {
  const originalDate = manilaDateKey(originalStart), today = manilaDateKey(new Date(now));
  const month = Number(originalDate.slice(5, 7));
  const peak = [3, 4, 5, 9, 10, 11, 12].includes(month);
  const minimumNoticeDays = peak ? 14 : 7;
  const daysNotice = Math.round((Date.parse(originalDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / DAY_MS);
  const deadline = new Date(Date.parse(originalDate + "T00:00:00Z") - minimumNoticeDays * DAY_MS).toISOString().slice(0, 10);
  const allowed = daysNotice >= minimumNoticeDays;
  return { peak, minimumNoticeDays, daysNotice, deadline, allowed,
    noticeFee: daysNotice >= 6 ? 50 : daysNotice >= 3 ? 100 : daysNotice >= 1 ? 300 : 500,
    blockedReason: allowed ? null : `This booking requires ${minimumNoticeDays} days' notice (${peak ? "peak" : "non-peak"} season). The deadline was ${deadline} in Philippine time. Contact the resort for a staff-reviewed exception.` };
}

export function rescheduleNoticeFee(originalStart: string, now = Date.now()): number {
  return reschedulePolicy(originalStart, now).noticeFee;
}
export function positiveRateAdjustment(oldPrice: number, newPrice: number): number {
  return Math.max(0, Math.round((newPrice - oldPrice) * 100) / 100);
}
