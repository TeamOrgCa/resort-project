export const COMMERCIAL_TYPES = {
  private_swimming: "Private Swimming",
  public_swimming: "Public Swimming",
  room_accommodation: "Room Accommodation",
} as const;
export type CommercialType = keyof typeof COMMERCIAL_TYPES;
export function commercialTypeLabel(value?: string | null) {
  return COMMERCIAL_TYPES[value as CommercialType] ?? COMMERCIAL_TYPES.private_swimming;
}
export function requiresFullBookingPayment(value?: string | null) {
  return value === "public_swimming" || value === "room_accommodation";
}
