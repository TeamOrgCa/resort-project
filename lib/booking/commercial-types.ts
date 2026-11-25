export const COMMERCIAL_TYPES = {
  private_swimming: "Private Swimming",
  public_swimming: "Public Swimming",
  room_accommodation: "Room Accommodation",
} as const;
export type CommercialType = keyof typeof COMMERCIAL_TYPES;
export type ReservationTypeFilter = CommercialType | "all";
export function isReservationTypeFilter(value: string): value is ReservationTypeFilter {
  return value === "all" || Object.hasOwn(COMMERCIAL_TYPES, value);
}
export function reservationTypeFilterLabel(value: ReservationTypeFilter) {
  return value === "all" ? "All reservation types" : COMMERCIAL_TYPES[value];
}
export function matchesReservationType(value: string | null | undefined, filter: ReservationTypeFilter) {
  return filter === "all" || (value ?? "private_swimming") === filter;
}
/** Older standalone room sales belong to accommodation; pool/cottage sales belong to public swimming. */
export function standaloneSaleType(accessType: string): CommercialType {
  return accessType === "room" ? "room_accommodation" : "public_swimming";
}
export function commercialTypeLabel(value?: string | null) {
  return COMMERCIAL_TYPES[value as CommercialType] ?? COMMERCIAL_TYPES.private_swimming;
}
export function requiresFullBookingPayment(value?: string | null) {
  return value === "public_swimming" || value === "room_accommodation";
}
