import { containsEmoji, removeEmoji } from "./emoji";

export const PERSON_NAME_ERROR = "Names must use letters, spaces, periods, apostrophes or hyphens. Numbers and emojis are not allowed.";

export function sanitizePersonName(value: string): string {
  return removeEmoji(value).normalize("NFC").replace(/[^\p{L}\p{M} .'’\-]/gu, "").slice(0, 100);
}

export function normalizePersonName(value: unknown): string | null {
  if (typeof value !== "string" || containsEmoji(value)) return null;
  const name = value.normalize("NFC").trim().replace(/ +/g, " ");
  if (!name || name.length > 100 || !/\p{L}/u.test(name) || !/^[\p{L}\p{M} .'’\-]+$/u.test(name)) return null;
  return name;
}
