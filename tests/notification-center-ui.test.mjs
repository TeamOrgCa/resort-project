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

function compactViewport(initial = true) {
  const original = window.matchMedia;
  const listeners = new Set();
  const media = { matches: initial, addEventListener: (_event, listener) => listeners.add(listener), removeEventListener: (_event, listener) => listeners.delete(listener) };
  window.matchMedia = () => media;
  return { change: matches => act(async () => { media.matches = matches; listeners.forEach(listener => listener()); }),
    restore: () => { if (original) window.matchMedia = original; else delete window.matchMedia; }, listeners };
}

async function mount({ rows = [row("first")], userId = "guest", menus = null, clearStorage = true, preferences = {}, deferRead = null, staffRole = "admin", pathname = "/" } = {}) {
  if (clearStorage) sessionStorage.clear();
  const state = { rows, readError: false, writeError: false, defer: deferRead, preferenceError: false, deferPreference: null, deferUser: null, rawRows: false };
  const calls = { reads: [], writes: [], preferenceWrites: [], authReads: 0, subscriptions: 0, unsubscribed: 0, removed: [], intervals: [], cleared: [] };
  let activeUser = userId;
  const user = id => id ? { id, email: `${id}@example.com`, user_metadata: { notification_popups_enabled: preferences[id] } } : null;
  let authChanged;
  const originalSetInterval = window.setInterval, originalClearInterval = window.clearInterval;
  window.setInterval = (callback, delay) => { calls.intervals.push({ callback, delay }); return calls.intervals.length; };
  window.clearInterval = id => calls.cleared.push(id);
  const channels = [];
  const client = {
    auth: { getUser: async () => {
        calls.authReads++;
        const result = { data: { user: user(activeUser) } };
        return state.deferUser ? state.deferUser(result) : result;
      },
      updateUser: async payload => {
        const account = activeUser; calls.preferenceWrites.push({ account, payload });
        const save = () => { if (state.preferenceError) return { error: Error("Offline") }; preferences[account] = payload.data.notification_popups_enabled; return { data: { user: user(account) }, error: null }; };
        return state.deferPreference ? state.deferPreference(save) : save();
      },
      onAuthStateChange(callback) { calls.subscriptions++; authChanged = callback; return { data: { subscription: { unsubscribe() { calls.unsubscribed++; } } } }; } },
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
          const result = { data: state.rows.filter(item => state.rawRows || item.recipient_id === recipient).map(item => ({ ...item })), error: state.readError ? Error("Offline") : null };
          if (state.defer) return state.defer(result, recipient).then(resolve, reject);
          return Promise.resolve(result).then(resolve, reject);
        } };
      return q;
    },
    channel(name) { const channel = { name, on(_event, filter, callback) { channel.filter = filter; channel.callback = callback; return channel; }, subscribe() { return channel; } }; channels.push(channel); return channel; },
    removeChannel: async channel => { calls.removed.push(channel.name); },
  };
  const cache = new Map(), mocks = { "@/lib/supabase/client": { createClient: () => client }, "next/navigation": { usePathname: () => pathname } };
  const { default: Center, useNotificationCenter } = loadTsModule("components/notifications/NotificationCenter.tsx", mocks, cache);
  function Probe() {
    const center = useNotificationCenter();
    return el("div", null, el("p", { "data-feed": true }, center.notifications.map(item => `${item.notification_id}:${item.is_read}`).join(",")),
      el("p", { "data-error": true }, center.error), el("button", { onClick: center.refresh }, "Refresh feed"), el("button", { onClick: center.markAllRead }, "Read feed"));
  }
  let menu;
  if (menus === "guest") { const Menu = loadTsModule("components/UserMenu.tsx", mocks, cache).default; menu = el("div", null, el(Menu), el(Menu)); }
  if (menus === "admin") { const Menu = loadTsModule("components/admin/AdminNotifications.tsx", mocks, cache).default; menu = el(Menu, { role: staffRole }); }
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const render = () => root.render(el(Center, null, el(Probe), menu));
  await act(async () => render());
  return { container, state, calls, channels,
    navigate: next => act(async () => { pathname = next; render(); }),
    emit: () => act(async () => channels.at(-1)?.callback()),
    auth: id => act(async () => { activeUser = id; authChanged?.("SIGNED_IN", id ? { user: user(id) } : null); }),
    serverAuth: id => { activeUser = id; },
    sessionEvent: detail => act(async () => window.dispatchEvent(new window.CustomEvent("marville:session-change", { detail }))),
    focus: () => act(async () => window.dispatchEvent(new window.Event("focus"))),
    poll: () => act(async () => [...calls.intervals].forEach(interval => interval.callback())),
    close: async () => { await act(async () => root.unmount()); container.remove(); window.setInterval = originalSetInterval; window.clearInterval = originalClearInterval; },
  };
}

