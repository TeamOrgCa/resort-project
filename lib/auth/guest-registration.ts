import { normalizePhilippineMobile, PH_MOBILE_ERROR } from "@/lib/validation/phone";
import { EMAIL_INPUT_ERROR, hasEmailWhitespace } from "@/lib/validation/email";
import { normalizePersonName, PERSON_NAME_ERROR } from "@/lib/validation/name";

export type GuestRegistration = {
  firstName: string;
  lastName: string;
  middleName: string | null;
  email: string;
  phoneNumber: string;
  address: string;
  password: string;
};

export function validateGuestRegistration(input: unknown):
  | { value: GuestRegistration; error?: never }
  | { value?: never; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Please complete the registration form." };
  }

  const fields = input as Record<string, unknown>;
  const names = [fields.firstName, fields.lastName, fields.middleName];
  if (names.some((name) => typeof name !== "string")) {
    return { error: "Please enter a valid first and last name." };
  }

  const firstName = normalizePersonName(fields.firstName);
  const lastName = normalizePersonName(fields.lastName);
  const middleName = (fields.middleName as string).trim() ? normalizePersonName(fields.middleName) : "";
  if (!firstName || !lastName || middleName === null) return { error: PERSON_NAME_ERROR };

  if (typeof fields.email !== "string") return { error: "Please enter a valid email address." };
  if (hasEmailWhitespace(fields.email)) return { error: EMAIL_INPUT_ERROR };
  const email = fields.email.toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Please enter a valid email address." };
  }

  const phoneNumber = normalizePhilippineMobile(fields.phoneNumber);
  if (!phoneNumber) return { error: PH_MOBILE_ERROR };

  if (typeof fields.address !== "string") return { error: "Please enter your address." };
  const address = fields.address.trim();
  if (address.length < 5 || address.length > 500) {
    return { error: "Address must be between 5 and 500 characters." };
  }

  if (typeof fields.password !== "string" || fields.password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }
  if (fields.password.length > 128) return { error: "Password must be 128 characters or fewer." };
  if (fields.password !== fields.confirmPassword) return { error: "Passwords do not match." };

  return { value: { firstName, lastName, middleName: middleName || null, email, phoneNumber, address, password: fields.password } };
}
