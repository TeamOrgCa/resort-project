import { BookingMode } from "@/lib/booking/policy";
import { downPaymentAmount } from "@/lib/booking/payment-policy";
import { isManilaWeekend, manilaHour } from "@/lib/booking/manila-date";
import { INCLUDED_GUESTS } from "@/lib/booking/guest-count";
import type { RateTier, PackageMode, PackageRates } from "@/lib/booking/package-rates";

export interface BookingPricingInput {
  bookingMode: BookingMode;
  startDatetime: string;
  endDatetime: string;
  adultCount: number;
  childCount: number;
  servicesTotal?: number;
}

export interface BookingPricingResult {
  rateTier: RateTier;
  packageMode: PackageMode;
  packageRate: number;
  addOnPerHead: number;
  includedGuests: number;
  totalGuests: number;
  extraGuests: number;
  extraGuestTotal: number;
  servicesTotal: number;
  subtotal: number;
  tax: number;
  total: number;
  downPaymentMin: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

const getRateTier = (startDate: Date): RateTier => {
  return isManilaWeekend(startDate) ? "weekend" : "weekday";
};

const durationHours = (start: Date, end: Date) => (end.getTime() - start.getTime()) / (1000 * 60 * 60);

const mapCustomToNearestPackage = (start: Date, end: Date, tier: RateTier, rates: PackageRates): PackageMode => {
  const duration = durationHours(start, end);
  const startHour = manilaHour(start);

  const candidates: Array<{ mode: PackageMode; score: number; baseRate: number }> = [
    { mode: "day", score: Math.abs(duration - 8) + Math.abs(startHour - 8), baseRate: rates[tier].day.baseRate },
    { mode: "night", score: Math.abs(duration - 12) + Math.abs(startHour - 18), baseRate: rates[tier].night.baseRate },
    { mode: "whole_day", score: Math.abs(duration - 22) + Math.min(Math.abs(startHour - 8), Math.abs(startHour - 18)), baseRate: rates[tier].whole_day.baseRate },
  ];

  candidates.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 0.0001) {
      return a.score - b.score;
    }
    return a.baseRate - b.baseRate;
  });

  return candidates[0].mode;
};

export const computeBookingPricing = (input: BookingPricingInput, rates: PackageRates): BookingPricingResult => {
  const start = new Date(input.startDatetime);
  const end = new Date(input.endDatetime);
  const tier = getRateTier(start);
  const packageMode =
    input.bookingMode === "custom"
      ? mapCustomToNearestPackage(start, end, tier, rates)
      : input.bookingMode;

  const packageRate = rates[tier][packageMode].baseRate;
  const addOnPerHead = rates[tier][packageMode].addOnPerHead;
  const totalGuests = Math.max(0, Number(input.adultCount || 0) + Number(input.childCount || 0));
  const extraGuests = Math.max(totalGuests - INCLUDED_GUESTS, 0);
  const extraGuestTotal = extraGuests * addOnPerHead;
  const servicesTotal = Math.max(0, Number(input.servicesTotal || 0));
  const subtotal = packageRate + extraGuestTotal + servicesTotal;
  const total = round2(subtotal);

  return {
    rateTier: tier,
    packageMode,
    packageRate,
    addOnPerHead,
    includedGuests: INCLUDED_GUESTS,
    totalGuests,
    extraGuests,
    extraGuestTotal,
    servicesTotal,
    subtotal: total,
    tax: 0,
    total,
    downPaymentMin: downPaymentAmount(total),
  };
};
