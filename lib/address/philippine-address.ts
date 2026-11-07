export interface PhilippineAddress {
  streetAddress: string;
  province: string;
  city: string;
  zipCode: string;
}

export function parsePhilippineAddress(value: string): PhilippineAddress {
  const parts = value.split(",").map(part => part.trim());
  const zipCode = /^[0-9]{4}$/.test(parts.at(-1) ?? "") ? parts.pop()! : "";
  // Read the known suffix from the right so commas in the street are preserved.
  // Leave shorter legacy addresses intact for the guest to complete.
  const province = parts.length >= 3 ? parts.pop()! : "";
  const city = province ? parts.pop()! : "";
  return { streetAddress: parts.join(", "), province, city, zipCode };
}

export function formatPhilippineAddress(address: PhilippineAddress): string {
  return [address.streetAddress, address.city, address.province, address.zipCode]
    .map(part => part.trim())
    .filter(Boolean)
    .join(", ");
}

export function validatePhilippineAddress(input: unknown):
  | { value: string; error?: never }
  | { value?: never; error: string; field?: keyof PhilippineAddress } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Please complete your address, including the four-digit ZIP code.", field: "province" };
  }
  const fields = input as Record<string, unknown>;
  if (typeof fields.streetAddress !== "string" || !fields.streetAddress.trim()
    || typeof fields.city !== "string" || !fields.city.trim()
    || typeof fields.province !== "string" || !fields.province.trim()) {
    const field = typeof fields.province !== "string" || !fields.province.trim() ? "province"
      : typeof fields.city !== "string" || !fields.city.trim() ? "city" : "streetAddress";
    return { error: "Please enter your street address and select your province and city / municipality.", field };
  }
  if (fields.streetAddress.length > 200) {
    return { error: "Street address must be 200 characters or fewer.", field: "streetAddress" };
  }
  if (typeof fields.zipCode !== "string" || !/^[0-9]{4}$/.test(fields.zipCode)) {
    return { error: "ZIP code must contain exactly 4 digits.", field: "zipCode" };
  }
  return { value: formatPhilippineAddress({
    streetAddress: fields.streetAddress, city: fields.city, province: fields.province, zipCode: fields.zipCode,
  }) };
}
