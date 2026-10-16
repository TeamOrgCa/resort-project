// Avoid \p{Emoji}: that property also includes ordinary digits, # and *.
const emoji = /(?:[#*0-9]\uFE0F?\u20E3|[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}](?:[\uFE0E\uFE0F\p{Emoji_Modifier}]|[\u{E0020}-\u{E007F}])*(?:\u200D[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}](?:[\uFE0E\uFE0F\p{Emoji_Modifier}]|[\u{E0020}-\u{E007F}])*)*)/u;

export const EMOJI_INPUT_MESSAGE = "Emojis are not allowed in text fields. Please use text, numbers or punctuation.";
export const containsEmoji = (value: string): boolean => emoji.test(value);
export const removeEmoji = (value: string): string => value.replace(new RegExp(emoji.source, "gu"), "");

export function containsEmojiText(value: unknown): boolean {
  if (typeof value === "string") return containsEmoji(value);
  if (Array.isArray(value)) return value.some(containsEmojiText);
  if (value && typeof value === "object") return Object.values(value).some(containsEmojiText);
  return false;
}
