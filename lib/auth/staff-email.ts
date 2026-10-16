export const STAFF_EMAIL_ERROR = "Enter a valid email address, such as alex@example.com.";

// Standard unquoted mailbox names and DNS domains, including plus tags,
// subdomains and ASCII-encoded international domain names.
const staffEmailPattern = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9](?:[a-z0-9-]{0,57}[a-z0-9])?)$/i;

export function isValidStaffEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && value.indexOf("@") <= 64 && staffEmailPattern.test(value);
}
