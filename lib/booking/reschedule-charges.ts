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
  return { noticeFee, rateAdjustment, totalAdditional: noticeFee + rateAdjustment };
}
