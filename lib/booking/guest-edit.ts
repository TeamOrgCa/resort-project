import type { CatalogService, EditableReservation, SelectedService } from "./reservation-edit";
import type { PackageRates } from "./package-rates";
import { isValidGuestCounts } from "./guest-count";

export type GuestBookingEdit = { adultCount: number; childCount: number; services: { serviceId: string; quantity: number }[]; version: string; expectedTotal: number };
export type GuestEditDetail = {
  reservation: EditableReservation; services: SelectedService[]; catalogServices: CatalogService[];
  bill: { total_amount: number; paid_amount: number; status: string }; packageRates: PackageRates;
  version: string; lockedReason: string | null; canChangeGuests: boolean; canReduceServices: boolean;
};
export type GuestEditResult = { totalAmount: number; paidAmount: number; remainingBalance: number; overpaidAmount: number;
  adultCount: number; childCount: number; message: string;
  services: { serviceId: string; name: string; quantity: number; priceAtTime: number }[] };

export function parseGuestBookingEdit(value: unknown): GuestBookingEdit | null {
  if (!value || typeof value !== "object") return null;
  const b = value as GuestBookingEdit;
  if (!isValidGuestCounts(b.adultCount, b.childCount) || !Array.isArray(b.services) || b.services.length > 100 ||
    typeof b.version !== "string" || !/^[a-f0-9]{64}$/.test(b.version) ||
    !Number.isFinite(b.expectedTotal) || b.expectedTotal < 0 || b.expectedTotal > 99999999.99) return null;
  const seen = new Set<string>();
  for (const service of b.services) {
    if (!service || typeof service.serviceId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(service.serviceId) ||
      seen.has(service.serviceId.toLowerCase()) || !Number.isSafeInteger(service.quantity) || service.quantity < 1 || service.quantity > 10000) return null;
    seen.add(service.serviceId.toLowerCase());
  }
  return { adultCount: b.adultCount, childCount: b.childCount, version: b.version, expectedTotal: b.expectedTotal,
    services: b.services.map(s => ({ serviceId: s.serviceId.toLowerCase(), quantity: s.quantity })) };
}

export function guestEditRestriction(detail: GuestEditDetail, edit: GuestBookingEdit): string | null {
  if (detail.lockedReason) return detail.lockedReason;
  const r = detail.reservation;
  if (!detail.canChangeGuests && (edit.adultCount !== r.adult_count || edit.childCount !== r.child_count)) return "Guest counts can only be changed before check-in. Contact resort staff during your stay.";
  if (!detail.canReduceServices && detail.services.some(s => (edit.services.find(next => next.serviceId === s.service_id)?.quantity ?? 0) < s.quantity)) return "Services cannot be reduced or removed after full payment or after check-in. Contact resort staff.";
  return null;
}
