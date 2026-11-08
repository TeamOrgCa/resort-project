import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "Node"]) globalThis[key] = dom.window[key];
window.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client"); after(() => dom.window.close());
const button = (container, text) => [...container.querySelectorAll("button")].find(item => item.textContent.trim() === text);
const click = async element => { assert.ok(element); assert.equal(element.disabled, false); await act(async () => element.click()); };
const value = async (element, text) => { assert.ok(element); await act(async () => {
  Object.getOwnPropertyDescriptor(element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, "value").set.call(element,text);
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
}); };

test("admins edit and publish FAQ questions and approved answers in Configuration", async () => {
  let saved;
  const Component = loadTsModule("components/admin/ConfigurationClient.tsx", {
    "@/components/settings/SettingsProvider": { useSettings: () => ({ settings: { "chatbot.faqs": { "Can we bring food?": "Contact the resort first." } }, isLoading: false, save: async updates => { saved = updates; } }) },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Component)));
    await click(button(container, "Chatbot"));
    const question = container.querySelector('[aria-label="FAQ question 1"]');
    await value(question, "Can we bring outside food?");
    assert.equal(document.activeElement === null, false);
    await value(container.querySelector('[aria-label="FAQ answer 1"]'), "Please confirm outside food arrangements with the resort.");
    await click(button(container, "Save chatbot settings"));
    assert.equal(saved.find(row => row.key === "chatbot.faqs").value["Can we bring outside food?"], "Please confirm outside food arrangements with the resort.");
    assert.match(container.textContent, /Settings saved/);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("chat shows admin FAQ buttons and sends human-help reasons before rendering a clickable Facebook link", async () => {
  const original = globalThis.fetch, requests = [];
  globalThis.fetch = async (_url, options) => { requests.push(JSON.parse(options.body)); return Response.json({ reply: "An administrator has been notified.", supportLink: { label: "Chat with MarVille Resort on Facebook", url: "https://m.me/marvilleresort" } }); };
  const Component = loadTsModule("components/ChatBotMars.tsx", {
    "@/components/content/SiteContent": { useSiteContent: () => ({ "chatbot.faqs": { "Custom resort question?": "Approved resort answer." } }) },
    "next/image": { __esModule: true, default: ({ src, alt }) => createElement("img", { src, alt }) },
    "next/link": { __esModule: true, default: ({ children, ...props }) => createElement("a", props, children) },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Component)));
    await click(container.querySelector('[aria-label="Open ChatBot Mars"]'));
    assert.ok(button(container, "Custom resort question?"));
    await click(button(container, "Talk to a resort employee"));
    const form = button(container, "Request human support").closest("form");
    assert.equal(button(container, "Request human support").disabled, true);
    await value(form.querySelector("textarea"), "Please explain my booking charges");
    await value(form.querySelector("input"), "SR-OWNBOOK1");
    await click(button(container, "Request human support"));
    assert.match(requests[0].message, /human support.*booking charges.*SR-OWNBOOK1/);
    const link = container.querySelector('a[href="https://m.me/marvilleresort"]');
    assert.ok(link); assert.equal(link.target, "_blank"); assert.match(link.rel, /noopener/);
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = original; }
});

test("settings API rejects malformed FAQ content and non-Facebook redirects and requires admin access", async () => {
  let admin = true, saved;
  const { PATCH } = loadTsModule("app/api/admin/settings/route.ts", {
    "@/lib/server/admin-audit": { requireAdminStaff: async () => admin ? { supabase: {} } : null, createAuditLog: async () => true },
    "@/lib/settings/settingsService": { updateSettings: async (_client, updates) => { saved = updates; return {}; } },
  });
  const post = updates => PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ updates }) }));
  assert.equal((await post([{ key: "chatbot.faqs", value: { "Valid question?": "" } }])).status, 400);
  assert.equal((await post([{ key: "chatbot.facebook_chat_url", value: "https://evil.test" }])).status, 400);
  assert.equal((await post([{ key: "chatbot.faqs", value: { "Valid question?": "Saved approved answer." } }])).status, 200);
  assert.equal(saved[0].value["Valid question?"], "Saved approved answer.");
  admin = false; assert.equal((await post([{ key: "chatbot.faqs", value: {} }])).status, 401);
});
