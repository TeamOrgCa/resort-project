export function isCashMethod(method: { name: string; type: string }): boolean {
  return [method.name, method.type].some(value => value.trim().toLowerCase() === "cash");
}

/** Preserve leading zeroes while matching the database's duplicate-reference index. */
export function normalizeManualPaymentReference(value: string): string | null {
  const reference = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 -]{5,99}$/.test(reference)) return null;
  const normalized = reference.replace(/[ -]/g, "").toUpperCase();
  return normalized.length >= 6 ? normalized : null;
}

export function isValidManualAccountIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9@._+ -]{2,119}$/.test(value.trim());
}
