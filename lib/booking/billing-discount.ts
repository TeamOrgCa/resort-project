import type { DiscountState } from "./discounts";

/** Saved on a receipt at issuance; never reconstructed from the current bill. */
export type BillingDiscountSnapshot = {
  amount: number;
  kind: string;
  promoCode: string | null;
  promoType: string | null;
  promoValue: number;
  eligibleGuests: number;
  headCount: number;
  packagePrice: number;
};

const money = (value: number) => new Intl.NumberFormat("en-PH", {
  style: "currency", currency: "PHP", minimumFractionDigits: 2,
}).format(value);

export function billingDiscountSnapshot(state: DiscountState & { discount_package_price?: number }, headCount: number): BillingDiscountSnapshot {
  return {
    amount: Number(state.discount_amount ?? 0), kind: state.discount_kind ?? "none",
    promoCode: state.discount_promo_code ?? null, promoType: state.discount_promo_type ?? null,
    promoValue: Number(state.discount_promo_value ?? 0), eligibleGuests: Number(state.discount_eligible_guests ?? 0),
    headCount, packagePrice: Number(state.discount_package_price ?? 0),
  };
}

export function describeBillingDiscount(discount: BillingDiscountSnapshot | null | undefined) {
  if (!discount || !(Number(discount.amount) > 0) || !["promo", "pwd_senior"].includes(discount.kind)) return null;
  if (discount.kind === "promo") return {
    label: `Promo discount${discount.promoCode ? ` (${discount.promoCode})` : ""}`,
    detail: `${discount.promoValue > 0 ? `${discount.promoType === "percent" ? `${discount.promoValue}%` : money(discount.promoValue)} off the package price. ` : ""}Only the larger eligible discount applies; discounts do not stack.`,
  };
  return {
    label: "PWD / senior discount (20%)",
    detail: `${discount.headCount > 0 ? `${discount.eligibleGuests} of ${discount.headCount} guests eligible. ${money(discount.packagePrice)} / ${discount.headCount} guests x 20% x ${discount.eligibleGuests} eligible guests. ` : "20% of eligible guest shares. "}Only the larger eligible discount applies; discounts do not stack.`,
  };
}

export function receiptDiscountFields(discount: BillingDiscountSnapshot | null | undefined, netTotal: number) {
  const description = describeBillingDiscount(discount);
  if (!description || !discount) return [];
  return [
    { label: "Total before discount", value: money(netTotal + Number(discount.amount)) },
    { label: "Discount applied", value: description.label },
    { label: "Discount details", value: description.detail },
    { label: "Discount amount", value: money(-Number(discount.amount)) },
  ];
}
