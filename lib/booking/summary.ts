import { computeBookingPricing } from "@/lib/booking/pricing";
import type { BookingDraft } from "@/lib/stores/booking-store";
import { calculateBookingDiscount } from "@/lib/booking/discounts";

export function buildBookingCostSummary(draft: BookingDraft) {
  const total = Number(draft.total || 0);
  const tax = Number(draft.tax || 0);
  const servicesTotal = draft.services.reduce((sum, service) => sum + Number(service.price || 0) * (service.quantity ?? 1), 0);
  const packageRate = Number(draft.roomPrice || 0);
  const discountAmount = draft.promo ? calculateBookingDiscount(packageRate,
    Math.max(1, Number(draft.adultCount || 0) + Number(draft.childCount || 0)), 0, draft.promo).amount : 0;
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
    && Math.abs(pricing.total - grossTotal) < 0.01
    && Math.abs(pricing.packageRate - packageRate) < 0.01);

  return {
    total,
    tax,
    servicesTotal,
    discountAmount,
    promoCode: draft.promo?.code ?? null,
    subtotal: grossTotal - tax,
    packageCharge: matchesPackagePricing ? packageRate : grossTotal - servicesTotal - tax,
    packageLabel: matchesPackagePricing ? "Private pool package" : "Package and guest charges",
    extraGuestCharge: matchesPackagePricing ? pricing!.extraGuestTotal : 0,
    extraGuests: matchesPackagePricing ? pricing!.extraGuests : null,
    includedGuests: matchesPackagePricing ? pricing!.includedGuests : null,
  };
}
