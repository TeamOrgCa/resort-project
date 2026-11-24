import { calculateBookingDiscount, type PromoQuote } from "./discounts";
import { isValidGuestCounts } from "./guest-count";
import { isValidManilaDate } from "./manila-date";
import type { CustomerRoomService } from "./customer-rooms";

export type PublicSwimmingType = {
  type_id: string; mode: "day" | "night"; name: string; start_time: string; end_time: string;
  end_day_offset: number; adult_rate: number; child_rate: number; max_guests: number | null;
  pricing_version: number; is_active: boolean;
};
export type PublicSwimmingSlot = { date: string; typeId: string; startDatetime: string; endDatetime: string; remainingCapacity: number };
export type PublicSwimmingCatalog = { types: PublicSwimmingType[]; slots: PublicSwimmingSlot[]; dates: string[]; services: CustomerRoomService[] };
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
