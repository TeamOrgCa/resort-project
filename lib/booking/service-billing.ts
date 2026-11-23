export type ServiceBillingType = "quantity" | "duration" | "person" | "fixed";

export function serviceBilling(type?: string | null, maximum = 1) {
  const duration = type === "duration";
  const person = type === "person", fixed = type === "fixed";
  return {
    type: (duration ? "duration" : person ? "person" : fixed ? "fixed" : "quantity") as ServiceBillingType,
    typeLabel: duration ? "Per Hour" : person ? "Per Person" : fixed ? "Fixed Rate" : "Per Piece",
    inputLabel: duration ? "Duration (Hours)" : person ? "Number of Guests" : fixed ? "Number of Bookings" : "Quantity",
    rateLabel: duration ? "per hour" : person ? "per person" : fixed ? "per booking" : "per piece",
    priceLabel: duration ? "Price per hour (PHP)" : person ? "Price per person (PHP)" : fixed ? "Fixed rate (PHP)" : "Price per piece (PHP)",
    limitLabel: duration ? "Maximum hours per booking" : person ? "Maximum guests per booking" : fixed ? "Maximum bookings per reservation" : "Maximum quantity per booking",
    hasQuantity: !fixed || maximum > 1,
    help: duration ? "Charged per hour. Enter a whole number of rental hours." : person ? "Charged for each guest using this service." : fixed ? "A single charge per booking. Set a maximum above 1 to allow multiple bookings." : "Charged per piece. Enter the number of items needed.",
  };
}

export function serviceCount(quantity: number, type?: string | null): string {
  return type === "duration" ? `${quantity} ${quantity === 1 ? "hour" : "hours"}` : type === "person" ? `${quantity} ${quantity === 1 ? "guest" : "guests"}` : type === "fixed" ? `${quantity} ${quantity === 1 ? "booking" : "bookings"}` : String(quantity);
}
