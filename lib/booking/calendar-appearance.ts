export const CALENDAR_COLORS = {
  pending: { label: "Pending payment", color: "#a16207" },
  payment_submitted: { label: "Payment submitted", color: "#c2410c" },
  confirmed: { label: "Confirmed", color: "#1d4ed8" },
  reschedule_requested: { label: "Reschedule requested", color: "#7e22ce" },
  completed: { label: "Completed", color: "#15803d" },
  cancelled: { label: "Cancelled", color: "#475569" },
  rejected: { label: "Rejected", color: "#854d0e" },
  ocular: { label: "Ocular visit", color: "#0e7490" },
  maintenance: { label: "Maintenance", color: "#4338ca" },
  closed: { label: "Other closed bookings", color: "#525252" },
} as const;
export type CalendarColorKey = keyof typeof CALENDAR_COLORS;
export type CalendarColors = Record<CalendarColorKey, string>;
export const DEFAULT_CALENDAR_COLORS = Object.fromEntries(Object.entries(CALENDAR_COLORS).map(([key, value]) => [key, value.color])) as CalendarColors;
export const URGENT_CALENDAR_COLOR = "#b91c1c";

export function readCalendarColors(value: unknown): CalendarColors {
  const colors = { ...DEFAULT_CALENDAR_COLORS };
  if (value && typeof value === "object") for (const key of Object.keys(colors) as CalendarColorKey[]) {
    const color = (value as Record<string, unknown>)[key];
    if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) colors[key] = color;
  }
  return colors;
}

/** Keep labels readable even when a staff member chooses a very light color. */
export function calendarTextColor(color: string): string {
  const channels = [1, 3, 5].map(offset => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179 ? "#111111" : "#ffffff";
}
