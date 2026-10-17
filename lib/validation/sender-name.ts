import { containsEmoji, removeEmoji } from "./emoji";

export const SENDER_NAME_ERROR = "Enter a sender name using letters, spaces, periods, apostrophes or hyphens. Numbers and emojis are not allowed.";

// Keep accents and normal name punctuation, including initials and curly apostrophes.
export function sanitizeSenderName(value: string): string {
  return removeEmoji(value).normalize("NFC").replace(/[^\p{L}\p{M} .'’\-]/gu, "").slice(0, 100);
}

export function normalizeSenderName(value: unknown): string | null {
  if (typeof value !== "string" || containsEmoji(value)) return null;
  const name = value.normalize("NFC").trim().replace(/ +/g, " ");
  if (!name || name.length > 100 || !/\p{L}/u.test(name) || !/^[\p{L}\p{M} .'’\-]+$/u.test(name)) return null;
  return name;
}
