import { windowsOverlap } from "./availability";

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
