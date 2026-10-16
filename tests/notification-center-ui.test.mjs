import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement as el } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true });
for (const name of ["window", "document", "HTMLElement", "Node", "sessionStorage"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const row = (id, extras = {}) => ({ notification_id: id, recipient_id: "guest", title: `Booking update ${id}`, message: "Your reschedule request was approved. Check the new date and remaining balance.", action_url: "/manage", is_read: false, created_at: new Date().toISOString(), ...extras });
const alerts = () => document.querySelector('[aria-label="New notifications"]');
const button = (container, text) => [...container.querySelectorAll("button")].find(button => button.textContent.trim() === text);
async function click(control) { assert.ok(control); assert.equal(control.disabled, false); await act(async () => control.click()); }

async function mount({ rows = [row("first")], userId = "guest", menus = null, clearStorage = true } = {}) {
  if (clearStorage) sessionStorage.clear();
  const state = { rows, readError: false, writeError: false, defer: null };
  const calls = { reads: [], writes: [], unsubscribed: 0, removed: [], intervals: [], cleared: [] };
  let authChanged;
  const originalSetInterval = window.setInterval, originalClearInterval = window.clearInterval;
  window.setInterval = (callback, delay) => { calls.intervals.push({ callback, delay }); return calls.intervals.length; };
  window.clearInterval = id => calls.cleared.push(id);
  const channels = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId, email: `${userId}@example.com` } : null } }),
      onAuthStateChange(callback) { authChanged = callback; return { data: { subscription: { unsubscribe() { calls.unsubscribed++; } } } }; } },
    from(table) {
      const filters = []; let update;
      const q = { select: () => q, eq: (key, value) => { filters.push([key, value]); return q; }, in: (key, value) => { filters.push([key, value]); return q; },
        order: () => q, limit: () => q, update: value => { update = value; return q; },
        maybeSingle: async () => ({ data: { first_name: "Test", last_name: "Guest" }, error: null }),
        then(resolve, reject) {
          const recipient = filters.find(([key]) => key === "recipient_id")?.[1];
          if (update) {
            calls.writes.push({ table, filters, update });
            if (!state.writeError) state.rows = state.rows.map(item => item.recipient_id === recipient && filters.find(([key]) => key === "notification_id")?.[1].includes(item.notification_id) ? { ...item, ...update } : item);
            return Promise.resolve({ error: state.writeError ? Error("Offline") : null }).then(resolve, reject);
          }
          calls.reads.push({ table, filters });
          const result = { data: state.rows.filter(item => item.recipient_id === recipient).map(item => ({ ...item })), error: state.readError ? Error("Offline") : null };
          if (state.defer) return state.defer(result, recipient).then(resolve, reject);
          return Promise.resolve(result).then(resolve, reject);
        } };
      return q;
    },
    channel(name) { const channel = { name, on(_event, filter, callback) { channel.filter = filter; channel.callback = callback; return channel; }, subscribe() { return channel; } }; channels.push(channel); return channel; },
    removeChannel: async channel => { calls.removed.push(channel.name); },
  };
  const cache = new Map(), mocks = { "@/lib/supabase/client": { createClient: () => client } };
  const { default: Center, useNotificationCenter } = loadTsModule("components/notifications/NotificationCenter.tsx", mocks, cache);
  function Probe() {
    const center = useNotificationCenter();
    return el("div", null, el("p", { "data-feed": true }, center.notifications.map(item => `${item.notification_id}:${item.is_read}`).join(",")),
      el("p", { "data-error": true }, center.error), el("button", { onClick: center.refresh }, "Refresh feed"), el("button", { onClick: center.markAllRead }, "Read feed"));
  }
  let menu;
  if (menus === "guest") { const Menu = loadTsModule("components/UserMenu.tsx", mocks, cache).default; menu = el("div", null, el(Menu), el(Menu)); }
  if (menus === "admin") { const Menu = loadTsModule("components/admin/AdminNotifications.tsx", mocks, cache).default; menu = el(Menu, { role: "admin" }); }
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(el(Center, null, el(Probe), menu)));
  return { container, state, calls, channels,
    emit: () => act(async () => channels.at(-1)?.callback()),
    auth: id => act(async () => authChanged("SIGNED_IN", id ? { user: { id } } : null)),
    focus: () => act(async () => window.dispatchEvent(new window.Event("focus"))),
    poll: () => act(async () => calls.intervals.at(-1).callback()),
    close: async () => { await act(async () => root.unmount()); container.remove(); window.setInterval = originalSetInterval; window.clearInterval = originalClearInterval; },
  };
}

