import { isValidGuestCounts } from "@/lib/booking/guest-count";
import { validateBookingWindow, type BookingMode } from "@/lib/booking/policy";
import { computeBookingPricing } from "@/lib/booking/pricing";

export const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export type ServiceChoice = { serviceId: string; quantity: number };
export type ReservationEdit = {
  bookingMode: BookingMode; startDatetime: string; endDatetime: string;
  adultCount: number; childCount: number; unitId: string | null;
  specialRequests: string; services: ServiceChoice[]; reason: string;
  version: string; expectedTotal: number;
};
export type EditableReservation = {
  reservation_id: string; reference_number: string; status: string; booking_mode: BookingMode;
  start_datetime: string; end_datetime: string; adult_count: number; child_count: number;
  special_requests: string | null; updated_at: string; payment_deadline_at: string | null;
  guest_id: string | null; walk_in_guest_id: string | null; booking_type: string;
};
export type SelectedService = { service_id: string; quantity: number; price_at_time: number };
export type SelectedUnit = { unit_id: string; quantity: number; price_per_night: number };
export type CatalogService = { service_id: string; name: string; price: number; is_active: boolean };
export type CatalogUnit = { unit_id: string; name: string; base_price: number; is_active: boolean; archived_at: string | null };
export type Bill = { total_amount: number; paid_amount: number; status: string };
export type EditDetail = {
  reservation: EditableReservation; guest: { first_name: string; last_name: string; email: string | null; phone_number: string | null } | null;
  services: SelectedService[]; units: SelectedUnit[]; catalogServices: CatalogService[]; catalogUnits: CatalogUnit[];
  bill: Bill; version: string; canEdit: boolean; canChangeDetails: boolean; lockedReason: string | null;
};
export const moneyRound = (n: number) => Math.round(n * 100) / 100;

export function parseReservationEdit(value: unknown): ReservationEdit | null {
  if (!value || typeof value !== "object") return null;
  const b = value as ReservationEdit;
  if (!["day", "night", "whole_day", "custom"].includes(b.bookingMode) ||
    typeof b.startDatetime !== "string" || typeof b.endDatetime !== "string" ||
    !Number.isFinite(Date.parse(b.startDatetime)) || !Number.isFinite(Date.parse(b.endDatetime)) ||
    !isValidGuestCounts(b.adultCount, b.childCount) ||
    (b.unitId !== null && (typeof b.unitId !== "string" || !uuidPattern.test(b.unitId))) ||
    typeof b.specialRequests !== "string" || b.specialRequests.length > 5000 ||
    typeof b.reason !== "string" || !b.reason.trim() || b.reason.length > 1000 ||
    typeof b.version !== "string" || !/^[a-f0-9]{64}$/.test(b.version) ||
    !Number.isFinite(b.expectedTotal) || b.expectedTotal < 0 ||
    !Array.isArray(b.services) || b.services.length > 100) return null;
  const seen = new Set<string>();
  for (const s of b.services) {
    if (!s || typeof s.serviceId !== "string" || !uuidPattern.test(s.serviceId) ||
      !Number.isSafeInteger(s.quantity) || s.quantity < 1 || s.quantity > 10000 || seen.has(s.serviceId.toLowerCase())) return null;
    seen.add(s.serviceId.toLowerCase());
  }
  return { bookingMode: b.bookingMode, adultCount: b.adultCount, childCount: b.childCount,
    version: b.version, expectedTotal: moneyRound(b.expectedTotal),
    startDatetime: new Date(b.startDatetime).toISOString(), endDatetime: new Date(b.endDatetime).toISOString(),
    unitId: b.unitId?.toLowerCase() ?? null, services: b.services.map(s => ({ serviceId: s.serviceId.toLowerCase(), quantity: s.quantity })),
    specialRequests: b.specialRequests.trim(), reason: b.reason.trim() };
}

export function reservationEditAccess(r: EditableReservation, pendingPayment: boolean, pendingReschedule: boolean, now = Date.now()) {
  let lockedReason: string | null = null;
  if (!["pending", "confirmed"].includes(r.status)) lockedReason = "Only pending or confirmed reservations can be edited.";
  else if (r.status === "pending" && r.payment_deadline_at && Date.parse(r.payment_deadline_at) <= now) lockedReason = "This reservation's payment hold has expired.";
  else if (Date.parse(r.end_datetime) <= now) lockedReason = "This stay has ended. Reservation details are read-only.";
  else if (pendingPayment) lockedReason = "Finish reviewing the pending payment before editing this reservation.";
  else if (pendingReschedule) lockedReason = "Resolve the pending reschedule request before editing this reservation.";
  return { lockedReason, canChangeDetails: !lockedReason && Date.parse(r.start_datetime) > now };
}

export function detailsChanged(r: EditableReservation, edit: ReservationEdit) {
  return r.booking_mode !== edit.bookingMode || Date.parse(r.start_datetime) !== Date.parse(edit.startDatetime) ||
    Date.parse(r.end_datetime) !== Date.parse(edit.endDatetime) || r.adult_count !== edit.adultCount || r.child_count !== edit.childCount;
}

export function validateEditWindow(edit: ReservationEdit) {
  const clock = (v: string) => new Date(Date.parse(v) + 8 * 3600000).toISOString().slice(11, 16);
  return validateBookingWindow({ ...edit, wholeDayVariant: "day_to_night", customStartTime: clock(edit.startDatetime), customEndTime: clock(edit.endDatetime) });
}

// Apply the package difference to the recorded bill. This retains historical
// discounts, reschedule fees and negotiated charges, including on service-only edits.
export function previewReservationEdit(r: EditableReservation, bill: Bill, existing: SelectedService[], catalog: CatalogService[], edit: Pick<ReservationEdit, "bookingMode" | "startDatetime" | "endDatetime" | "adultCount" | "childCount" | "services">) {
  const priceInput = { bookingMode: r.booking_mode ?? "day", startDatetime: r.start_datetime, endDatetime: r.end_datetime, adultCount: r.adult_count, childCount: r.child_count };
  const changed = priceInput.bookingMode !== edit.bookingMode || Date.parse(priceInput.startDatetime) !== Date.parse(edit.startDatetime) ||
    Date.parse(priceInput.endDatetime) !== Date.parse(edit.endDatetime) || priceInput.adultCount !== edit.adultCount || priceInput.childCount !== edit.childCount;
  const packageDelta = changed ? moneyRound(computeBookingPricing({ ...edit, servicesTotal: 0 }).total - computeBookingPricing(priceInput).total) : 0;
  const oldServices = existing.reduce((sum, s) => sum + s.quantity * Number(s.price_at_time), 0);
  const newServices = edit.services.reduce((sum, s) => {
    const old = existing.find(e => e.service_id === s.serviceId);
    const listed = catalog.find(e => e.service_id === s.serviceId);
    if (!old && (!listed || !listed.is_active)) throw new Error("A selected service is no longer available. Reload the reservation.");
    return sum + s.quantity * Number(old?.price_at_time ?? listed!.price);
  }, 0);
  const total = moneyRound(Number(bill.total_amount) + packageDelta + newServices - oldServices);
  return { packageDelta, servicesTotal: moneyRound(newServices), total,
    paid: Number(bill.paid_amount), balance: moneyRound(Math.max(0, total - Number(bill.paid_amount))),
    overpaid: moneyRound(Math.max(0, Number(bill.paid_amount) - total)) };
}
