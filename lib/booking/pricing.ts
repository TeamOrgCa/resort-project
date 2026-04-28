import { BookingMode } from "@/lib/booking/policy";

type RateTier = "weekday" | "weekend";
type PackageMode = Exclude<BookingMode, "custom">;

interface PackageRate {
  baseRate: number;
  addOnPerHead: number;
}

const INCLUDED_PAX = 20;
const MIN_DOWNPAYMENT_RATE = 0.2;

const PACKAGE_RATES: Record<RateTier, Record<PackageMode, PackageRate>> = {
  weekday: {
    day: { baseRate: 7500, addOnPerHead: 125 },
    night: { baseRate: 9500, addOnPerHead: 175 },
    whole_day: { baseRate: 14500, addOnPerHead: 225 },
  },
  weekend: {
    day: { baseRate: 8000, addOnPerHead: 150 },
    night: { baseRate: 10000, addOnPerHead: 200 },
    whole_day: { baseRate: 15000, addOnPerHead: 250 },
  },
};

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
  const day = startDate.getDay();
  return day === 5 || day === 6 || day === 0 ? "weekend" : "weekday";
};

const durationHours = (start: Date, end: Date) => (end.getTime() - start.getTime()) / (1000 * 60 * 60);

const mapCustomToNearestPackage = (start: Date, end: Date, tier: RateTier): PackageMode => {
  const duration = durationHours(start, end);
  const startHour = start.getHours() + start.getMinutes() / 60;

  const candidates: Array<{ mode: PackageMode; score: number; baseRate: number }> = [
    { mode: "day", score: Math.abs(duration - 8) + Math.abs(startHour - 8), baseRate: PACKAGE_RATES[tier].day.baseRate },
    { mode: "night", score: Math.abs(duration - 12) + Math.abs(startHour - 18), baseRate: PACKAGE_RATES[tier].night.baseRate },
    { mode: "whole_day", score: Math.abs(duration - 22) + Math.min(Math.abs(startHour - 8), Math.abs(startHour - 18)), baseRate: PACKAGE_RATES[tier].whole_day.baseRate },
  ];

  candidates.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 0.0001) {
      return a.score - b.score;
    }
    return a.baseRate - b.baseRate;
  });

  return candidates[0].mode;
};

export const computeBookingPricing = (input: BookingPricingInput): BookingPricingResult => {
  const start = new Date(input.startDatetime);
  const end = new Date(input.endDatetime);
  const tier = getRateTier(start);
  const packageMode =
    input.bookingMode === "custom"
      ? mapCustomToNearestPackage(start, end, tier)
      : input.bookingMode;

  const packageRate = PACKAGE_RATES[tier][packageMode].baseRate;
  const addOnPerHead = PACKAGE_RATES[tier][packageMode].addOnPerHead;
  const totalGuests = Math.max(0, Number(input.adultCount || 0) + Number(input.childCount || 0));
  const extraGuests = Math.max(totalGuests - INCLUDED_PAX, 0);
  const extraGuestTotal = extraGuests * addOnPerHead;
  const servicesTotal = Math.max(0, Number(input.servicesTotal || 0));
  const subtotal = packageRate + extraGuestTotal + servicesTotal;
  const total = round2(subtotal);

  return {
    rateTier: tier,
    packageMode,
    packageRate,
    addOnPerHead,
    includedGuests: INCLUDED_PAX,
    totalGuests,
    extraGuests,
    extraGuestTotal,
    servicesTotal,
    subtotal: total,
    tax: 0,
    total,
    downPaymentMin: round2(total * MIN_DOWNPAYMENT_RATE),
  };
};
