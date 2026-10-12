export const RATE_TIERS = ["weekday", "weekend"] as const;
export const PACKAGE_MODES = ["day", "night", "whole_day"] as const;
export type RateTier = typeof RATE_TIERS[number];
export type PackageMode = typeof PACKAGE_MODES[number];
export type PackageRate = { baseRate: number; addOnPerHead: number };
export type PackageRates = Record<RateTier, Record<PackageMode, PackageRate>>;
export type PackageRateSchedule = { version: number; rates: PackageRates };

export const PACKAGE_LABELS: Record<PackageMode, { name: string; times: string }> = {
  day: { name: "Day swimming", times: "8:00 AM – 4:00 PM" },
  night: { name: "Night swimming", times: "6:00 PM – 6:00 AM next day" },
  whole_day: { name: "Whole-day swimming", times: "8:00 AM – 6:00 AM or 6:00 PM – 4:00 PM next day" },
};

export function formatPackageRatesText(rates: PackageRates): string {
  const currency = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 });
  return RATE_TIERS.map(tier => `${tier === "weekday" ? "Monday–Thursday" : "Friday–Sunday"}:\n${PACKAGE_MODES.map(mode =>
    `${PACKAGE_LABELS[mode].name} (${PACKAGE_LABELS[mode].times}): ${currency.format(rates[tier][mode].baseRate)}, plus ${currency.format(rates[tier][mode].addOnPerHead)} per extra guest.`
  ).join("\n")}`).join("\n\n");
}

export function parsePackageRates(value: unknown): PackageRates | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length !== 2) return null;
  const rates = {} as PackageRates;
  for (const tier of RATE_TIERS) {
    const raw = source[tier];
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 3) return null;
    rates[tier] = {} as Record<PackageMode, PackageRate>;
    for (const mode of PACKAGE_MODES) {
      const item = (raw as Record<string, unknown>)[mode];
      if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).length !== 2) return null;
      const { baseRate, addOnPerHead } = item as PackageRate;
      if (typeof baseRate !== "number" || typeof addOnPerHead !== "number" ||
        !Number.isFinite(baseRate) || !Number.isFinite(addOnPerHead) || baseRate <= 0 || addOnPerHead < 0 ||
        baseRate > 999999 || addOnPerHead > 999999 ||
        Math.abs(baseRate * 100 - Math.round(baseRate * 100)) > 0.000001 ||
        Math.abs(addOnPerHead * 100 - Math.round(addOnPerHead * 100)) > 0.000001) return null;
      rates[tier][mode] = { baseRate, addOnPerHead };
    }
  }
  return rates;
}

export function parsePackageRateSchedule(value: unknown): PackageRateSchedule | null {
  if (!value || typeof value !== "object") return null;
  const v = value as PackageRateSchedule;
  const rates = parsePackageRates(v.rates);
  return Number.isSafeInteger(Number(v.version)) && Number(v.version) > 0 && rates ? { version: Number(v.version), rates } : null;
}
