import { isValidManilaDate } from "./manila-date";

export const SWIMMING_MODES = ["flexible", "public_only", "private_only"] as const;
export type SwimmingAccessMode = typeof SWIMMING_MODES[number];
export type SwimmingPeriod = "day" | "night";
export const SWIMMING_MODE_LABELS: Record<SwimmingAccessMode, string> = { flexible: "Flexible", public_only: "Public Only", private_only: "Private Only" };
export const SWIMMING_MODE_DESCRIPTIONS: Record<SwimmingAccessMode, string> = {
  flexible: "Private reservations may book ahead. Public admissions open within the rolling window. The first eligible booking or payment hold claims the pool.",
  public_only: "Reserved for public swimming, with its own advance booking window. Exclusive private bookings are prohibited.",
  private_only: "Reserved for exclusive private swimming. Public admissions are prohibited.",
};
export type SwimmingOverride = { from: string; to: string; period: SwimmingPeriod; mode: SwimmingAccessMode };
export type SwimmingPolicy = {
  version: number; defaultMode: SwimmingAccessMode; flexibleDays: number; publicOnlyDays: number;
  minimumAdvanceMinutes: number; bufferMinutes: number; sameDay: boolean;
  active: Record<SwimmingPeriod, boolean>;
  weekly: Record<string, Partial<Record<SwimmingPeriod, SwimmingAccessMode>>>;
  overrides: SwimmingOverride[];
};
export const DEFAULT_SWIMMING_POLICY: SwimmingPolicy = {
  version: 1, defaultMode: "flexible", flexibleDays: 3, publicOnlyDays: 30,
  minimumAdvanceMinutes: 60, bufferMinutes: 0, sameDay: true,
  active: { day: true, night: true }, weekly: {}, overrides: [],
};
export function parseSwimmingPolicy(value: unknown): SwimmingPolicy | null {
  if (!value || typeof value !== "object") return null;
  const p = value as SwimmingPolicy;
  const mode = (v: unknown) => SWIMMING_MODES.includes(v as SwimmingAccessMode);
  const integer = (v: number, min: number, max: number) => Number.isSafeInteger(v) && v >= min && v <= max;
  if (!integer(p.version, 1, Number.MAX_SAFE_INTEGER) || !mode(p.defaultMode)
    || !integer(p.flexibleDays, 1, 366) || !integer(p.publicOnlyDays, 1, 366)
    || !integer(p.minimumAdvanceMinutes, 30, 10080) || !integer(p.bufferMinutes, 0, 1440)
    || typeof p.sameDay !== "boolean" || typeof p.active?.day !== "boolean" || typeof p.active?.night !== "boolean"
    || !p.weekly || typeof p.weekly !== "object" || Array.isArray(p.weekly)
    || !Array.isArray(p.overrides) || p.overrides.length > 500) return null;
  for (const [day, periods] of Object.entries(p.weekly)) {
    if (!/^[0-6]$/.test(day) || !periods || typeof periods !== "object" || Array.isArray(periods)
      || Object.entries(periods).some(([key, v]) => !["day", "night"].includes(key) || !mode(v))) return null;
  }
  for (const [i, o] of p.overrides.entries()) {
    if (!o || !isValidManilaDate(o.from) || !isValidManilaDate(o.to) || o.to < o.from
      || !["day", "night"].includes(o.period) || !mode(o.mode)
      || p.overrides.slice(0, i).some(other => other.period === o.period && other.from <= o.to && other.to >= o.from)) return null;
  }
  return structuredClone(p);
}
export function swimmingAccessMode(policy: SwimmingPolicy, date: string, period: SwimmingPeriod): SwimmingAccessMode {
  const override = policy.overrides.find(o => o.period === period && o.from <= date && o.to >= date);
  return override?.mode ?? policy.weekly[String(new Date(`${date}T00:00:00Z`).getUTCDay())]?.[period] ?? policy.defaultMode;
}

export function swimmingBookingConflict(message: string | undefined): string | null {
  return message && /^(Public Only|Private Only|Booking Cutoff Passed|Same-day swimming bookings|Swimming session is disabled|Not Yet Open for Booking|Pool unavailable:|Unavailable — Maintenance|Private swimming conflicts with public swimming)/.test(message)
    ? `${message}. Return to the swimming calendar and choose another eligible session.` : null;
}

export type PrivateSwimmingCalendarSession = { booking_date: string; period: SwimmingPeriod; starts_at: string; ends_at: string; access_mode: SwimmingAccessMode; reason: string | null };
