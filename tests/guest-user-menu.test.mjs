import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", error => { if (!error.message.startsWith("Not implemented: navigation")) throw error; });
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", virtualConsole });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const user = { id: "guest-id", email: "guest@example.com" };
const notifications = Array.from({ length: 5 }, (_, i) => ({ notification_id: String(i), title: "Reservation update " + i,
  message: "A lengthy reservation and refund notification. ".repeat(20), action_url: i === 0 ? "/manage" : null,
  is_read: false, created_at: "2026-10-16T01:00:00Z" }));
const panel = () => document.querySelector('[role="dialog"][aria-label="Your account and notifications"]');
const button = (container, text) => [...container.querySelectorAll("button")].find(el => el.textContent.trim() === text);
async function click(el) { assert.ok(el); assert.equal(el.disabled, false); await act(async () => el.click()); }

async function mount({ rows = notifications, anonymous = false } = {}) {
  const state = { loadError: false, readError: false, serverLogout: true, localLogoutError: false, reset: 0 };
  const calls = { reads: [], updates: [], signouts: [], fetches: [], auth: 0 };
  let authChange;
  const client = {
    auth: { getUser: async () => { calls.auth++; return { data: { user: anonymous ? null : user } }; },
      onAuthStateChange: callback => { authChange = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async options => { calls.signouts.push(options); return { error: state.localLogoutError ? new Error("Cannot log out") : null }; } },
    from(table) {
      const filters = []; let update;
      const q = { select: () => q, eq: (key, value) => { filters.push([key, value]); return q; }, order: () => q, limit: () => q,
        update: data => { update = data; return q; }, in: (key, value) => { filters.push([key, value]); return q; },
        maybeSingle: async () => ({ data: { first_name: "Test", last_name: "Guest" }, error: null }),
        then(resolve, reject) {
          if (update) calls.updates.push({ table, update, filters }); else calls.reads.push({ table, filters });
          return Promise.resolve({ data: update ? null : rows, error: (update ? state.readError : state.loadError) ? new Error("Unavailable") : null }).then(resolve, reject);
        } };
      return q;
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => { calls.fetches.push({ url, options }); return Response.json({}, { status: state.serverLogout ? 200 : 503 }); };
  const Component = loadTsModule("components/UserMenu.tsx", {
    "@/lib/supabase/client": { createClient: () => client },
    "@/lib/stores/booking-store": { useBookingStore: { getState: () => ({ resetBookingDraft: () => state.reset++ }) } },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component)));
  const trigger = () => container.querySelector('[aria-label="Open user menu"]');
  return { container, trigger, state, calls, authChange: (...args) => act(async () => authChange(...args)),
    close: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; } };
}

test("long notifications scroll independently below visible account actions in a portal", async () => {
  const h = await mount();
  try {
    await click(h.trigger()); const p = panel(); assert.ok(p); assert.equal(h.container.contains(p), false);
    const actions = p.querySelector('[aria-label="Account actions"]'), section = p.querySelector('section[aria-label="Notifications"]');
    assert.ok(actions.compareDocumentPosition(section) & window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(actions.querySelector('a[href="/profile"]').textContent, "Profile Settings");
    assert.ok(button(actions, "Sign Out")); assert.equal(button(actions, "Sign Out").disabled, false);
    const list = p.querySelector('[aria-label="Recent notifications"]');
    assert.match(list.className, /overflow-y-auto/); assert.match(list.className, /max-h-/); assert.equal(list.querySelectorAll("p.font-semibold").length, 5);
    assert.equal(document.activeElement, actions.querySelector('a[href="/profile"]'));
    assert.deepEqual(h.calls.reads[0].filters, [["recipient_role", "guest"], ["recipient_id", user.id]]);
    await click(button(p, "Mark all read")); assert.equal(button(panel(), "Mark all read"), undefined);
    assert.deepEqual(h.calls.updates[0].filters, [["recipient_role", "guest"], ["recipient_id", user.id], ["notification_id", ["0", "1", "2", "3", "4"]]]);
    assert.equal(h.calls.auth, 1);
  } finally { await h.close(); }
});

test("account panel stays within phone, landscape and desktop viewport bounds", async () => {
  const originalWidth = Object.getOwnPropertyDescriptor(window, "innerWidth"), originalHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
  const h = await mount();
  try {
    for (const [width, height, bottom] of [[320, 568, 540], [390, 844, 480], [667, 375, 350], [1440, 900, 64]]) {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
      h.trigger().getBoundingClientRect = () => ({ right: width - 12, bottom });
      await click(h.trigger()); const p = panel(), left = parseFloat(p.style.left), top = parseFloat(p.style.top);
      assert.ok(left >= 8); assert.ok(top >= 8); assert.ok(left + parseFloat(p.style.width) <= width - 8);
      assert.ok(top + parseFloat(p.style.maxHeight) <= height - 8);
      assert.ok(button(p, "Sign Out")); assert.ok(p.querySelector('a[href="/profile"]'));
      await act(async () => window.dispatchEvent(new window.Event("resize"))); assert.equal(panel(), null);
    }
  } finally { Object.defineProperty(window, "innerWidth", originalWidth); Object.defineProperty(window, "innerHeight", originalHeight); await h.close(); }
});

test("menu dismisses by Escape, outside click and close button while notification scrolling stays open", async () => {
  const h = await mount();
  try {
    await click(h.trigger());
    await act(async () => panel().querySelector('[aria-label="Recent notifications"]').dispatchEvent(new window.Event("scroll")));
    assert.ok(panel());
    await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(panel(), null); assert.equal(document.activeElement, h.trigger()); assert.equal(h.trigger().getAttribute("aria-expanded"), "false");
    await click(h.trigger()); await act(async () => document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true })));
    assert.equal(panel(), null);
    await click(h.trigger()); await click(panel().querySelector('[aria-label="Close user menu"]')); assert.equal(panel(), null);
    await click(h.trigger()); await h.authChange("SIGNED_OUT", null); assert.equal(panel(), null); assert.ok(h.container.querySelector('a[href="/auth/login"]'));
  } finally { await h.close(); }
});

