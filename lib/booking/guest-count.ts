export const INCLUDED_GUESTS = 20;
export const MAX_EXTRA_GUESTS = 10;
export const MAX_GUESTS = INCLUDED_GUESTS + MAX_EXTRA_GUESTS;

export function isValidGuestCounts(adults: number, children: number): boolean {
  return Number.isSafeInteger(adults) && adults >= 1 &&
    Number.isSafeInteger(children) && children >= 0 &&
    adults + children <= MAX_GUESTS;
}
