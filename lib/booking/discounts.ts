export type PromoQuote = { remainingUses?: number; code: string; discount_type: "percent" | "fixed"; discount_value: number };
export type DiscountState = {
  discount_amount?: number; discount_eligible_guests?: number; discount_promo_code?: string | null;
  discount_promo_type?: "percent" | "fixed" | null; discount_promo_value?: number; discount_kind?: string;
};

export function calculateBookingDiscount(packagePrice: number, headCount: number, eligibleGuests: number, promo?: PromoQuote | null) {
  if (!Number.isFinite(packagePrice) || packagePrice < 0 || !Number.isSafeInteger(headCount) || headCount < 1 ||
    !Number.isSafeInteger(eligibleGuests) || eligibleGuests < 0 || eligibleGuests > headCount) throw new Error("Eligible PWD/senior guests must be between 0 and the number of guests. Count each guest once.");
  if (promo && (!["percent", "fixed"].includes(promo.discount_type) || !Number.isFinite(Number(promo.discount_value)) || Number(promo.discount_value) <= 0 ||
    promo.discount_type === "percent" && Number(promo.discount_value) > 100)) throw new Error("Enter a valid promo discount.");
  // Calculate in integer cents so .005 ties agree with PostgreSQL numeric rounding.
  const packageCents = Math.round(packagePrice * 100);
  const eligibleDiscount = Math.round(packageCents * eligibleGuests / (headCount * 5)) / 100;
  const promoDiscount = promo ? Math.min(packageCents, promo.discount_type === "percent"
    ? Math.round(packageCents * Math.round(Number(promo.discount_value) * 100) / 10000)
    : Math.round(Number(promo.discount_value) * 100)) / 100 : 0;
  const amount = Math.max(eligibleDiscount, promoDiscount);
  return { eligibleDiscount, promoDiscount, amount, kind: amount === 0 ? "none" : promoDiscount > eligibleDiscount ? "promo" : "pwd_senior" };
}

export function savedPromo(state: DiscountState): PromoQuote | null {
  return state.discount_promo_code && state.discount_promo_type ? { code: state.discount_promo_code, discount_type: state.discount_promo_type, discount_value: Number(state.discount_promo_value) } : null;
}
