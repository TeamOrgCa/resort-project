export const PH_MOBILE_ERROR = "Enter a valid Philippine mobile number: +63 followed by 10 digits starting with 9 (for example, +639171234567).";

// Mobile country code and national prefix: ITU E.164, Philippines (+63), 9.
// https://www.ituob.org/datasets/1015-E.164B/
export function normalizePhilippineMobile(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const compact = value.trim().replace(/[\s()-]/g, "");
  if (/^\+639\d{9}$/.test(compact)) return compact;
  if (/^639\d{9}$/.test(compact)) return `+${compact}`;
  if (/^09\d{9}$/.test(compact)) return `+63${compact.slice(1)}`;
  if (/^9\d{9}$/.test(compact)) return `+63${compact}`;
  return null;
}

// Display a national number beside the fixed +63 prefix. Preserve invalid
// characters/extra digits for validation rather than silently repairing them.
export function philippineMobileInput(value: string): string {
  const compact = value.replace(/[\s()-]/g, "");
  if (compact.startsWith("+63")) return compact.length === 3 || compact[3] === "9" ? compact.slice(3) : compact;
  if (/^639/.test(compact) || compact === "63") return compact.slice(2);
  if (/^09/.test(compact) || compact === "0") return compact.slice(1);
  return compact;
}
