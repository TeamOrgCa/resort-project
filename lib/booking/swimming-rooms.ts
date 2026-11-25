import type { CustomerRoomCatalog } from "./customer-rooms";
import { availableRoomCount } from "./customer-rooms";
import type { RoomClass } from "@/lib/rooms/types";

export const PRIVATE_SWIMMING_INCLUDED_ROOMS = 2;
export type SwimmingRoomSelection = { classificationId: string; quantity: number; pricingVersion: number; name?: string; unitPrice?: number };
export function parseSwimmingRooms(value: unknown): SwimmingRoomSelection[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) return null;
  const seen = new Set<string>(), rooms: SwimmingRoomSelection[] = [];
  for (const room of value) {
    if (!room || typeof room.classificationId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(room.classificationId)
      || seen.has(room.classificationId.toLowerCase()) || !Number.isSafeInteger(room.quantity) || room.quantity < 1 || room.quantity > 20
      || !Number.isSafeInteger(room.pricingVersion) || room.pricingVersion < 1) return null;
    seen.add(room.classificationId.toLowerCase());
    rooms.push({ classificationId: room.classificationId.toLowerCase(), quantity: room.quantity, pricingVersion: room.pricingVersion });
  }
  return rooms.reduce((sum, r) => sum + r.quantity, 0) <= 20 ? rooms : null;
}
export function swimmingRoomPrice(c: RoomClass, start: string, end: string) {
  const hours = (Date.parse(end) - Date.parse(start)) / 3600000;
  if (!(hours > 0 && hours <= 24)) throw new Error("Choose a swimming session of up to 24 hours for room add-ons.");
  const amount = Number(hours <= 3 ? c.rate_3_hours : c.rate_12_hours) + Math.max(0, Math.ceil(hours - 12)) * Number(c.extension_hourly_rate);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Room rates are unavailable. Please refresh.");
  return Math.round(amount * 100) / 100;
}
export function swimmingRoomsQuote(catalog: CustomerRoomCatalog, rooms: SwimmingRoomSelection[], start: string, end: string, privateSwimming: boolean) {
  const standard = catalog.classifications.find(c => c.code === "standard");
  if (privateSwimming && (!standard || availableRoomCount(catalog, standard.classification_id, start, end, true) < PRIVATE_SWIMMING_INCLUDED_ROOMS)) {
    throw new Error("The two included Standard rooms are unavailable for this session. Choose another date or contact the resort.");
  }
  const selections = rooms.map(room => {
    const c = catalog.classifications.find(c => c.classification_id === room.classificationId);
    if (!c || Number(c.pricing_version) !== room.pricingVersion) throw new Error("Room rates changed. Refresh your room choices.");
    if (room.quantity > availableRoomCount(catalog, c.classification_id, start, end)) throw new Error(`Not enough ${c.name} are available for this session.`);
    return { ...room, name: c.name, unitPrice: swimmingRoomPrice(c, start, end) };
  });
  return { selections, total: Math.round(selections.reduce((sum, r) => sum + r.quantity * r.unitPrice, 0) * 100) / 100 };
}