test("notification errors offer retry and keep profile and sign-out usable", async () => {
  const h = await mount();
  try {
    h.state.loadError = true; await click(h.trigger()); assert.match(panel().textContent, /Unable to load notifications/);
    assert.equal(button(panel(), "Sign Out").disabled, false); assert.ok(panel().querySelector('a[href="/profile"]'));
    h.state.loadError = false; await click(button(panel(), "Retry")); assert.equal(panel().querySelector('[role="alert"]'), null);
    h.state.readError = true; await click(button(panel(), "Mark all read")); assert.match(panel().textContent, /Could not mark notifications as read/);
    assert.ok(button(panel(), "Mark all read")); assert.equal(button(panel(), "Sign Out").disabled, false);
  } finally { await h.close(); }
});

test("sign out retains failure feedback and clears the booking draft only after a successful retry", async () => {
  const h = await mount(); const originalError = console.error;
  console.error = () => {};
  try {
    h.state.serverLogout = false; h.state.localLogoutError = true;
    await click(h.trigger()); await click(button(panel(), "Sign Out"));
    assert.match(panel().textContent, /Could not sign out/); assert.equal(h.state.reset, 0);
    h.state.serverLogout = true; h.state.localLogoutError = false; await click(button(panel(), "Sign Out"));
    assert.equal(panel(), null); assert.equal(h.state.reset, 1);
    assert.deepEqual(h.calls.signouts, [{ scope: "local" }, { scope: "local" }]);
    assert.deepEqual(h.calls.fetches[0], { url: "/api/auth/logout", options: { method: "POST" } });
    assert.ok(h.container.querySelector('a[href="/auth/login"]'));
  } finally { console.error = originalError; await h.close(); }
});
