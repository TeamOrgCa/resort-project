export type ServiceBillingType = "quantity" | "duration";

export function serviceBilling(type?: string | null) {
  const duration = type === "duration";
  return {
    type: duration ? "duration" as const : "quantity" as const,
    typeLabel: duration ? "Duration-based" : "Quantity-based",
    inputLabel: duration ? "Hours" : "Quantity",
    rateLabel: duration ? "per hour" : "each",
    priceLabel: duration ? "Price per hour (PHP)" : "Price per item (PHP)",
    limitLabel: duration ? "Maximum hours per booking" : "Maximum quantity per booking",
    help: duration ? "Charged per hour. Enter a whole number of rental hours." : "Charged per item. Enter the number of items needed.",
  };
}

export function serviceCount(quantity: number, type?: string | null): string {
  return type === "duration" ? `${quantity} ${quantity === 1 ? "hour" : "hours"}` : String(quantity);
}