test("authentication screens never load account notifications even when another tab has a session", async () => {
  for (const pathname of ["/staff/login", "/admin/login", "/admin/login/", "/auth/login", "/auth/register", "/auth/forgot", "/auth/reset", "/auth/confirm/complete", "/staff/change-password", "/staff/no-access", null]) {
    const h = await mount({ pathname, menus: "guest" });
    try {
      await h.auth("guest");
      await h.sessionEvent("changed");
      await act(async () => window.dispatchEvent(new window.StorageEvent("storage", { key: "marville:session-changed", newValue: "another-tab-signed-in" })));
      await h.focus(); await h.poll();
      assert.equal(alerts(), null, String(pathname));
      assert.equal(h.container.querySelector("[data-feed]").textContent, "");
      assert.equal(h.container.querySelector('[aria-label="Open user menu"]'), null);
      assert.equal(h.calls.authReads, 0);
      assert.equal(h.calls.subscriptions, 0);
      assert.equal(h.calls.reads.length, 0);
      assert.equal(h.channels.length, 0);
      await click(button(h.container, "Read feed"));
      assert.equal(h.calls.writes.length, 0);
    } finally { await h.close(); }
  }
});

test("navigating to login clears popups, retires the feed and ignores late responses without dismissing saved notifications", async () => {
  for (const pathname of ["/staff/login", "/auth/login"]) {
    const h = await mount(); let release;
    try {
      assert.ok(alerts());
      h.state.defer = result => new Promise(resolve => { release = () => resolve(result); });
      await h.focus();
      const oldChannel = h.channels[0];
      await h.navigate(pathname);
      assert.equal(alerts(), null);
      assert.equal(h.calls.unsubscribed, 1);
      assert.equal(h.calls.removed.length, 1);
      assert.equal(h.calls.cleared.length, 2);
      const reads = h.calls.reads.length;
      await act(async () => { release(); oldChannel.callback(); });
      await h.auth("guest"); await h.focus(); await h.poll();
      assert.equal(alerts(), null);
      assert.equal(h.calls.reads.length, reads);
      assert.equal(h.container.querySelector("[data-feed]").textContent, "");
      assert.equal(sessionStorage.length, 0);
      h.state.defer = null;
      h.state.rows.push(row("new-while-on-login"));
      await h.navigate("/manage");
      assert.match(alerts().textContent, /Booking update first/);
      assert.match(alerts().textContent, /Booking update new-while-on-login/);
      assert.equal(h.calls.writes.length, 0);
    } finally { await h.close(); }
  }
});

test("leaving login verifies the current shared session instead of restoring the previous account's feed", async () => {
  const h = await mount();
  try {
    await h.navigate("/staff/login");
    h.state.rows = [row("other-account", { recipient_id: "other" })];
    h.serverAuth("other");
    await h.navigate("/admin/reservations");
    assert.match(alerts().textContent, /Booking update other-account/);
    assert.doesNotMatch(alerts().textContent, /Booking update first/);
    await h.navigate("/auth/login"); h.serverAuth(null);
    await h.navigate("/");
    assert.equal(alerts(), null);
    assert.equal(h.container.querySelector("[data-feed]").textContent, "");
  } finally { await h.close(); }
});

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

