export type BillingLine = {
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
export type BilledService = { name: string; quantity: number; priceAtBooking: number };

type BreakdownInput = {
  bookingMode: string | null;
  startDatetime: string;
  endDatetime: string;
  adultCount: number;
  childCount: number;
  adultRate: number | null;
  childRate: number | null;
  units: BilledUnit[];
  services: BilledService[];
  recordedTotal: number;
};

const cents = (value: number) => Math.round(value * 100);
const money = (value: number) => cents(value) / 100;

export function buildBillingBreakdown(input: BreakdownInput): BillingBreakdown {
  const periods = Math.max(1, Math.ceil((Date.parse(input.endDatetime) - Date.parse(input.startDatetime)) / 86_400_000));
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
    detail: "Additional service selected for this reservation",
    quantity: service.quantity,
    unitPrice: money(service.priceAtBooking),
    amount: money(service.quantity * service.priceAtBooking),
  }));

  const detailedLines = [...unitLines, ...guestLines, ...serviceLines];
  if (detailedLines.length && cents(detailedLines.reduce((sum, line) => sum + line.amount, 0)) === cents(input.recordedTotal)) {
    return { lines: detailedLines, total: money(input.recordedTotal) };
  }

  // Package pricing can differ from the unit and per-guest rate snapshots.
  // Keep the charged service snapshots visible and reconcile to the recorded bill.
  const servicesTotal = serviceLines.reduce((sum, line) => sum + line.amount, 0);
  const mode = input.bookingMode?.replaceAll("_", " ") ?? "resort";
  const units = input.units.map((unit) => `${unit.quantity} × ${unit.name}`).join(", ") || "selected resort package";
  const packageLine: BillingLine = {
    description: "Private pool package and guest charges",
    detail: `${mode}; ${units}; ${input.adultCount} ${input.adultCount === 1 ? "adult" : "adults"}, ${input.childCount} ${input.childCount === 1 ? "child" : "children"}`,
    quantity: 1,
    unitPrice: money(input.recordedTotal - servicesTotal),
    amount: money(input.recordedTotal - servicesTotal),
  };
  return { lines: [packageLine, ...serviceLines], total: money(input.recordedTotal) };
}
