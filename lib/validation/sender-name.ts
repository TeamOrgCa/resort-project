import { normalizePersonName, sanitizePersonName } from "./name";

export const SENDER_NAME_ERROR = "Enter a sender name using letters, spaces, periods, apostrophes or hyphens. Numbers and emojis are not allowed.";

// Keep accents and normal name punctuation, including initials and curly apostrophes.
export function sanitizeSenderName(value: string): string {
  return sanitizePersonName(value);
}

export function normalizeSenderName(value: unknown): string | null {
  return normalizePersonName(value);
}