test("popups expire independently after five seconds without refreshes resetting their timers", async () => {
  const originalSetTimeout = window.setTimeout, originalClearTimeout = window.clearTimeout;
  const timers = new Map(); let now = 0, nextId = 0;
  window.setTimeout = (callback, delay) => { const id = ++nextId; timers.set(id, { callback, due: now + delay }); return id; };
  window.clearTimeout = id => timers.delete(id);
  const advance = async ms => {
    now += ms;
    await act(async () => {
      for (const [id, timer] of [...timers]) {
        if (timer.due <= now) { timers.delete(id); timer.callback(); }
      }
    });
  };
  const rows = [row("first"), row("second")];
  const h = await mount({ rows });
  try {
    await advance(2000);
    h.state.rows.unshift(row("later")); await h.emit();
    await advance(2999);
    assert.equal(alerts().querySelectorAll("article").length, 3);
    await h.focus();
    await advance(1);
    assert.equal(alerts().querySelectorAll("article").length, 1);
    assert.match(alerts().textContent, /Booking update later/);
    await advance(1999); assert.ok(alerts());
    await advance(1); assert.equal(alerts(), null);
    await h.poll(); assert.equal(alerts(), null);
    assert.equal(h.calls.writes.length, 0);
    assert.equal(h.container.querySelector("[data-feed]").textContent, "later:false,first:false,second:false");
  } finally {
    await h.close();
    assert.equal(timers.size, 0);
    window.setTimeout = originalSetTimeout; window.clearTimeout = originalClearTimeout;
  }
  const reloaded = await mount({ rows, clearStorage: false });
  try { assert.equal(alerts(), null); }
  finally { await reloaded.close(); }
});

test("mobile guest and staff alerts show one compact banner while full notifications remain available", async () => {
  const viewport = compactViewport();
  try {
    for (const role of ["guest", "admin", "staff", "cashier"]) {
      const message = "Full notification details remain in the tray. ".repeat(30);
      const h = await mount({ menus: role === "guest" ? "guest" : "admin", staffRole: role === "guest" ? "admin" : role,
        rows: [row("one", { message }), row("two"), row("three"), row("four")] });
      try {
        assert.equal(alerts().querySelectorAll("article").length, 1, role);
        assert.match(alerts().textContent, /\+3 more/);
        assert.equal(alerts().textContent.includes(message), false);
        assert.equal(alerts().querySelector("a").getAttribute("href"), "/manage");
        await click(alerts().querySelector('[aria-label="Dismiss notification: Booking update one"]'));
        assert.match(alerts().textContent, /Booking update two/); assert.match(alerts().textContent, /\+2 more/);
        const open = h.container.querySelector(role === "guest" ? '[aria-label="Open user menu"]' : '[aria-label="Open admin notifications"]');
        await click(open); assert.equal(alerts(), null);
        assert.ok(document.body.textContent.includes(message), "the tray retains the full text even after popup dismissal");
        if (role === "guest") await click(document.querySelector('[aria-label="Close user menu"]'));
        else await click(h.container.querySelector('[aria-label="Close notifications"]'));
        await click(button(alerts(), "Dismiss all")); assert.equal(alerts(), null);
        assert.equal(h.calls.writes.length, 0); assert.match(h.container.querySelector("[data-feed]").textContent, /one:false/);
      } finally { await h.close(); }
    }
    assert.equal(viewport.listeners.size, 0);
  } finally { viewport.restore(); }
});

test("resizing switches between the desktop stack and compact banner without discarding queued notifications", async () => {
  const viewport = compactViewport(false), h = await mount({ rows: [row("one"), row("two"), row("three"), row("four")] });
  try {
    assert.equal(alerts().querySelectorAll("article").length, 3);
    await viewport.change(true);
    assert.equal(alerts().querySelectorAll("article").length, 1); assert.match(alerts().textContent, /\+3 more/);
    await viewport.change(false);
    assert.equal(alerts().querySelectorAll("article").length, 3); assert.match(alerts().textContent, /1 more waiting/);
    assert.equal(h.calls.writes.length, 0);
  } finally { await h.close(); viewport.restore(); }
});

