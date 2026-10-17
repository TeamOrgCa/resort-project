import { containsEmoji } from "./emoji";

export const EMAIL_INPUT_ERROR = "Enter a valid email address without spaces.";
const emailWhitespace = /[\s\u200B-\u200D\u2060]/u;

export function hasEmailWhitespace(value: string): boolean {
  return emailWhitespace.test(value);
}

export function sanitizeEmailInput(value: string): string {
  return value.replace(new RegExp(emailWhitespace.source, "gu"), "");
}

export function isValidLoginEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && !hasEmailWhitespace(value)
    && !containsEmoji(value) && /^[^@]+@[^@.]+(?:\.[^@.]+)+$/.test(value);
}
