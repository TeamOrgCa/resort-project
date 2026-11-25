import { calculateBookingDiscount, type PromoQuote } from "@/lib/booking/discounts";
import type { RoomClass } from "./types";

export function roomStayQuote(c: RoomClass, duration: number, extensionHours: number, occupants: number, eligible: number, promo: PromoQuote | null) {
  if (![3, 12].includes(duration) || !Number.isSafeInteger(extensionHours) || extensionHours < 0 || extensionHours > 168 ||
    !Number.isSafeInteger(occupants) || occupants < 1 || occupants > c.maximum_capacity) throw new Error("Choose a valid stay duration, extension and guest count.");
  const accommodation = Number(duration === 3 ? c.rate_3_hours : c.rate_12_hours);
  if (!Number.isFinite(accommodation) || accommodation <= 0 || !Number.isSafeInteger(c.pricing_version)) throw new Error("Room rates are unavailable. Apply the room rates migration and refresh.");
  const additionalGuests = Math.round(Math.max(0, occupants - c.included_capacity) * Number(c.additional_guest_rate) * 100) / 100;
  const extension = Math.round(extensionHours * Number(c.extension_hourly_rate) * 100) / 100;
  const discount = calculateBookingDiscount(accommodation, occupants, eligible, promo);
  return { accommodation, additionalGuests, extension, discount, total: Math.round((accommodation + additionalGuests + extension - discount.amount) * 100) / 100 };
}

/** Apply a booking discount once to the combined accommodation charge. */
export function roomReservationQuote(rooms: { classification: RoomClass; occupants: number }[], duration: number, extensionHours: number, eligible: number, promo: PromoQuote | null) {
  if (!rooms.length || rooms.length > 100) throw new Error("Select at least one room.");
  const lines = rooms.map(room => roomStayQuote(room.classification, duration, extensionHours, room.occupants, 0, null));
  const occupants = rooms.reduce((sum, room) => sum + room.occupants, 0);
  if (occupants > 100) throw new Error("A manual room reservation can include up to 100 guests.");
  const sum = (key: "accommodation" | "additionalGuests" | "extension") => Math.round(lines.reduce((total, line) => total + line[key], 0) * 100) / 100;
  const accommodation = sum("accommodation"), additionalGuests = sum("additionalGuests"), extension = sum("extension");
  const discount = calculateBookingDiscount(accommodation, occupants, eligible, promo);
  return { accommodation, additionalGuests, extension, discount, total: Math.round((accommodation + additionalGuests + extension - discount.amount) * 100) / 100 };
}
