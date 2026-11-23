import { calculateBookingDiscount, savedPromo, type DiscountState } from "./discounts";
import { computeBookingPricing } from "@/lib/booking/pricing";
import type { BookingMode } from "@/lib/booking/policy";
import type { PackageRates } from "@/lib/booking/package-rates";
import { positiveRateAdjustment, rescheduleNoticeFee } from "@/lib/booking/reschedule-charge-policy";

export function calculateRescheduleCharges(input: {
  originalStart: string;
  originalEnd: string;
  newStart: string;
  newEnd: string;
  bookingMode: BookingMode;
  adultCount: number;
  childCount: number;
  now?: number;
  discount?: DiscountState;
  rates: PackageRates;
}) {
  const noticeFee = rescheduleNoticeFee(input.originalStart, input.now);
  const priceFor = (startDatetime: string, endDatetime: string) => computeBookingPricing({
    bookingMode: input.bookingMode,
    startDatetime,
    endDatetime,
    adultCount: input.adultCount,
    childCount: input.childCount,
  }, input.rates).total;
  const oldPrice = priceFor(input.originalStart, input.originalEnd);
  const newPrice = priceFor(input.newStart, input.newEnd);
  const rateAdjustment = positiveRateAdjustment(oldPrice, newPrice);
  const nextDiscount = input.discount ? calculateBookingDiscount(computeBookingPricing({ ...input, startDatetime: input.newStart, endDatetime: input.newEnd }, input.rates).packageRate, input.adultCount + input.childCount, Number(input.discount.discount_eligible_guests ?? 0), savedPromo(input.discount)).amount : 0;
  const discountAdjustment = input.discount ? Number(input.discount.discount_amount ?? 0) - nextDiscount : 0;
  return { noticeFee, rateAdjustment, discountAdjustment, totalAdditional: Math.round((noticeFee + rateAdjustment + discountAdjustment) * 100) / 100 };
}
