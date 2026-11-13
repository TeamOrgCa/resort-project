import { normalizePhilippineMobile, PH_MOBILE_ERROR } from "@/lib/validation/phone";
import { EMAIL_INPUT_ERROR, hasEmailWhitespace } from "@/lib/validation/email";
import { normalizePersonName, PERSON_NAME_ERROR } from "@/lib/validation/name";
import { validatePhilippineAddress, type PhilippineAddress } from "@/lib/address/philippine-address";
import { LEGAL_POLICY_VERSION } from "@/lib/legal/policies";

export type GuestRegistration = {
  firstName: string;
  lastName: string;
  middleName: string | null;
  email: string;
  phoneNumber: string;
  address: string;
  password: string;
  policyAccepted: true;
  legalPolicyVersion: string;
};
export type GuestRegistrationField = keyof GuestRegistration | keyof PhilippineAddress | "confirmPassword";

export function validateGuestRegistration(input: unknown):
  | { value: GuestRegistration; error?: never }
  | { value?: never; error: string; field?: GuestRegistrationField } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Please complete the registration form.", field: "firstName" };
  }

  const fields = input as Record<string, unknown>;
  const names = [fields.firstName, fields.lastName, fields.middleName];
  if (names.some((name) => typeof name !== "string")) {
    return { error: "Please enter a valid first and last name.", field: typeof fields.firstName !== "string" ? "firstName" : typeof fields.lastName !== "string" ? "lastName" : "middleName" };
  }

  const firstName = normalizePersonName(fields.firstName);
  const lastName = normalizePersonName(fields.lastName);
  const middleName = (fields.middleName as string).trim() ? normalizePersonName(fields.middleName) : "";
  if (!firstName || !lastName || middleName === null) return { error: PERSON_NAME_ERROR, field: !firstName ? "firstName" : !lastName ? "lastName" : "middleName" };
  if (names.some(name => (name as string).length > 75)) {
    return { error: "First, middle and last names must be 75 characters or fewer.", field: (fields.firstName as string).length > 75 ? "firstName" : (fields.lastName as string).length > 75 ? "lastName" : "middleName" };
  }

  if (typeof fields.email !== "string") return { error: "Please enter a valid email address.", field: "email" };
  if (hasEmailWhitespace(fields.email)) return { error: EMAIL_INPUT_ERROR, field: "email" };
  const email = fields.email.toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Please enter a valid email address.", field: "email" };
  }

  const phoneNumber = normalizePhilippineMobile(fields.phoneNumber);
  if (!phoneNumber) return { error: PH_MOBILE_ERROR, field: "phoneNumber" };

  const addressValidation = validatePhilippineAddress(fields.addressDetails);
  if (addressValidation.value === undefined) return { error: addressValidation.error, field: addressValidation.field };
  const address = addressValidation.value;
  if (address.length < 5 || address.length > 500) {
    return { error: "Address must be between 5 and 500 characters.", field: "streetAddress" };
  }

  if (typeof fields.password !== "string" || fields.password.length < 8) {
    return { error: "Password must be at least 8 characters.", field: "password" };
  }
  if (fields.password.length > 128) return { error: "Password must be 128 characters or fewer.", field: "password" };
  if (fields.password !== fields.confirmPassword) return { error: "Passwords do not match.", field: "confirmPassword" };

  if (fields.policyAccepted !== true) {
    return { error: "Read the Terms and Conditions and Privacy Policy, then tick the agreement checkbox.", field: "policyAccepted" };
  }
  if (fields.legalPolicyVersion !== LEGAL_POLICY_VERSION) {
    return { error: "The terms or privacy policy changed. Reload this page and read the current documents before agreeing.", field: "policyAccepted" };
  }

  return { value: { firstName, lastName, middleName: middleName || null, email, phoneNumber, address, password: fields.password,
    policyAccepted: true, legalPolicyVersion: LEGAL_POLICY_VERSION } };
}
