import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/rooms", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "Node", "localStorage"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const classifications = [{ classification_id: "standard", code: "standard", name: "Standard Rooms", included_capacity: 2, maximum_capacity: 2, cleaning_buffer_minutes: 60, extension_hourly_rate: 100, base_rate: 1000, base_hours: 12, additional_guest_rate: 200 }, { classification_id: "family", code: "family", name: "Family Rooms", included_capacity: 4, maximum_capacity: 6, cleaning_buffer_minutes: 60, extension_hourly_rate: 100, base_rate: 1500, base_hours: 12, additional_guest_rate: 200 }];
const rooms = classifications.map((c, index) => ({ room_id: c.code, classification_id: c.classification_id, room_number: index ? "F01" : "S01", name: c.name, classification: c, status: index ? "cleaning" : "vacant", current: null, upcoming: [], maintenance: [], is_active: true }));
async function mount({ role = "admin", initialCategory = null } = {}) {
  const calls = [], routes = [], intervals = [], previousFetch = globalThis.fetch, previousInterval = globalThis.setInterval, previousClear = globalThis.clearInterval;
  localStorage.clear();
  globalThis.fetch = async url => { calls.push(url); return Response.json(url === "/api/admin/rooms" ? { rooms, classifications, updated_at: new Date().toISOString(), server_now: new Date().toISOString() } : { history: [], bill: null }); };
  globalThis.setInterval = (callback, ms) => { intervals.push({ callback, ms }); return intervals.length; };
  globalThis.clearInterval = () => {};
  const Component = loadTsModule("components/admin/rooms/RoomManagement.tsx", { "next/navigation": { useRouter: () => ({ push: path => routes.push(path) }) }, "next/link": { default: props => createElement("a", { href: props.href }, props.children), __esModule: true } }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component, { role, permissions: ["rooms", "transactions"], initialCategory, initialPanel: null })));
  return { container, calls, intervals, routes, close: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = previousFetch; globalThis.setInterval = previousInterval; globalThis.clearInterval = previousClear; } };
}
const click = async el => { assert.ok(el); await act(async () => el.click()); };
test("category views are independent, persist preferences, and expand inside the admin route", async () => {
  const h = await mount();
  try {
    assert.equal(h.container.querySelector('[aria-label="standard grid view"]').getAttribute("aria-pressed"), "true");
    assert.equal(h.container.querySelector('[aria-label="family list view"]').getAttribute("aria-pressed"), "true");
    await click(h.container.querySelector('[aria-label="standard list view"]'));
    assert.equal(h.container.querySelector('[aria-label="family list view"]').getAttribute("aria-pressed"), "true");
    assert.equal(JSON.parse(localStorage.getItem("marville.room.views")).standard, "list");
    await click(h.container.querySelector('[aria-label="Expand Standard Rooms"]')); assert.deepEqual(h.routes, ["/admin/rooms?category=standard"]);
  } finally { await h.close(); }
});
test("summary cards filter actual rooms and entire table rows open the room drawer", async () => {
  const h = await mount();
  try {
    const family = h.container.querySelector('[aria-label="View room F01"]'); await click(family);
    assert.match(document.querySelector('[role="dialog"]').textContent, /F01 — Family Rooms/);
    await click(document.querySelector('[aria-label="Close dialog"]'));
    const vacant = [...h.container.querySelectorAll("button")].find(b => b.textContent.includes("Vacant Rooms")); await click(vacant);
    assert.equal(h.container.querySelector('[aria-label="View room F01"]'), null);
    assert.match(h.container.textContent, /No rooms match your filters/);
  } finally { await h.close(); }
});
test("cashiers see occupancy and billing without operational controls; second ticks never fetch records", async () => {
  const h = await mount({ role: "cashier" });
  try {
    assert.doesNotMatch(h.container.textContent, /Walk-in Check-in|Schedule Maintenance|New Room Reservation|Room Settings/);
    const baseline = h.calls.length, tick = h.intervals.find(i => i.ms === 1000); assert.ok(tick);
    await act(async () => { for (let i = 0; i < 60; i++) tick.callback(); });
    assert.equal(h.calls.length, baseline);
    assert.equal(h.intervals.find(i => i.ms === 60000).ms, 60000);
  } finally { await h.close(); }
});
test("expanded Family Rooms opens its broad grid independently of the compact family list preference", async () => {
  const h = await mount({ initialCategory: "family" });
  try {
    assert.equal(h.container.querySelector('[aria-label="family:expanded grid view"]').getAttribute("aria-pressed"), "true");
    assert.equal(h.container.querySelector('[aria-label="View room F01"]'), null);
    assert.match(h.container.textContent, /Back to Room Management/);
  } finally { await h.close(); }
});
