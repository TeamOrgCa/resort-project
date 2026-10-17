import { normalizePersonName, PERSON_NAME_ERROR } from "@/lib/validation/name";
import { normalizePhilippineMobile, PH_MOBILE_ERROR } from "@/lib/validation/phone";

export function validateGuestProfile(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Enter valid profile details." } as const;
  const fields = input as Record<string, unknown>;
  const firstName = normalizePersonName(fields.firstName), lastName = normalizePersonName(fields.lastName);
  const middleName = fields.middleName === undefined || fields.middleName === null || (typeof fields.middleName === "string" && !fields.middleName.trim())
    ? "" : normalizePersonName(fields.middleName);
  if (!firstName || !lastName || middleName === null) return { error: PERSON_NAME_ERROR } as const;
  const phoneNumber = normalizePhilippineMobile(fields.phoneNumber);
  if (!phoneNumber) return { error: PH_MOBILE_ERROR } as const;
  if (typeof fields.address !== "string" || fields.address.length > 500) return { error: "Enter an address of at most 500 characters." } as const;
  return { value: { first_name: firstName, last_name: lastName, middle_name: middleName || null, phone_number: phoneNumber, address: fields.address.trim() } } as const;
}
