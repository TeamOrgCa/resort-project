import type { StaffRole } from "./staff-auth";

export const STAFF_EMAIL_ERROR = "Enter a valid email address, such as alex@example.com.";

export const staffEmailSuffix = (role: StaffRole) => role === "admin" ? "@gmail.com" : "@marvilleresort.com";
export const staffEmailError = (role: StaffRole) => `Enter a valid email address ending in ${staffEmailSuffix(role)}.`;

/** Accept a pasted complete address only when its suffix matches the selected role. */
export function staffEmailUsername(value: string, role: StaffRole) {
  const normalized = value.trim().toLowerCase(), suffix = staffEmailSuffix(role);
  return normalized.endsWith(suffix) ? normalized.slice(0, -suffix.length) : normalized;
}

export function isValidStaffEmailForRole(value: unknown, role: StaffRole): value is string {
  return isValidStaffEmail(value) && value.toLowerCase().endsWith(staffEmailSuffix(role));
}

// Standard unquoted mailbox names and DNS domains, including plus tags,
// subdomains and ASCII-encoded international domain names.
const staffEmailPattern = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9](?:[a-z0-9-]{0,57}[a-z0-9])?)$/i;

export function isValidStaffEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && value.indexOf("@") <= 64 && staffEmailPattern.test(value);
}