test("unread notifications appear automatically, dismiss individually/all, and remain saved without reappearing on reload", async () => {
  const rows = [row("1"), row("2"), row("3"), row("4"), row("read", { is_read: true })];
  const h = await mount({ rows });
  try {
    assert.ok(alerts()); assert.equal(h.container.contains(alerts()), false); assert.equal(alerts().querySelectorAll("article").length, 3);
    assert.match(alerts().textContent, /1 more waiting/); assert.equal(alerts().textContent.includes("Booking update read"), false);
    assert.equal(alerts().querySelector("a").getAttribute("href"), "/manage");
    await click(alerts().querySelector('[aria-label="Dismiss notification: Booking update 1"]'));
    assert.equal(alerts().textContent.includes("Booking update 1"), false); assert.match(alerts().textContent, /Booking update 4/);
    await h.focus(); assert.equal(alerts().textContent.includes("Booking update 1"), false);
    await click(button(alerts(), "Dismiss all")); assert.equal(alerts(), null);
    assert.match(h.container.querySelector("[data-feed]").textContent, /1:false/); assert.equal(h.calls.writes.length, 0);
  } finally { await h.close(); }
  const reloaded = await mount({ rows, clearStorage: false });
  try { assert.equal(alerts(), null); assert.match(reloaded.container.querySelector("[data-feed]").textContent, /4:false/); }
  finally { await reloaded.close(); }
});

test("realtime, polling and return-to-page refreshes show new notifications without duplicates", async () => {
  const h = await mount({ rows: [] });
  try {
    assert.equal(alerts(), null); assert.equal(h.calls.intervals[0].delay, 15000);
    assert.deepEqual(h.channels[0].filter, { event: "*", schema: "public", table: "notifications", filter: "recipient_id=eq.guest" });
    h.state.rows = [row("live")]; await h.emit(); assert.match(alerts().textContent, /Booking update live/);
    await h.emit(); assert.equal(alerts().querySelectorAll("article").length, 1);
    h.state.rows.unshift(row("polled")); await h.poll(); assert.equal(alerts().querySelectorAll("article").length, 2);
    h.state.rows.unshift(row("focus")); await h.focus(); assert.equal(alerts().querySelectorAll("article").length, 3);
  } finally { await h.close(); }
  assert.equal(h.calls.removed.length, 1); assert.equal(h.calls.unsubscribed, 1); assert.equal(h.calls.cleared.length, 1);
});

test("account changes clear previous popups and discard old in-flight responses", async () => {
  const h = await mount(); let release;
  try {
    h.state.defer = (result, recipient) => recipient === "guest" ? new Promise(resolve => { release = () => resolve(result); }) : Promise.resolve(result);
    await h.focus();
    h.state.rows.push(row("other", { recipient_id: "other" })); await h.auth("other");
    assert.match(alerts().textContent, /Booking update other/); assert.equal(alerts().textContent.includes("Booking update first"), false);
    await act(async () => release()); assert.equal(alerts().textContent.includes("Booking update first"), false);
    assert.deepEqual(h.calls.reads.at(-1).filters, [["recipient_id", "other"]]);
    await h.auth(null); assert.equal(alerts(), null); assert.equal(h.container.querySelector("[data-feed]").textContent, "");
  } finally { await h.close(); }
});

test("read failures are retryable and an older fetch cannot undo successful mark-all-read", async () => {
  const h = await mount(); let release;
  try {
    h.state.readError = true; await h.focus(); assert.match(h.container.querySelector("[data-error]").textContent, /Unable to load/);
    h.state.readError = false; await click(button(h.container, "Refresh feed"));
    h.state.writeError = true; await click(button(h.container, "Read feed")); assert.ok(alerts()); assert.match(h.container.querySelector("[data-error]").textContent, /Could not mark/);
    h.state.writeError = false;
    h.state.defer = result => new Promise(resolve => { release = () => resolve(result); }); await h.focus();
    await click(button(h.container, "Read feed")); assert.equal(alerts(), null);
    h.state.defer = null; await act(async () => release()); assert.equal(alerts(), null);
    assert.equal(h.container.querySelector("[data-feed]").textContent, "first:true");
    assert.deepEqual(h.calls.writes.at(-1).filters, [["recipient_id", "guest"], ["notification_id", ["first"]]]);
  } finally { await h.close(); }
});

test("guest and admin menus share one feed; open menus keep account controls clear of popups", async () => {
  for (const menus of ["guest", "admin"]) {
    const h = await mount({ menus });
    try {
      assert.equal(h.calls.reads.length, 1); assert.equal(alerts().querySelectorAll("article").length, 1);
      const trigger = h.container.querySelector(`[aria-label="${menus === "guest" ? "Open user menu" : "Open admin notifications"}"]`);
      await click(trigger); assert.equal(alerts(), null);
      const panel = menus === "guest" ? document.querySelector('[aria-label="Your account and notifications"]') : h.container;
      if (menus === "guest") { assert.ok(panel.querySelector('a[href="/profile"]')); assert.ok(button(panel, "Sign Out")); }
      await click(button(panel, "Mark all read"));
      assert.equal(h.container.querySelector("[data-feed]").textContent, "first:true");
      if (menus === "guest") await click(panel.querySelector('[aria-label="Close user menu"]')); else await click(trigger);
      assert.equal(alerts(), null);
    } finally { await h.close(); }
  }
});

test("anonymous users do not subscribe or fetch; unsafe action URLs never become popup links", async () => {
  const anonymous = await mount({ userId: null });
  try { assert.equal(anonymous.calls.reads.length, 0); assert.equal(anonymous.channels.length, 0); assert.equal(alerts(), null); }
  finally { await anonymous.close(); }
  const h = await mount({ rows: [row("unsafe", { action_url: "//example.com" }), row("script", { action_url: "javascript:alert(1)" })] });
  try { assert.equal(alerts().querySelectorAll("a").length, 0); }
  finally { await h.close(); }
});
