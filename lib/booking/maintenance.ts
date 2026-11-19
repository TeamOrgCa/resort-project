import { windowsOverlap } from "./availability";
import { manilaDateKey } from "./manila-date";

/** Today may include work already underway, but never an already-ended period. */
export function maintenancePeriodError(start: string, end: string, now = Date.now()): string | null {
  const first = Date.parse(start), last = Date.parse(end);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return "The end date and time must be later than the start date and time (Philippine time).";
  if (manilaDateKey(start) < manilaDateKey(new Date(now))) return "Maintenance cannot start on a past date (Philippine time).";
  if (last <= now) return "The maintenance end time must still be in the future (Philippine time).";
  return null;
}

export type MaintenanceWindow = {
  start_date: string;
  end_date: string;
  start_datetime?: string;
  end_datetime?: string;
};

// Legacy date-only blocks represent inclusive, whole Philippine calendar days.
export function maintenanceOverlaps(start: string, end: string, block: MaintenanceWindow) {
  const finish = new Date(`${block.end_date}T00:00:00+08:00`);
  finish.setTime(finish.getTime() + 86_400_000);
  return windowsOverlap(start, end, {
    start_datetime: block.start_datetime ?? `${block.start_date}T00:00:00+08:00`,
    end_datetime: block.end_datetime ?? finish.toISOString(),
  });
}
