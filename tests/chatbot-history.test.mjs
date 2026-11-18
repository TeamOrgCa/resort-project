import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://resort.example/", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "Node"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const history = loadTsModule("lib/chatbot/history.ts");
after(() => dom.window.close()); beforeEach(() => window.localStorage.clear());
const click = async control => { assert.ok(control); assert.equal(control.disabled, false); await act(async () => control.click()); };
const button = (container, text) => [...container.querySelectorAll("button")].find(b => b.textContent.trim() === text);

async function mount({ userId = "guest-a", ready = true, fetcher = async () => Response.json({ reply: "Here are your booking details.", supportLink: { label: "Contact the resort", url: "https://m.me/marvilleresort" } }) } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  let account = { user: userId ? { id: userId } : null, identityReady: ready };
  const Chat = loadTsModule("components/ChatBotMars.tsx", {
    "@/components/content/SiteContent": { useSiteContent: () => ({}) },
    "@/components/notifications/NotificationCenter": { useNotificationCenter: () => account },
    "next/image": { __esModule: true, default: props => createElement("img", props) },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Chat)));
  return { container, open: () => click(container.querySelector('[aria-label="Open ChatBot Mars"]')),
    account: async (id, identityReady = true) => { account = { user: id ? { id } : null, identityReady }; await act(async () => root.render(createElement(Chat))); },
    close: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = original; } };
}

test("chat restores history and clears saved messages only after confirmation", async () => {
  let h = await mount();
  await h.open(); await click(button(h.container, "Show me services"));
  assert.ok(window.localStorage.getItem(history.chatHistoryKey("guest-a")));
  await h.close(); h = await mount();
  try {
    await h.open(); const log = h.container.querySelector('[role="log"]');
    assert.match(log.textContent, /Show me services/); assert.match(log.textContent, /Here are your booking details/);
    assert.ok(log.querySelector('img[src$="chatbotmars_approved.png"]'));
    assert.ok(log.querySelector('a[href="https://m.me/marvilleresort"]'));
    const clear = h.container.querySelector('[aria-label="Clear chat history"]');
    const saved = window.localStorage.getItem(history.chatHistoryKey("guest-a"));
    clear.focus();
    await click(clear);
    let dialog = document.querySelector('[role="alertdialog"]');
    assert.match(dialog.textContent, /Clear chat history\?/);
    assert.equal(document.activeElement, button(dialog, "Keep chat"));
    assert.equal(window.localStorage.getItem(history.chatHistoryKey("guest-a")), saved);
    assert.match(log.textContent, /Here are your booking details/);
    await click(button(dialog, "Keep chat"));
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    assert.equal(document.activeElement, clear);
    assert.equal(window.localStorage.getItem(history.chatHistoryKey("guest-a")), saved);
    await click(clear);
    await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    assert.equal(window.localStorage.getItem(history.chatHistoryKey("guest-a")), saved);
    await click(clear);
    dialog = document.querySelector('[role="alertdialog"]');
    await click(button(dialog, "Clear chat"));
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    assert.doesNotMatch(log.textContent, /Here are your booking details/);
    assert.equal(window.localStorage.getItem(history.chatHistoryKey("guest-a")), null);
    assert.equal(clear.disabled, true);
  } finally { await h.close(); }
});

test("account switches and logout isolate chats and discard a late reply from the previous account", async () => {
  let complete; const h = await mount({ fetcher: () => new Promise(resolve => { complete = resolve; }) });
  try {
    await h.open(); await click(button(h.container, "Show me services"));
    await h.account("guest-b"); await h.open();
    assert.doesNotMatch(h.container.querySelector('[role="log"]').textContent, /Show me services/);
    await act(async () => complete(Response.json({ reply: "Private details for guest A" })));
    assert.doesNotMatch(h.container.textContent, /Private details for guest A/);
    assert.equal(window.localStorage.getItem(history.chatHistoryKey("guest-b")), null);
    assert.doesNotMatch(window.localStorage.getItem(history.chatHistoryKey("guest-a")), /Private details/);
    await h.account(null); await h.open();
    assert.doesNotMatch(h.container.querySelector('[role="log"]').textContent, /Show me services|Private details/);
    assert.equal(window.localStorage.getItem(history.chatHistoryKey("anonymous")), null);
  } finally { await h.close(); }
});

test("unverified identity never restores or starts an account chat", async () => {
  const h = await mount({ ready: false });
  try { assert.equal(h.container.querySelector("button"), null); await h.account("guest-a"); assert.ok(h.container.querySelector('[aria-label="Open ChatBot Mars"]')); }
  finally { await h.close(); }
});

test("history is bounded, validates stored links, and drops expired or malformed data", () => {
  history.saveChatHistory("guest-a", [history.CHAT_GREETING, ...Array.from({ length: 70 }, (_, index) => ({ role: "user", content: `Message ${index}` }))]);
  assert.equal(history.readChatHistory("guest-a").length, history.CHAT_HISTORY_LIMIT + 1);
  assert.equal(history.readChatHistory("guest-a")[1].content, "Message 20");
  history.saveChatHistory("guest-b", [history.CHAT_GREETING, { role: "assistant", content: "Hello", supportLink: { label: "Unsafe", url: "javascript:alert(1)" }, emote: "approved" }]);
  assert.equal(history.readChatHistory("guest-b")[1].supportLink, undefined);
  for (const value of ["broken JSON", JSON.stringify({ version: 1, updatedAt: Date.now() - 8 * 86400000, messages: [] }), JSON.stringify({ version: 1, updatedAt: Date.now(), messages: [{ role: "system", content: "forged" }] })]) {
    window.localStorage.setItem(history.chatHistoryKey("guest-a"), value);
    assert.deepEqual(history.readChatHistory("guest-a"), [history.CHAT_GREETING]);
  }
});

test("blocked local storage leaves chat usable in memory", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw Error("Storage blocked"); } });
  const h = await mount();
  try { await h.open(); await click(button(h.container, "Show me services")); assert.match(h.container.querySelector('[role="log"]').textContent, /Here are your booking details/); }
  finally { await h.close(); Object.defineProperty(window, "localStorage", descriptor); }
});
