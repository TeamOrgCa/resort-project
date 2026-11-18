import { validFacebookChatUrl } from "./config";

export type ChatMessage = {
  role: "assistant" | "user";
  content: string;
  supportLink?: { label: string; url: string };
  emote?: "waving" | "approved" | "thinking";
};

export const CHAT_GREETING: ChatMessage = {
  role: "assistant", emote: "waving",
  content: "Hi, I’m ChatBot Mars. I can help with booking steps, rates, payments, and resort policies. What would you like to know?",
};
export const CHAT_HISTORY_LIMIT = 50;
const HISTORY_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export const chatHistoryKey = (owner: string) => `marville:chat-history:v1:${encodeURIComponent(owner)}`;

function cleanMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!["assistant", "user"].includes(String(item.role)) || typeof item.content !== "string" || !item.content.trim() || item.content.length > 6000) return null;
  const result: ChatMessage = { role: item.role as ChatMessage["role"], content: item.content };
  if (result.role === "assistant") {
    if (["waving", "approved", "thinking"].includes(String(item.emote))) result.emote = item.emote as ChatMessage["emote"];
    const link = item.supportLink as Record<string, unknown> | undefined;
    if (link && typeof link.label === "string" && link.label.length <= 200 && typeof link.url === "string" && validFacebookChatUrl(link.url)) {
      result.supportLink = { label: link.label, url: link.url };
    }
  }
  return result;
}

export function readChatHistory(owner: string): ChatMessage[] {
  const greeting = [CHAT_GREETING];
  try {
    const key = chatHistoryKey(owner), raw = window.localStorage.getItem(key);
    if (!raw) return greeting;
    if (raw.length > 400000) { window.localStorage.removeItem(key); return greeting; }
    const saved = JSON.parse(raw), now = Date.now();
    if (saved?.version !== 1 || !Number.isFinite(saved.updatedAt) || saved.updatedAt > now + 60000 || now - saved.updatedAt >= HISTORY_MAX_AGE || !Array.isArray(saved.messages) || saved.messages.length > CHAT_HISTORY_LIMIT) {
      window.localStorage.removeItem(key); return greeting;
    }
    const messages = saved.messages.map(cleanMessage) as Array<ChatMessage | null>;
    if (messages.some(message => !message)) { window.localStorage.removeItem(key); return greeting; }
    return [CHAT_GREETING, ...messages as ChatMessage[]];
  } catch { return greeting; }
}

export function saveChatHistory(owner: string, messages: ChatMessage[]) {
  try {
    const key = chatHistoryKey(owner);
    const recent = messages.slice(1).slice(-CHAT_HISTORY_LIMIT).map(cleanMessage).filter(Boolean);
    if (!recent.length) { window.localStorage.removeItem(key); return; }
    window.localStorage.setItem(key, JSON.stringify({ version: 1, updatedAt: Date.now(), messages: recent }));
  } catch { /* Chat remains usable when browser storage is blocked or full. */ }
}