test("compact alerts start expiry timers only for the visible notification", async () => {
  const viewport = compactViewport(), timers = new Map(); let nextId = 0;
  const originalSetTimeout = window.setTimeout, originalClearTimeout = window.clearTimeout;
  window.setTimeout = (callback, delay) => { const id = ++nextId; timers.set(id, { callback, delay }); return id; };
  window.clearTimeout = id => timers.delete(id);
  const h = await mount({ rows: [row("one"), row("two"), row("three")] });
  try {
    assert.equal(timers.size, 1); const [id, timer] = [...timers][0]; assert.equal(timer.delay, 5000);
    await act(async () => { timers.delete(id); timer.callback(); });
    assert.equal(timers.size, 1); assert.match(alerts().textContent, /Booking update two/);
    assert.equal(h.calls.writes.length, 0);
  } finally { await h.close(); viewport.restore(); window.setTimeout = originalSetTimeout; window.clearTimeout = originalClearTimeout; }
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
  assert.equal(h.calls.removed.length, 1); assert.equal(h.calls.unsubscribed, 1); assert.equal(h.calls.cleared.length, 2);
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

test("server-cookie logout and account switches are detected without Supabase auth events", async () => {
  const h = await mount({ rows: [row("first"), row("other", { recipient_id: "other" })] });
  try {
    h.serverAuth(null);
    await h.focus();
    assert.equal(alerts(), null);
    assert.equal(h.container.querySelector("[data-feed]").textContent, "");
    const oldChannel = h.channels[0], reads = h.calls.reads.length;
    await act(async () => oldChannel.callback());
    assert.equal(h.calls.reads.length, reads, "retired realtime callbacks cannot query notifications");
    h.serverAuth("other"); await h.poll();
    assert.match(alerts().textContent, /Booking update other/);
    assert.equal(alerts().textContent.includes("Booking update first"), false);
    h.serverAuth("guest"); await h.focus();
    assert.match(alerts().textContent, /Booking update first/);
    assert.equal(alerts().textContent.includes("Booking update other"), false);
  } finally { await h.close(); }
});

test("session transitions hide popups immediately and never restore a previous login's cached feed", async () => {
  const h = await mount(); let release;
  try {
    await h.sessionEvent("changing"); assert.equal(alerts(), null);
    await h.focus(); assert.equal(alerts(), null, "the old cookie must not restore data during logout");
    h.serverAuth(null); await h.sessionEvent("changed"); assert.equal(alerts(), null);
    h.state.rows = [];
    h.state.defer = result => new Promise(resolve => { release = () => resolve(result); });
    await h.auth("guest");
    assert.equal(alerts(), null, "same-account login cannot reuse the previous session's feed");
    await act(async () => release()); assert.equal(alerts(), null);
  } finally { await h.close(); }
});

test("an in-flight identity check or feed from an older session cannot repopulate a new login", async () => {
  const h = await mount(); const releases = [];
  try {
    h.state.deferUser = result => new Promise(resolve => releases.push(() => resolve(result)));
    await h.focus();
    await h.auth(null);
    h.state.rows = []; h.state.deferUser = null;
    await h.auth("guest");
    await act(async () => releases.forEach(release => release()));
    assert.equal(alerts(), null);
    assert.equal(h.container.querySelector("[data-feed]").textContent, "");
  } finally { await h.close(); }
});

test("recipient mismatches are discarded even if a response contains another account's rows", async () => {
  const h = await mount();
  try {
    h.state.rawRows = true;
    h.state.rows.push(row("private", { recipient_id: "other" }));
    await h.focus();
    assert.equal(alerts().textContent.includes("Booking update private"), false);
    assert.equal(h.container.querySelector("[data-feed]").textContent, "first:false");
  } finally { await h.close(); }
});

test("another tab's session-change signal clears notifications and verifies the current cookies", async () => {
  const h = await mount();
  try {
    h.serverAuth(null);
    await act(async () => window.dispatchEvent(new window.StorageEvent("storage", { key: "marville:session-changed", newValue: "changed" })));
    assert.equal(alerts(), null);
  } finally { await h.close(); }
});

test("guest and staff trays use the same verified account as popups after cookie-only session changes", async () => {
  for (const menus of ["guest", "admin"]) {
    const h = await mount({ menus });
    const label = menus === "guest" ? "Open user menu" : "Open admin notifications";
    try {
      assert.ok(h.container.querySelector(`[aria-label="${label}"]`));
      h.serverAuth(null); await h.focus();
      assert.equal(h.container.querySelector(`[aria-label="${label}"]`), null);
      assert.equal(alerts(), null);
      h.state.rows = [row("new-account", { recipient_id: "other" })];
      h.serverAuth("other"); await h.sessionEvent("changed");
      assert.ok(h.container.querySelector(`[aria-label="${label}"]`));
      assert.match(alerts().textContent, /Booking update new-account/);
      await click(h.container.querySelector(`[aria-label="${label}"]`));
      const panel = menus === "guest" ? document.querySelector('[aria-label="Your account and notifications"]') : h.container;
      assert.match(panel.textContent, /Booking update new-account/);
      assert.equal(panel.textContent.includes("Booking update first"), false);
    } finally { await h.close(); }
  }
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

test("opening trays preserves unread status until Mark all read is selected", async () => {
  for (const menus of ["guest", "admin"]) {
    const h = await mount({ menus });
    try {
      assert.equal(h.calls.reads.length, 1); assert.equal(alerts().querySelectorAll("article").length, 1);
      const trigger = h.container.querySelector(`[aria-label="${menus === "guest" ? "Open user menu" : "Open admin notifications"}"]`);
      assert.ok(trigger.querySelector(".bg-accent"));
      await click(trigger); assert.equal(alerts(), null);
      const panel = menus === "guest" ? document.querySelector('[aria-label="Your account and notifications"]') : h.container;
      if (menus === "guest") { assert.ok(panel.querySelector('a[href="/profile"]')); assert.ok(button(panel, "Sign Out")); }
      assert.equal(h.container.querySelector("[data-feed]").textContent, "first:false");
      assert.equal(h.calls.writes.length, 0);
      await click(button(panel, "Mark all read"));
      assert.equal(h.container.querySelector("[data-feed]").textContent, "first:true");
      assert.equal(h.container.querySelector(".bg-accent"), null);
      assert.equal(button(panel, "Mark all read"), undefined);
      assert.equal(h.calls.writes.length, 1);
      if (menus === "guest") await click(panel.querySelector('[aria-label="Close user menu"]')); else await click(trigger);
      assert.equal(alerts(), null);
    } finally { await h.close(); }
  }
});

test("menus opened before the feed loads preserve the loaded unread notifications", async () => {
  for (const menus of ["guest", "admin"]) {
    const releases = [];
    const h = await mount({ menus, deferRead: result => new Promise(resolve => releases.push(() => resolve(result))) });
    try {
      await click(h.container.querySelector(`[aria-label="${menus === "guest" ? "Open user menu" : "Open admin notifications"}"]`));
      assert.equal(h.calls.writes.length, 0);
      h.state.defer = null;
      await act(async () => releases.forEach(release => release()));
      assert.equal(h.container.querySelector("[data-feed]").textContent, "first:false");
      assert.ok(h.container.querySelector(".bg-accent"));
      assert.equal(h.calls.writes.length, 0);
    } finally { await h.close(); }
  }
});

test("failed explicit read updates retain the badge and allow manual retry", async () => {
  for (const menus of ["guest", "admin"]) {
    const h = await mount({ menus });
    try {
      h.state.writeError = true;
      await click(h.container.querySelector(`[aria-label="${menus === "guest" ? "Open user menu" : "Open admin notifications"}"]`));
      const panel = menus === "guest" ? document.querySelector('[aria-label="Your account and notifications"]') : h.container;
      await click(button(panel, "Mark all read"));
      assert.ok(h.container.querySelector(".bg-accent"));
      assert.match(panel.querySelector('[role="alert"]').textContent, /Could not mark/);
      assert.equal(h.calls.writes.length, 1);
      h.state.writeError = false;
      await click(button(panel, "Mark all read"));
      assert.equal(h.container.querySelector(".bg-accent"), null);
      assert.equal(h.calls.writes.length, 2);
    } finally { await h.close(); }
  }
});

test("staff and guest trays filter All, Read and Unread with distinct status colors", async () => {
  for (const menus of ["guest", "admin", "staff", "cashier"]) {
    const h = await mount({ menus: menus === "guest" ? "guest" : "admin", staffRole: menus === "staff" || menus === "cashier" ? menus : "admin", rows: [row("new"), row("old", { is_read: true })] });
    try {
      await click(h.container.querySelector(`[aria-label="${menus === "guest" ? "Open user menu" : "Open admin notifications"}"]`));
      const panel = menus === "guest" ? document.querySelector('[aria-label="Your account and notifications"]') : h.container;
      const list = panel.querySelector('[aria-label="Recent notifications"]');
      assert.match(list.textContent, /Booking update new/); assert.match(list.textContent, /Booking update old/);
      assert.ok(list.querySelector('.bg-blue-50')); assert.ok(list.querySelector('.bg-slate-50'));
      await click(button(panel, "Read")); assert.equal(button(panel, "Read").getAttribute("aria-pressed"), "true");
      assert.doesNotMatch(list.textContent, /Booking update new/); assert.match(list.textContent, /Booking update old/);
      await click(button(panel, "Unread")); assert.match(list.textContent, /Booking update new/); assert.doesNotMatch(list.textContent, /Booking update old/);
      assert.equal(h.calls.writes.length, 0);
      await click(button(panel, "Mark all read")); assert.match(list.textContent, /No unread notifications/);
      await click(button(panel, "All")); assert.match(list.textContent, /Booking update old/); assert.match(list.textContent, /Booking update new/);
    } finally { await h.close(); }
  }
});

test("managers and cashiers can save the same popup preference as guests without marking notifications read", async () => {
  for (const staffRole of ["staff", "cashier"]) {
    const h = await mount({ menus: "admin", staffRole });
    try {
      await click(h.container.querySelector('[aria-label="Open admin notifications"]'));
      const toggle = () => h.container.querySelector('[role="switch"][aria-label="Pop-up notifications"]');
      assert.equal(toggle().getAttribute("aria-checked"), "true");
      h.state.preferenceError = true;
      await click(toggle());
      assert.equal(toggle().getAttribute("aria-checked"), "true");
      assert.match(h.container.querySelector('[role="alert"]').textContent, /Could not save/);
      h.state.preferenceError = false;
      await click(toggle());
      assert.equal(toggle().getAttribute("aria-checked"), "false");
      assert.equal(h.calls.preferenceWrites.at(-1).payload.data.notification_popups_enabled, false);
      assert.equal(h.calls.writes.length, 0);
      await click(h.container.querySelector('[aria-label="Open admin notifications"]'));
      assert.equal(alerts(), null);
    } finally { await h.close(); }
  }
});

test("opening one notification marks only that item read", async () => {
  for (const menus of ["guest", "admin"]) {
    const h = await mount({ menus, rows: [row("opened"), row("waiting")] });
    try {
      await click(h.container.querySelector(`[aria-label="${menus === "guest" ? "Open user menu" : "Open admin notifications"}"]`));
      const panel = menus === "guest" ? document.querySelector('[aria-label="Your account and notifications"]') : h.container;
      const link = panel.querySelector('[aria-label="Recent notifications"] a');
      link.addEventListener("click", event => event.preventDefault());
      await act(async () => link.click());
      assert.equal(h.container.querySelector("[data-feed]").textContent, "opened:true,waiting:false");
      assert.equal(h.calls.writes.length, 1);
      assert.deepEqual(h.calls.writes[0].filters, [["recipient_id", "guest"], ["notification_id", ["opened"]]]);
    } finally { await h.close(); }
  }
});

test("admin payment notifications show the Philippine date after midnight even on a UTC device", async () => {
  const original = process.env.TZ; process.env.TZ = "UTC";
  const h = await mount({ menus: "admin", rows: [row("payment", { title: "Recent payment", created_at: "2026-10-16T16:30:00Z" })] });
  try {
    await click(h.container.querySelector('[aria-label="Open admin notifications"]'));
    assert.match(h.container.textContent, /Recent payment/);
    assert.match(h.container.textContent, /Oct 17.*12:30 AM/);
    assert.doesNotMatch(h.container.textContent, /Oct 16/);
  } finally {
    await h.close(); if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
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

test("the guest switch disables new popups while retaining notifications, then enables them again", async () => {
  const h = await mount({ menus: "guest" });
  const panel = () => document.querySelector('[aria-label="Your account and notifications"]');
  const open = () => click(h.container.querySelector('[aria-label="Open user menu"]'));
  const close = () => click(panel().querySelector('[aria-label="Close user menu"]'));
  try {
    assert.ok(alerts()); await open();
    const toggle = () => panel().querySelector('[role="switch"][aria-label="Pop-up notifications"]');
    assert.equal(toggle().getAttribute("aria-checked"), "true");
    await click(toggle()); assert.equal(toggle().getAttribute("aria-checked"), "false");
    assert.match(panel().textContent, /Off.*updates stay in this menu/);
    assert.deepEqual(h.calls.preferenceWrites, [{ account: "guest", payload: { data: { notification_popups_enabled: false } } }]);
    await close(); assert.equal(alerts(), null);
    h.state.rows.unshift(row("new")); await h.emit(); assert.equal(alerts(), null);
    assert.equal(h.container.querySelector("[data-feed]").textContent, "new:false,first:false");
    await open(); assert.match(panel().textContent, /Booking update new/);
    await click(button(panel(), "Mark all read"));
    assert.equal(h.container.querySelector("[data-feed]").textContent, "new:true,first:true");
    await click(toggle()); assert.equal(toggle().getAttribute("aria-checked"), "true");
    await close(); assert.equal(alerts(), null);
    h.state.rows.unshift(row("enabled")); await h.emit();
    assert.equal(alerts().querySelectorAll("article").length, 1);
    assert.match(alerts().textContent, /Booking update enabled/);
    assert.equal(h.calls.writes.length, 1);
  } finally { await h.close(); }
});

test("popup preferences persist with the guest account across reloads and do not mute another account", async () => {
  const preferences = { guest: false, other: true };
  const rows = [row("guest-message"), row("other-message", { recipient_id: "other" })];
  for (let attempt = 0; attempt < 2; attempt++) {
    const h = await mount({ menus: "guest", preferences, rows });
    try {
      assert.equal(alerts(), null);
      await click(h.container.querySelector('[aria-label="Open user menu"]'));
      const panel = document.querySelector('[aria-label="Your account and notifications"]');
      assert.equal(panel.querySelector('[role="switch"]').getAttribute("aria-checked"), "false");
      await click(panel.querySelector('[aria-label="Close user menu"]'));
      await h.auth("other"); assert.match(alerts().textContent, /Booking update other-message/);
      await h.auth("guest"); assert.equal(alerts(), null);
    } finally { await h.close(); }
  }
});

test("failed preference saves retain the previous setting, show retry feedback and prevent duplicate saves", async () => {
  const h = await mount({ menus: "guest" }); let release;
  try {
    await click(h.container.querySelector('[aria-label="Open user menu"]'));
    const panel = () => document.querySelector('[aria-label="Your account and notifications"]');
    const toggle = () => panel().querySelector('[role="switch"]');
    h.state.preferenceError = true;
    h.state.deferPreference = save => new Promise(resolve => { release = () => resolve(save()); });
    await click(toggle()); assert.equal(toggle().disabled, true); assert.match(panel().textContent, /Saving preference/);
    await act(async () => toggle().click()); assert.equal(h.calls.preferenceWrites.length, 1);
    await act(async () => release()); assert.equal(toggle().getAttribute("aria-checked"), "true");
    assert.match(panel().querySelector('[role="alert"]').textContent, /Could not save your notification preference/);
    h.state.preferenceError = false; h.state.deferPreference = null;
    await click(toggle()); assert.equal(toggle().getAttribute("aria-checked"), "false");
    assert.equal(panel().querySelector('[role="alert"]'), null);
  } finally { await h.close(); }
});
