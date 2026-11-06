import { normalizePersonName, PERSON_NAME_ERROR } from "@/lib/validation/name";
import { normalizePhilippineMobile, PH_MOBILE_ERROR } from "@/lib/validation/phone";
import { validatePhilippineAddress } from "@/lib/address/philippine-address";

export function validateGuestProfile(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Enter valid profile details." } as const;
  const fields = input as Record<string, unknown>;
  const firstName = normalizePersonName(fields.firstName), lastName = normalizePersonName(fields.lastName);
  const middleName = fields.middleName === undefined || fields.middleName === null || (typeof fields.middleName === "string" && !fields.middleName.trim())
    ? "" : normalizePersonName(fields.middleName);
  if (!firstName || !lastName || middleName === null) return { error: PERSON_NAME_ERROR } as const;
  if ([fields.firstName, fields.lastName, fields.middleName].some(name => typeof name === "string" && name.length > 75)) {
    return { error: "First, middle and last names must be 75 characters or fewer." } as const;
  }
  const phoneNumber = normalizePhilippineMobile(fields.phoneNumber);
  if (!phoneNumber) return { error: PH_MOBILE_ERROR } as const;
  let address = fields.address;
  if (fields.addressDetails !== undefined) {
    const validation = validatePhilippineAddress(fields.addressDetails);
    if (validation.value === undefined) return { error: validation.error } as const;
    address = validation.value;
  }
  if (typeof address !== "string" || address.length > 500) return { error: "Enter an address of at most 500 characters." } as const;
  return { value: { first_name: firstName, last_name: lastName, middle_name: middleName || null, phone_number: phoneNumber, address: address.trim() } } as const;
}
