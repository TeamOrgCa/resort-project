import { contentDefinitions } from "./content-catalog";
import type { SettingsMap } from "./types";

export const publicResortDefaults = {
  "resort.name": "MarVille Resort",
  "resort.address": "Cabrera Road Hapay na Mangga Brgy. Dolores, Taytay, Rizal 1920",
  "resort.contact_numbers": ["09172796592", "82360633"],
  "resort.email": "emailmarvilleresort@gmail.com",
  "resort.social_links": { facebook: "@marvilleresort", instagram: "@marvilleresort", tiktok: "@marvilleresort" },
};

export const publicContentDefaults: SettingsMap = {
  ...publicResortDefaults,
  ...Object.fromEntries(contentDefinitions.map((definition) => [definition.key, definition.defaultValue])),
};
export const publicContentKeys = Object.keys(publicContentDefaults);

/** Accept local assets and HTTPS images, without allowing protocol-relative URLs. */
export function isContentImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || /[\s\\]/.test(value)) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function socialUrl(platform: "facebook" | "instagram" | "tiktok", value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (value.startsWith("https://")) {
    try { const url = new URL(value); return url.protocol === "https:" ? url.href : undefined; } catch { return undefined; }
  }
  const handle = value.trim().replace(/^@/, "");
  return `https://${platform}.com/${platform === "tiktok" ? "@" : ""}${encodeURIComponent(handle)}`;
}
