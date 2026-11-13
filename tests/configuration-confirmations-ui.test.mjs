import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/configuration", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "Node"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const button = (root, label) => [...root.querySelectorAll("button")].find(el => el.textContent.trim() === label);
const confirmation = () => document.querySelector('[role="alertdialog"]');
const click = async el => { assert.ok(el); assert.equal(el.matches(":disabled"), false); await act(async () => el.click()); };
async function edit(el, next) {
  assert.ok(el);
  await act(async () => {
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, next);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}
async function mount(Component) {
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component)));
  return { container, close: async () => { await act(async () => root.unmount()); container.remove(); } };
}

test("configuration requires confirmation, Escape preserves edits and focus, and a confirmed save submits once", async () => {
  const saves = []; let release;
  const Component = loadTsModule("components/admin/ConfigurationClient.tsx", {
    "@/components/settings/SettingsProvider": { useSettings: () => ({ settings: {}, isLoading: false, save: updates => {
      saves.push(updates); return new Promise(resolve => { release = resolve; });
    } }) },
    "@/components/admin/PolicyEditor": { default: () => null },
  }).default;
  const h = await mount(Component);
  try {
    const name = h.container.querySelector('input[type="text"]'); await edit(name, "MarVille Resort Complex");
    const save = button(h.container, "Save other settings"); save.focus();
    await click(save); await click(save);
    assert.equal(document.querySelectorAll('[role="alertdialog"]').length, 1); assert.equal(saves.length, 0);
    assert.match(confirmation().textContent, /take effect immediately/);
    await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(confirmation(), null); assert.equal(saves.length, 0); assert.equal(document.activeElement, save); assert.equal(name.value, "MarVille Resort Complex");
    await click(save); await click(button(confirmation(), "Save settings"));
    assert.equal(saves.length, 1); assert.ok(saves[0].some(row => row.value === "MarVille Resort Complex"));
    assert.equal(button(h.container, "Saving...").disabled, true); assert.equal(name.matches(":disabled"), true);
    await act(async () => release()); assert.match(h.container.textContent, /Settings saved/);
  } finally { await h.close(); }
});

test("policy publication confirms the version, preserves drafts after cancel or failure, and locks a pending publish", async () => {
  const originalFetch = globalThis.fetch, posts = []; let release, fail = true;
  const policy = { version: 4, cancellation_text: "The original cancellation policy for all guests.", refund_text: "The original refund policy for all guests.", guest_cancellation_notice_hours: 48, refund_review_enabled: true, created_at: "2026-11-13T00:00:00+08:00" };
  globalThis.fetch = async (_url, options) => {
    if (!options?.method) return Response.json({ policy, history: [] });
    posts.push(JSON.parse(options.body));
    if (fail) { fail = false; return Response.json({ message: "Publish failed. Retry." }, { status: 503 }); }
    return new Promise(resolve => { release = () => { policy.version = 5; policy.cancellation_text = posts.at(-1).cancellationText; resolve(Response.json({ version: 5 })); }; });
  };
  const h = await mount(loadTsModule("components/admin/PolicyEditor.tsx").default);
  try {
    const cancellation = h.container.querySelector("textarea"); await edit(cancellation, "A revised cancellation policy for future reservations.");
    const publish = button(h.container, "Publish new version"); publish.focus(); await click(publish);
    assert.equal(posts.length, 0); assert.match(confirmation().textContent, /Existing reservations keep the version/);
    await click(button(confirmation(), "Keep editing")); assert.equal(document.activeElement, publish); assert.equal(posts.length, 0);
    await click(publish); await click(button(confirmation(), "Publish policy"));
    assert.match(h.container.querySelector('[role="alert"]').textContent, /Publish failed/);
    assert.equal(cancellation.value, "A revised cancellation policy for future reservations.");
    await click(publish); await click(button(confirmation(), "Publish policy"));
    assert.equal(posts.length, 2); assert.equal(posts[1].expectedVersion, 4); assert.equal(posts[1].cancellationText, cancellation.value);
    assert.equal(cancellation.matches(":disabled"), true); assert.equal(button(h.container, "Publishing...").matches(":disabled"), true);
    await act(async () => release()); assert.match(h.container.textContent, /Policy version 5 published/);
  } finally { await h.close(); globalThis.fetch = originalFetch; }
});
