import type { SwimmingAccessMode, SwimmingPolicy } from "./swimming-sessions";
import { calculateBookingDiscount, type PromoQuote } from "./discounts";
import { isValidGuestCounts } from "./guest-count";
import { isValidManilaDate, manilaDateKey } from "./manila-date";
import type { CustomerRoomService } from "./customer-rooms";

export type PublicSwimmingType = {
  type_id: string; mode: "day" | "night"; name: string; start_time: string; end_time: string;
  end_day_offset: number; adult_rate: number; child_rate: number; max_guests: number | null;
  pricing_version: number; is_active: boolean;
};
export type PublicSwimmingSlot = { date: string; typeId: string; startDatetime: string; endDatetime: string; remainingCapacity: number; cutoffAt?: string };
export type PublicSwimmingAvailability = "available" | "private" | "maintenance" | "full" | "inactive" | "private_only" | "public";
export type PublicSwimmingEligibility = "eligible" | "past" | "not_open" | "cutoff" | "restricted";
export type PublicSwimmingSession = PublicSwimmingSlot & {
  availability: PublicSwimmingAvailability; eligibility: PublicSwimmingEligibility; opensAt: string; accessMode?: SwimmingAccessMode; totalCapacity?: number | null;
};
export type PublicSwimmingCatalog = {
  types: PublicSwimmingType[]; slots: PublicSwimmingSlot[]; dates: string[]; services: CustomerRoomService[];
  sessions: PublicSwimmingSession[]; today: string; now: string; policy?: SwimmingPolicy;
};
export const PUBLIC_SWIMMING_LEAD_MINUTES = 60;
export const PUBLIC_SWIMMING_LEAD_MESSAGE = "This public session has reached its configured booking cutoff. Return to the calendar to choose another session.";
export const isPublicSwimmingStartAllowed = (start: string, now = Date.now(), cutoffAt?: string) =>
  Number.isFinite(Date.parse(start)) && now <= (cutoffAt ? Date.parse(cutoffAt) : Date.parse(start) - PUBLIC_SWIMMING_LEAD_MINUTES * 60_000);
export function addPublicSwimmingDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
export function publicSwimmingDates(now = new Date(), days = 3) {
  const today = manilaDateKey(now);
  return Array.from({ length: days }, (_, i) => addPublicSwimmingDays(today, i));
}
export function publicSwimmingSessionLabel(session: PublicSwimmingSession) {
  if (session.eligibility === "past") return "Past Date";
  if (session.eligibility === "not_open") return "Not Yet Open for Booking";
  if (session.eligibility === "cutoff") return "Booking Cutoff Passed";
  if (session.availability === "available" && session.totalCapacity != null && session.remainingCapacity < session.totalCapacity) return "Partially Available";
  return publicSwimmingAvailabilityLabel(session.availability);
}
export function publicSwimmingAvailabilityLabel(availability: PublicSwimmingAvailability) {
  return { private_only: "Private Only", public: "Unavailable — Public Reservation", available: "Available", private: "Unavailable — Private Reservation", maintenance: "Unavailable — Maintenance", full: "Fully Booked", inactive: "Unavailable — Session Disabled" }[availability];
}
export function publicSwimmingDateLabel(sessions: PublicSwimmingSession[]) {
  if (!sessions.length) return "Loading availability";
  const eligible = sessions.filter(s => s.eligibility === "eligible" && s.availability === "available" && s.remainingCapacity > 0);
  if (eligible.length) return eligible.length === sessions.length && !eligible.some(s => s.totalCapacity != null && s.remainingCapacity < s.totalCapacity) ? "Available" : "Partially Available";
  if (sessions.every(s => s.eligibility === "past")) return "Past Date";
  if (sessions.every(s => s.eligibility === "not_open")) return "Not Yet Open for Booking";
  if (sessions.every(s => s.eligibility === "cutoff")) return "Booking Cutoff Passed";
  if (sessions.every(s => s.availability === "private_only")) return "Private Only";
  const remaining = sessions.filter(s => s.eligibility === "eligible");
  if (remaining.some(s => s.availability === "maintenance")) return "Unavailable — Maintenance";
  if (remaining.some(s => s.availability === "private")) return "Unavailable — Private Reservation";
  if (remaining.some(s => s.availability === "public")) return "Unavailable — Public Reservation";
  if (remaining.some(s => s.availability === "inactive")) return "Unavailable — Session Disabled";
  return "Fully Booked";
}
export function publicSwimmingWindow(date: string, type: PublicSwimmingType) {
  if (!isValidManilaDate(date)) throw new Error("Choose a valid public-swimming date.");
  const startDatetime = new Date(`${date}T${type.start_time}+08:00`).toISOString();
  const endDatetime = new Date(Date.parse(`${date}T${type.end_time}+08:00`) + type.end_day_offset * 86400000).toISOString();
  return { startDatetime, endDatetime };
}
export function publicSwimmingQuote(type: PublicSwimmingType, adults: number, children: number, eligible: number, promo: PromoQuote | null, servicesTotal: number) {
  if (!isValidGuestCounts(adults, children)) throw new Error("Choose at least one adult and up to 30 guests per booking.");
  if (!type.is_active || Number(type.adult_rate) <= 0 || Number(type.child_rate) < 0) throw new Error("Public-swimming rates are not available. Contact the resort.");
  const admission = Math.round((adults * Number(type.adult_rate) + children * Number(type.child_rate)) * 100) / 100;
  const discount = calculateBookingDiscount(admission, adults + children, eligible, promo);
  return { admission, discount, servicesTotal, total: Math.round((admission + servicesTotal - discount.amount) * 100) / 100 };
}
export function publicServiceCatalog(services: CustomerRoomService[], duration: number) {
  return services.map(service => ({ ...service, max_quantity: service.billing_type === "duration" ? Math.min(service.max_quantity ?? 10000, Math.floor(duration)) : service.max_quantity }));
}
