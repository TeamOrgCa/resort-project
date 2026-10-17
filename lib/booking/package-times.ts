export type PackageTimeSlot = { start: string; end: string; endDayOffset: number };
export type PackageTimes = {
  day: PackageTimeSlot;
  night: PackageTimeSlot;
  whole_day: { day_to_night: PackageTimeSlot; night_to_day: PackageTimeSlot };
};

export const DEFAULT_PACKAGE_TIMES: PackageTimes = {
  day: { start: "08:00", end: "16:00", endDayOffset: 0 },
  night: { start: "18:00", end: "06:00", endDayOffset: 1 },
  whole_day: {
    day_to_night: { start: "08:00", end: "06:00", endDayOffset: 1 },
    night_to_day: { start: "18:00", end: "16:00", endDayOffset: 1 },
  },
};
export const PACKAGE_TIME_KEYS = ["day", "night", "day_to_night", "night_to_day"] as const;
export type PackageTimeKey = typeof PACKAGE_TIME_KEYS[number];
export const PACKAGE_TIME_NAMES: Record<PackageTimeKey, string> = {
  day: "Day swimming", night: "Night swimming", day_to_night: "Whole day — Variant A", night_to_day: "Whole day — Variant B",
};
export const packageTimeSlot = (times: PackageTimes, key: PackageTimeKey): PackageTimeSlot =>
  key === "day" || key === "night" ? times[key] : times.whole_day[key];
export const clockMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
export const packageSlotHours = (slot: PackageTimeSlot) => (clockMinutes(slot.end) + slot.endDayOffset * 1440 - clockMinutes(slot.start)) / 60;

export function parsePackageTimes(value: unknown): PackageTimes | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as PackageTimes;
  if (Object.keys(raw).length !== 3 || !raw.whole_day || typeof raw.whole_day !== "object"
    || Array.isArray(raw.whole_day) || Object.keys(raw.whole_day).length !== 2) return null;
  for (const key of PACKAGE_TIME_KEYS) {
    const slot = packageTimeSlot(raw, key);
    if (!slot || typeof slot !== "object" || Array.isArray(slot) || Object.keys(slot).length !== 3
      || typeof slot.start !== "string" || typeof slot.end !== "string"
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.end)
      || ![0, 1].includes(slot.endDayOffset) || packageSlotHours(slot) <= 0 || packageSlotHours(slot) > 24) return null;
  }
  return structuredClone(raw);
}

export function formatPackageTimeSlot(slot: PackageTimeSlot): string {
  const clock = (value: string) => {
    const hour = Number(value.slice(0, 2));
    return `${hour % 12 || 12}:${value.slice(3, 5)} ${hour >= 12 ? "PM" : "AM"}`;
  };
  return `${clock(slot.start)} – ${clock(slot.end)}${slot.endDayOffset ? " next day" : ""}`;
}
export function packageTimesLabel(mode: "day" | "night" | "whole_day", times = DEFAULT_PACKAGE_TIMES): string {
  return mode === "whole_day"
    ? `${formatPackageTimeSlot(times.whole_day.day_to_night)} or ${formatPackageTimeSlot(times.whole_day.night_to_day)}`
    : formatPackageTimeSlot(times[mode]);
}
