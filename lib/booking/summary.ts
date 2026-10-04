import { computeBookingPricing } from "@/lib/booking/pricing";
import type { BookingDraft } from "@/lib/stores/booking-store";

export function buildBookingCostSummary(draft: BookingDraft) {
  const total = Number(draft.total || 0);
  const tax = Number(draft.tax || 0);
  const servicesTotal = draft.services.reduce((sum, service) => sum + Number(service.price || 0), 0);
  const packageRate = Number(draft.roomPrice || 0);
  const hasDates = Boolean(draft.startDatetime && draft.endDatetime);
  const pricing = hasDates ? computeBookingPricing({
    bookingMode: draft.bookingMode,
    startDatetime: draft.startDatetime,
    endDatetime: draft.endDatetime,
    adultCount: draft.adultCount,
    childCount: draft.childCount,
    servicesTotal,
  }) : null;
  const matchesPackagePricing = Boolean(pricing
    && Math.abs(pricing.total - total) < 0.01
    && Math.abs(pricing.packageRate - packageRate) < 0.01);

  return {
    total,
    tax,
    servicesTotal,
    subtotal: total - tax,
    packageCharge: matchesPackagePricing ? packageRate : total - servicesTotal - tax,
    packageLabel: matchesPackagePricing ? "Private pool package" : "Package and guest charges",
    extraGuestCharge: matchesPackagePricing ? pricing!.extraGuestTotal : 0,
    extraGuests: matchesPackagePricing ? pricing!.extraGuests : null,
    includedGuests: matchesPackagePricing ? pricing!.includedGuests : null,
  };
}
