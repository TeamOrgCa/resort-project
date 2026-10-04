/** Guests can submit a 20% down payment or the full outstanding balance. */
export const DOWN_PAYMENT_PERCENT = 20;

export function downPaymentAmount(total: number): number {
  return Math.ceil((Math.round(total * 100) * DOWN_PAYMENT_PERCENT) / 100) / 100;
}

export function moneyMatches(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Math.abs(Math.round(actual * 100) - Math.round(expected * 100)) === 0;
}

/** A later charge is a balance payment even when the initial selector is hidden. */
export function resolvePaymentType(
  isBalancePayment: boolean,
  hasVerifiedPayment: boolean,
  selected: "downpayment" | "full",
): "downpayment" | "full" {
  return isBalancePayment && hasVerifiedPayment ? "full" : selected;
}
