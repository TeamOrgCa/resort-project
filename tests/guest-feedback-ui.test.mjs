import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/analytics" });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client"); after(() => dom.window.close());
const button = (c, label) => [...c.querySelectorAll("button")].find(e => e.textContent.trim() === label);
const click = async el => { assert.ok(el); assert.equal(el.disabled, false); await act(async () => el.click()); };
async function value(el, text) { await act(async () => { Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype, "value").set.call(el, text); el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); }); }
const review = { review_id: "11111111-1111-4111-8111-111111111111", public_display_name: "Guest", overall_rating: 5, title: "Lovely visit", review_text: "Our family enjoyed the pool and the helpful staff.", created_at: "2026-10-13T00:00:00Z", is_approved: true, archived_at: null, archive_reason: null, image_url: null };
async function mount(canArchive = true) {
  const original = globalThis.fetch, calls = [], state = { fail: false, archived: false, changes: 0 };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options }); const params = new URL(url, "http://localhost").searchParams;
    if (options?.method === "PATCH") {
      if (state.fail) return Response.json({ message: "Feedback status changed. Refresh before trying again" }, { status: 409 });
      state.archived = JSON.parse(options.body).archive; return Response.json({ success: true, message: state.archived ? "Feedback archived" : "Feedback restored" });
    }
    return Response.json({ success: true, rows: [state.archived ? { ...review, archived_at: "2026-10-16T00:00:00Z", archive_reason: "Guest privacy request" } : review], total: 11, pageSize: 10, canArchive, page: Number(params.get("page")) });
  };
  const Component = loadTsModule("components/admin/GuestFeedbackPanel.tsx").default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component, { query: "period=Daily", revision: 0, onChanged: () => state.changes++ })));
  return { container, calls, state, close: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = original; } };
}
test("feedback loads automatically, supports live filtering and paging, and hides archive controls without permission", async () => {
  const h = await mount(false);
  try {
    assert.match(h.container.textContent, /Lovely visit/); assert.match(h.calls[0].url, /analytics\/feedback/);
    assert.equal(button(h.container, "Archive feedback"), undefined); assert.match(h.container.textContent, /Your role can view feedback/);
    await click(button(h.container, "Next reviews")); assert.match(h.calls.at(-1).url, /page=1/);
    await value(h.container.querySelector('input[type="search"]'), "pool");
    await act(async () => new Promise(resolve => setTimeout(resolve, 300))); assert.match(h.calls.at(-1).url, /search=pool&page=0/);
    await value(h.container.querySelector("select"), "archived"); assert.match(h.calls.at(-1).url, /status=archived/);
  } finally { await h.close(); }
});
test("archive and restore require a reason and confirmation, preserve errors in the dialog and refresh saved results", async () => {
  const h = await mount();
  try {
    await click(button(h.container, "Archive feedback")); assert.equal(h.calls.filter(c => c.options?.method === "PATCH").length, 0);
    await value(h.container.querySelector("textarea"), "Guest privacy request"); h.state.fail = true;
    await click(button(h.container, "Confirm archive")); assert.match(h.container.querySelector('[role="alert"]').textContent, /status changed/); assert.ok(h.container.querySelector('[role="dialog"]'));
    h.state.fail = false; await click(button(h.container, "Confirm archive")); assert.equal(h.container.querySelector('[role="dialog"]'), null); assert.equal(h.state.changes, 1);
    assert.match(h.container.textContent, /Feedback archived/); assert.ok(button(h.container, "Restore feedback"));
    await click(button(h.container, "Restore feedback")); await value(h.container.querySelector("textarea"), "Guest approved restoration"); await click(button(h.container, "Confirm restore"));
    const body = JSON.parse(h.calls.filter(c => c.options?.method === "PATCH").at(-1).options.body); assert.equal(body.archive, false); assert.equal(body.expectedArchivedAt, "2026-10-16T00:00:00Z");
    assert.equal(h.state.changes, 2); assert.match(h.container.textContent, /Feedback restored/);
  } finally { await h.close(); }
});
