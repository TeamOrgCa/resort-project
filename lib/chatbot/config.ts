import type { SettingsMap } from "@/lib/settings/types";

export const DEFAULT_CHATBOT_FAQS: Record<string, string> = {
  "What is included in a private pool booking?": "A private pool booking includes a cottage, two air-conditioned rooms with private toilets, videoke, a griller, free parking and consumable food. Additional rooms and services may have separate charges.",
  "Is an ocular visit free?": "Yes, ocular visits are free. Open /booking, choose Ocular Visit and select an available date and time. The resort will review your request.",
  "Can we bring food and drinks?": "You may bring food and drinks. The listed corkage fee is PHP 200. Contact resort staff to confirm arrangements for your visit.",
};
export const chatbotSettingDefaults = { "chatbot.faqs": DEFAULT_CHATBOT_FAQS, "chatbot.facebook_chat_url": "" };
export const CHATBOT_SETTING_KEYS = ["resort.name", "resort.address", "resort.contact_numbers", "resort.email", "resort.social_links", ...Object.keys(chatbotSettingDefaults)];

export function validFaqs(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  const normalized = entries.map(([question]) => normalizeQuestion(question));
  return entries.length <= 40 && new Set(normalized).size === entries.length && entries.every(([question, answer]) =>
    question.trim().length >= 5 && question.length <= 200 && typeof answer === "string" && answer.trim().length >= 2 && answer.length <= 2000);
}
export const normalizeQuestion = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
export function configuredFaqs(settings: SettingsMap): Record<string, string> {
  return validFaqs(settings["chatbot.faqs"]) ? settings["chatbot.faqs"] : {};
}
export function exactFaqAnswer(message: string, faqs: Record<string, string>): string | null {
  const question = normalizeQuestion(message);
  return Object.entries(faqs).find(([key]) => normalizeQuestion(key) === question)?.[1] ?? null;
}
export function validFacebookChatUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === "") return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash
      && ((url.hostname === "m.me" && /^\/[A-Za-z0-9.]+\/?$/.test(url.pathname))
        || (["www.facebook.com", "facebook.com", "www.messenger.com", "messenger.com"].includes(url.hostname) && /^\/(?:messages\/t|t)\/[A-Za-z0-9.]+\/?$/.test(url.pathname)));
  } catch { return false; }
}
export function facebookChatUrl(settings: SettingsMap): string {
  const override = settings["chatbot.facebook_chat_url"];
  if (override && validFacebookChatUrl(override)) return override;
  const social = settings["resort.social_links"];
  const facebook = social && typeof social === "object" && !Array.isArray(social) ? social.facebook : null;
  if (typeof facebook === "string") {
    const handle = facebook.trim().replace(/^@/, "");
    if (/^[A-Za-z0-9.]+$/.test(handle)) return `https://m.me/${handle}`;
    try {
      const url = new URL(facebook);
      if (url.protocol === "https:" && ["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname)) {
        const page = url.pathname.replace(/^\/+|\/+$/g, "");
        if (/^[A-Za-z0-9.]+$/.test(page) && page !== "profile.php") return `https://m.me/${page}`;
        const id = url.searchParams.get("id");
        if (page === "profile.php" && id && /^\d+$/.test(id)) return `https://m.me/${id}`;
      }
    } catch { /* Fall back to the known public resort channel. */ }
  }
  return "https://m.me/marvilleresort";
}
export const wantsHumanSupport = (message: string) => /\b(?:human|real (?:person|employee)|(?:talk|speak|chat|connect).{0,25}(?:staff|employee|agent|someone|person)|customer (?:support|service)|not satisfied|tao|kausap)\b/i.test(message);
