import type { CustomerRoomCatalog } from "./customer-rooms";
import { availableRoomCount } from "./customer-rooms";
import type { RoomClass } from "@/lib/rooms/types";

export const PRIVATE_SWIMMING_INCLUDED_ROOMS = 2;
export type SwimmingRoomSelection = { classificationId: string; quantity: number; pricingVersion: number; occupants?: number; durationHours?: number; name?: string; unitPrice?: number; accommodation?: number; additionalGuestCharge?: number; extraGuests?: number; baseHours?: number; baseRate?: number; extensionHours?: number; extensionHourlyRate?: number; extensionCharge?: number };
export function parseSwimmingRooms(value: unknown): SwimmingRoomSelection[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) return null;
  const seen = new Map<string, boolean>(), rooms: SwimmingRoomSelection[] = [];
  for (const room of value) {
    if (!room || typeof room.classificationId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(room.classificationId)
      || !Number.isSafeInteger(room.quantity) || room.quantity < 1 || room.quantity > 20
      || !Number.isSafeInteger(room.pricingVersion) || room.pricingVersion < 1) return null;
    const individual = room.occupants !== undefined || room.durationHours !== undefined;
    const classificationId = room.classificationId.toLowerCase();
    if (individual && (room.quantity !== 1 || (typeof room.durationHours !== "number" || !Number.isSafeInteger(room.durationHours) || room.durationHours < 3 || room.durationHours > 24) || !Number.isSafeInteger(room.occupants) || room.occupants < 1 || room.occupants > 100)) return null;
    if (seen.has(classificationId) && (!individual || seen.get(classificationId) === false)) return null;
    seen.set(classificationId, individual);
    rooms.push({ classificationId, quantity: room.quantity, pricingVersion: room.pricingVersion,
      ...(individual ? { occupants: room.occupants, durationHours: room.durationHours } : {}) });
  }
  return rooms.reduce((sum, r) => sum + r.quantity, 0) <= 20 ? rooms : null;
}
export function swimmingRoomEnd(start: string, end: string, room: SwimmingRoomSelection) {
  return room.durationHours === undefined || room.durationHours === (Date.parse(end) - Date.parse(start)) / 3600000 ? end : new Date(Date.parse(start) + room.durationHours * 3600000).toISOString();
}
export function swimmingRoomDurationLabel(hours: number) {
  const minutes = Math.round(hours * 60), wholeHours = Math.floor(minutes / 60), remaining = minutes % 60;
  return remaining === 0 ? `${wholeHours} hours` : wholeHours === 0 ? `${remaining} minutes` : `${wholeHours} hours ${remaining} minutes`;
}
export function swimmingRoomDescription(room: SwimmingRoomSelection, index: number) {
  return room.durationHours === undefined ? `${room.name} × ${room.quantity}` : `Room ${index + 1}: ${room.name} · ${swimmingRoomDurationLabel(room.durationHours)} · ${room.occupants} guest(s)`;
}
export function swimmingRoomPrice(c: RoomClass, start: string, end: string) {
  const hours = (Date.parse(end) - Date.parse(start)) / 3600000;
  if (!(hours > 0 && hours <= 24)) throw new Error("Choose a swimming session of up to 24 hours for room add-ons.");
  const rate = hours <= 3 ? c.rate_3_hours : hours <= 8 ? c.rate_8_hours : c.rate_12_hours;
  if (hours > 3 && hours <= 8 && rate == null) throw new Error("The 8-hour room rate is not configured. Please contact the resort.");
  const amount = Number(rate) + Math.max(0, Math.ceil(hours - 12)) * Number(c.extension_hourly_rate);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Room rates are unavailable. Please refresh.");
  return Math.round(amount * 100) / 100;
}
export function swimmingRoomStayPrice(c: RoomClass, hours: number) {
  if (!Number.isSafeInteger(hours) || hours < 3 || hours > 24) throw new Error("Choose whole room hours within your swimming stay (3 to 24 hours).");
  const baseHours = hours >= 12 ? 12 : hours >= 8 ? 8 : 3;
  const rate = c[baseHours === 3 ? "rate_3_hours" : baseHours === 8 ? "rate_8_hours" : "rate_12_hours"];
  if (rate == null || !Number.isFinite(Number(rate)) || Number(rate) <= 0) throw new Error(`The ${baseHours}-hour room rate is not configured. Please contact the resort.`);
  const baseRate = Number(rate), extensionHours = Math.max(0, Math.ceil(hours - baseHours)), extensionHourlyRate = Number(c.extension_hourly_rate);
  if (extensionHours > 0 && (!Number.isFinite(extensionHourlyRate) || extensionHourlyRate <= 0)) throw new Error("The hourly room extension rate is not configured. Please contact the resort.");
  const extensionCharge = Math.round(extensionHours * (extensionHours > 0 ? extensionHourlyRate : 0) * 100) / 100;
  return { baseHours, baseRate, extensionHours, extensionHourlyRate, extensionCharge, accommodation: Math.round((baseRate + extensionCharge) * 100) / 100 };
}
export function swimmingRoomsQuote(catalog: CustomerRoomCatalog, rooms: SwimmingRoomSelection[], start: string, end: string, privateSwimming: boolean, guestCount?: number) {
  if (rooms.length > 20 || rooms.some(room => !Number.isSafeInteger(room.quantity) || room.quantity < 1) || rooms.reduce((sum, room) => sum + room.quantity, 0) > 20) throw new Error("Choose up to 20 additional rooms.");
  if (guestCount !== undefined && (!Number.isSafeInteger(guestCount) || guestCount < 1 || rooms.reduce((sum, room) => sum + (room.occupants ?? 0) * room.quantity, 0) > guestCount)) throw new Error("Guests across additional rooms cannot exceed the booking's total number of guests. Review your room guest counts.");
  const standard = catalog.classifications.find(c => c.code === "standard");
  if (privateSwimming && (!standard || availableRoomCount(catalog, standard.classification_id, start, end, true) < PRIVATE_SWIMMING_INCLUDED_ROOMS)) {
    throw new Error("The two included Standard rooms are unavailable for this session. Choose another date or contact the resort.");
  }
  const selections = rooms.map(room => {
    const c = catalog.classifications.find(c => c.classification_id === room.classificationId);
    if (!c || Number(c.pricing_version) !== room.pricingVersion) throw new Error("Room rates changed. Refresh your room choices.");
    const individual = room.durationHours !== undefined || room.occupants !== undefined;
    if (individual && (room.quantity !== 1 || typeof room.durationHours !== "number" || !Number.isSafeInteger(room.durationHours) || room.durationHours < 3 || room.durationHours > 24 || !Number.isSafeInteger(room.occupants) || room.occupants! < 1 || room.occupants! > c.maximum_capacity)) throw new Error(`Choose valid guests and whole room hours (minimum 3) within your swimming stay for ${c.name}.`);
    const roomEnd = swimmingRoomEnd(start, end, room);
    if (Date.parse(roomEnd) > Date.parse(end)) throw new Error("Additional rooms must end within the swimming session. Choose a shorter room duration.");
    const stay = individual ? swimmingRoomStayPrice(c, room.durationHours!) : null;
    const accommodation = stay?.accommodation ?? swimmingRoomPrice(c, start, roomEnd);
    const extraGuests = individual ? Math.max(0, room.occupants! - c.included_capacity) : 0;
    const extraRate = Number(c.additional_guest_rate);
    if (extraGuests > 0 && (!Number.isFinite(extraRate) || extraRate < 0)) throw new Error(`Additional guest rates are unavailable for ${c.name}.`);
    const additionalGuestCharge = Math.round(extraGuests * (extraGuests ? extraRate : 0) * 100) / 100;
    return { ...room, name: c.name, unitPrice: Math.round((accommodation + additionalGuestCharge) * 100) / 100,
      ...(individual ? { ...stay!, accommodation, additionalGuestCharge, extraGuests } : {}) };
  });
  const used = new Map<string, number>();
  for (const room of [...selections].sort((a, b) => Date.parse(swimmingRoomEnd(start, end, b)) - Date.parse(swimmingRoomEnd(start, end, a)))) {
    const count = (used.get(room.classificationId) ?? 0) + room.quantity;
    used.set(room.classificationId, count);
    if (count > availableRoomCount(catalog, room.classificationId, start, swimmingRoomEnd(start, end, room))) throw new Error(`Not enough ${room.name} are available for the selected room durations.`);
  }
  return { selections, total: Math.round(selections.reduce((sum, r) => sum + r.quantity * r.unitPrice, 0) * 100) / 100 };
}
