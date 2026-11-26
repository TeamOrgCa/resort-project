import { computeBookingPricing } from "@/lib/booking/pricing";
import type { BookingDraft } from "@/lib/stores/booking-store";
import { calculateBookingDiscount } from "@/lib/booking/discounts";

export function buildBookingCostSummary(draft: BookingDraft) {
  const total = Number(draft.total || 0);
  const tax = Number(draft.tax || 0);
  const servicesTotal = draft.services.reduce((sum, service) => sum + Number(service.price || 0) * (service.quantity ?? 1), 0);
  const roomsTotal = draft.commercialType === "room_accommodation" ? 0 : (draft.swimmingRooms ?? []).reduce((sum, r) => sum + Number(r.unitPrice || 0) * r.quantity, 0);
  const savedDiscount = draft.discountAmount !== undefined && draft.discountKind !== undefined ? { amount: draft.discountAmount, kind: draft.discountKind } : null;
  if (draft.commercialType === "public_swimming") {
    const admission = Number(draft.roomPrice || 0);
    const discount = savedDiscount ?? calculateBookingDiscount(admission, Math.max(1, draft.adultCount + draft.childCount), draft.eligibleGuests ?? 0, draft.promo);
    return { total, tax, servicesTotal, roomsTotal, discountAmount: draft.discountAmount ?? discount.amount, discountKind: draft.discountKind ?? discount.kind,
      promoCode: (draft.discountKind ?? discount.kind) === "promo" ? draft.promo?.code ?? null : null,
      subtotal: admission + servicesTotal + roomsTotal, packageCharge: admission, packageLabel: "Public swimming admission", extraGuestCharge: 0, extraGuests: null, includedGuests: null };
  }
  if (draft.commercialType === "room_accommodation") {
    const rooms = draft.roomSelections ?? [];
    const accommodation = rooms.reduce((sum, r) => sum + Number(r.accommodation ?? 0), 0);
    const extraGuestCharge = rooms.reduce((sum, r) => sum + Number(r.additionalGuestCharge ?? 0), 0);
    const discount = savedDiscount ?? calculateBookingDiscount(accommodation, Math.max(1, draft.adultCount + draft.childCount), draft.eligibleGuests ?? 0, draft.promo);
    return { total, tax, servicesTotal, roomsTotal, discountAmount: draft.discountAmount ?? discount.amount, discountKind: draft.discountKind ?? discount.kind,
      promoCode: (draft.discountKind ?? discount.kind) === "promo" ? draft.promo?.code ?? null : null,
      subtotal: accommodation + extraGuestCharge + servicesTotal, packageCharge: accommodation, packageLabel: "Room accommodation",
      extraGuestCharge, extraGuests: rooms.reduce((sum, r) => sum + Math.max(0, r.occupants - (r.includedCapacity ?? r.occupants)), 0), includedGuests: null };
  }
  const packageRate = Number(draft.roomPrice || 0);
  const discount = savedDiscount ?? calculateBookingDiscount(packageRate,
    Math.max(1, Number(draft.adultCount || 0) + Number(draft.childCount || 0)), draft.eligibleGuests ?? 0, draft.promo);
  const discountAmount = draft.discountAmount ?? discount.amount;
  const discountKind = draft.discountKind ?? discount.kind;
  const grossTotal = total + discountAmount;
  const hasDates = Boolean(draft.startDatetime && draft.endDatetime);
  const pricing = hasDates && draft.packageRates ? computeBookingPricing({
    bookingMode: draft.bookingMode,
    startDatetime: draft.startDatetime,
    endDatetime: draft.endDatetime,
    adultCount: draft.adultCount,
    childCount: draft.childCount,
    servicesTotal,
  }, draft.packageRates) : null;
  const matchesPackagePricing = Boolean(pricing
    && Math.abs(pricing.total + roomsTotal - grossTotal) < 0.01
    && Math.abs(pricing.packageRate - packageRate) < 0.01);

  return {
    total,
    tax,
    servicesTotal,
    roomsTotal,
    discountAmount,
    discountKind,
    promoCode: discountKind === "promo" ? draft.promo?.code ?? draft.promoCode ?? null : null,
    subtotal: grossTotal - tax,
    packageCharge: matchesPackagePricing ? packageRate : grossTotal - servicesTotal - roomsTotal - tax,
    packageLabel: matchesPackagePricing ? "Private pool package" : "Package and guest charges",
    extraGuestCharge: matchesPackagePricing ? pricing!.extraGuestTotal : 0,
    extraGuests: matchesPackagePricing ? pricing!.extraGuests : null,
    includedGuests: matchesPackagePricing ? pricing!.includedGuests : null,
  };
}
