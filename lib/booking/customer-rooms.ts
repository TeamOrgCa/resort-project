import type { RoomClass } from "@/lib/rooms/types";
import { calculateBookingDiscount, type PromoQuote } from "./discounts";
import { isWindowAvailable, type ReservedWindow } from "./availability";

export type CustomerRoomSelection = {
  classificationId: string; occupants: number; pricingVersion: number; name?: string;
  accommodation?: number; additionalGuestCharge?: number;
  includedCapacity?: number;
};
export type CustomerRoomInventory = { room_id: string; classification_id: string; unavailable: boolean; blocks: ReservedWindow[] };
export type CustomerRoomService = { service_id: string; name: string; price: number; description: string | null; image_url: string | null; max_quantity: number; billing_type: "quantity" | "duration" | "person" | "fixed" };
export type CustomerRoomCatalog = { classifications: RoomClass[]; rooms: CustomerRoomInventory[]; services: CustomerRoomService[]; maxBookingDate?: string };
export const availableRoomCount = (catalog: CustomerRoomCatalog, classificationId: string, start: string, end: string) =>
  catalog.rooms.filter(r => r.classification_id === classificationId && !r.unavailable && isWindowAvailable(start, end, r.blocks)).length;

export function customerRoomQuote(classes: RoomClass[], rooms: CustomerRoomSelection[], duration: number, eligible: number, promo: PromoQuote | null, servicesTotal: number) {
  if (![3, 12].includes(duration) || !rooms.length || rooms.length > 20) throw new Error("Select a 3-hour or 12-hour stay and at least one room.");
  let accommodation = 0, additionalGuests = 0, headCount = 0;
  const selections = rooms.map(room => {
    const c = classes.find(c => c.classification_id === room.classificationId);
    if (!c || c.pricing_version !== room.pricingVersion) throw new Error("Refresh room availability to review the current prices.");
    if (!Number.isSafeInteger(room.occupants) || room.occupants < 1 || room.occupants > c.maximum_capacity) throw new Error("Check the number of guests in each room.");
    if (room.occupants > c.included_capacity && Number(c.additional_guest_rate) <= 0) throw new Error("Additional guest pricing is not configured for this room. Choose fewer guests or another room.");
    const base = Number(duration === 3 ? c.rate_3_hours : c.rate_12_hours), extra = Math.max(0, room.occupants - c.included_capacity) * Number(c.additional_guest_rate);
    if (!Number.isFinite(base) || base <= 0) throw new Error("Room pricing is unavailable. Please refresh.");
    accommodation += base; additionalGuests += extra; headCount += room.occupants;
    return { ...room, name: c.name, accommodation: base, additionalGuestCharge: extra, includedCapacity: c.included_capacity };
  });
  if (headCount > 30) throw new Error("A booking can include up to 30 guests. Please contact the resort for a larger group.");
  const discount = calculateBookingDiscount(accommodation, headCount, eligible, promo);
  const gross = Math.round((accommodation + additionalGuests + servicesTotal) * 100) / 100;
  return { selections, headCount, accommodation, additionalGuests, servicesTotal, discount, gross, total: Math.round((gross - discount.amount) * 100) / 100 };
}
