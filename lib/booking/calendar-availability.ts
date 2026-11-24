import { buildBookingWindow } from "./policy";
import { DEFAULT_PACKAGE_TIMES, type PackageTimes } from "./package-times";
import { isStaffBookingWindowAllowed } from "./start-time";
import { isWindowAvailable, type ReservedWindow } from "./availability";
import { maintenanceOverlaps, type MaintenanceWindow } from "./maintenance";
import { manilaDateKey } from "./manila-date";

type SlotStatus = "available" | "booked" | "started" | "maintenance";
type ReservationWindow = ReservedWindow & { status: string; payment_deadline_at?: string | null; commercial_type?: string; room_pricing?: boolean };

export function calendarAvailability(date: string, reservations: ReservationWindow[], blocks: (MaintenanceWindow & { status: string })[], now: number, times: PackageTimes = DEFAULT_PACKAGE_TIMES) {
  const active = reservations.filter(row => row.commercial_type !== "room_accommodation" && !(row.commercial_type === "public_swimming" && row.room_pricing) && ["pending", "payment_submitted", "confirmed", "reschedule_requested"].includes(row.status)
    && !(row.status === "pending" && row.payment_deadline_at && Date.parse(row.payment_deadline_at) <= now));
  const slot = (mode: "day" | "night" | "whole_day", variant: "day_to_night" | "night_to_day" = "day_to_night"): SlotStatus => {
    const window = buildBookingWindow({ bookingMode: mode, date, wholeDayVariant: variant, packageTimes: times });
    const start = window.startDatetime!, end = window.endDatetime!;
    if (!isStaffBookingWindowAllowed(start, end, now)) return "started";
    if (blocks.some(block => block.status === "active" && maintenanceOverlaps(start, end, block))) return "maintenance";
    return isWindowAvailable(start, end, active) ? "available" : "booked";
  };
  const dayStatus = slot("day"), nightStatus = slot("night");
  const statuses = [dayStatus, nightStatus, slot("whole_day"), slot("whole_day", "night_to_day")];
  const day = dayStatus === "available", night = nightStatus === "available", whole = statuses.slice(2).includes("available");
  const unavailable = (status: SlotStatus) => status === "started" ? "start time passed" : status === "maintenance" ? "maintenance" : "booked";
  const label = date < manilaDateKey(new Date(now)) ? "Past date"
    : day && night ? "Day and night available"
    : day ? `Day available · Night ${unavailable(nightStatus)}`
    : night ? `Night available · Day ${unavailable(dayStatus)}`
    : whole ? "Whole day available"
    : statuses.every(status => status === "started") ? "Booking start times passed"
    : statuses.includes("maintenance") ? "Maintenance blocked"
    : "Fully booked";
  return { day, night, whole, label };
}
