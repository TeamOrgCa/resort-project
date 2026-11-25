import { serviceBilling } from "./service-billing";
import { formatHourDurations } from "@/lib/format-hour-durations";
import { describeBillingDiscount, type BillingDiscountSnapshot } from "./billing-discount";
export type BillingLine = {
  kind?: "discount";
  description: string;
  detail: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type BillingBreakdown = {
  lines: BillingLine[];
  total: number;
};

export type BilledUnit = { name: string; quantity: number; pricePerPeriod: number };
export type BilledService = { name: string; quantity: number; priceAtBooking: number; billingType?: "quantity" | "duration" | "person" | "fixed" };

type BreakdownInput = {
  commercialType?: string | null;
  bookingMode: string | null;
  startDatetime: string;
  endDatetime: string;
  adultCount: number;
  childCount: number;
  adultRate: number | null;
  childRate: number | null;
  units: BilledUnit[];
  services: BilledService[];
  roomCharges?: { description: string; amount: number }[];
  recordedTotal: number;
  discountAmount?: number;
  discountKind?: string;
  discount?: BillingDiscountSnapshot | null;
  rescheduleFees?: number;
  dateRateAdjustment?: number;
};

const cents = (value: number) => Math.round(value * 100);
const money = (value: number) => cents(value) / 100;

export function buildBillingBreakdown(input: BreakdownInput): BillingBreakdown {
  const discountAmount = Number(input.discount?.amount ?? input.discountAmount ?? 0);
  const discountDescription = describeBillingDiscount(input.discount);
  const periods = input.commercialType === "public_swimming" ? 1 : Math.max(1, Math.ceil((Date.parse(input.endDatetime) - Date.parse(input.startDatetime)) / 86_400_000));
  const unitLines: BillingLine[] = input.units.map((unit) => ({
    description: unit.name,
    detail: `${unit.quantity} ${unit.quantity === 1 ? "unit" : "units"} for ${periods} ${periods === 1 ? "billing period" : "billing periods"}`,
    quantity: unit.quantity * periods,
    unitPrice: money(unit.pricePerPeriod),
    amount: money(unit.quantity * periods * unit.pricePerPeriod),
  }));
  const guestLines: BillingLine[] = [
    { description: "Adult guest charges", quantity: input.adultCount, rate: input.adultRate },
    { description: "Child guest charges", quantity: input.childCount, rate: input.childRate },
  ].filter((line) => line.quantity > 0 && Number(line.rate) > 0).map((line) => ({
    description: line.description,
    detail: `${line.quantity} ${line.quantity === 1 ? "guest" : "guests"} for ${periods} ${periods === 1 ? "billing period" : "billing periods"}`,
    quantity: line.quantity * periods,
    unitPrice: money(Number(line.rate)),
    amount: money(line.quantity * periods * Number(line.rate)),
  }));
  const serviceLines: BillingLine[] = input.services.map((service) => ({
    description: service.name,
    detail: `${serviceBilling(service.billingType).inputLabel}: ${service.quantity}; charged ${serviceBilling(service.billingType).rateLabel}`,
    quantity: service.quantity,
    unitPrice: money(service.priceAtBooking),
    amount: money(service.quantity * service.priceAtBooking),
  }));

  const adjustmentLines: BillingLine[] = [
    { description: "Reschedule fees (non-refundable)", amount: money(input.rescheduleFees ?? 0), detail: "Accumulated fees from completed reschedules" },
    { description: "Higher-date-rate adjustments", amount: money(input.dateRateAdjustment ?? 0), detail: "Additional package cost for the selected dates" },
  ].filter(line => line.amount > 0).map(line => ({ ...line, quantity: 1, unitPrice: line.amount }));
  const discountLines: BillingLine[] = discountAmount > 0 ? [{
    kind: "discount",
    description: discountDescription?.label ?? (input.discountKind === "promo" ? "Promo discount" : "PWD / senior discount (20% of eligible guest shares)"),
    detail: discountDescription?.detail ?? "Larger eligible discount applied; discounts do not stack",
    quantity: 1, unitPrice: -money(discountAmount), amount: -money(discountAmount),
  }] : [];
  const roomLines: BillingLine[] = (input.roomCharges ?? []).map(charge => ({
    description: formatHourDurations(charge.description), detail: "Room operations · recorded charge", quantity: 1,
    unitPrice: money(Number(charge.amount)), amount: money(Number(charge.amount)),
  }));
  const detailedLines = [...unitLines, ...guestLines, ...serviceLines, ...roomLines, ...adjustmentLines, ...discountLines];
  if (detailedLines.length && cents(detailedLines.reduce((sum, line) => sum + line.amount, 0)) === cents(input.recordedTotal)) {
    return { lines: detailedLines, total: money(input.recordedTotal) };
  }

  // Package pricing can differ from the unit and per-guest rate snapshots.
  // Keep the charged service snapshots visible and reconcile to the recorded bill.
  const servicesTotal = serviceLines.reduce((sum, line) => sum + line.amount, 0);
  const adjustmentsTotal = adjustmentLines.reduce((sum, line) => sum + line.amount, 0);
  const roomTotal = roomLines.reduce((sum, line) => sum + line.amount, 0);
  const mode = input.bookingMode?.replaceAll("_", " ") ?? "resort";
  const units = input.units.map((unit) => `${unit.quantity} × ${unit.name}`).join(", ") || "selected resort package";
  const packageLine: BillingLine = {
    description: "Private pool package and guest charges",
    detail: `${mode}; ${units}; ${input.adultCount + input.childCount} guests`,
    quantity: 1,
    unitPrice: money(input.recordedTotal + discountAmount - servicesTotal - adjustmentsTotal - roomTotal),
    amount: money(input.recordedTotal + discountAmount - servicesTotal - adjustmentsTotal - roomTotal),
  };
  return { lines: [...(packageLine.amount !== 0 || !roomLines.length ? [packageLine] : []), ...serviceLines, ...roomLines, ...adjustmentLines, ...discountLines], total: money(input.recordedTotal) };
}
