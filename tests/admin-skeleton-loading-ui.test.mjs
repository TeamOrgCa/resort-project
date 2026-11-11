import test, { after } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin" });
for (const key of ["window", "document", "HTMLElement", "Node"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

const button = (host, text) => [...host.querySelectorAll("button")].find(item => item.textContent.trim() === text);
const placeholders = host => host.querySelectorAll(".animate-pulse");

async function mount(filename, props = {}, mocks = {}) {
  const Component = loadTsModule(filename, mocks).default;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(Component, props)));
  return { host, async render(next) { await act(async () => root.render(createElement(Component, next))); },
    async close() { await act(async () => root.unmount()); host.remove(); } };
}

function pendingFetch() {
  const previous = globalThis.fetch, requests = [];
  globalThis.fetch = () => new Promise(resolve => requests.push(resolve));
  return { async respond(payload, status = 200) { assert.ok(requests.length); await act(async () => requests.shift()(Response.json(payload, { status }))); },
    restore() { globalThis.fetch = previous; } };
}

test("table loading hides empty and stale rows, disables actions, then restores records and empty states", async () => {
  const props = { title: "Staff accounts", columns: [{ key: "name", label: "Name" }], rows: [],
    actions: ["Add Staff User"], rowActions: ["Edit"], isLoading: true };
  const h = await mount("components/admin/AdminTablePreview.tsx", props);
  try {
    assert.equal(h.host.querySelector("section").getAttribute("aria-busy"), "true");
    assert.match(h.host.querySelector('[role="status"]').textContent, /Loading staff accounts/);
    assert.ok(placeholders(h.host).length);
    assert.doesNotMatch(h.host.textContent, /No records match|Showing 0/);
    assert.equal(button(h.host, "Add Staff User").disabled, true);
    assert.equal(h.host.querySelector('tbody [tabindex="0"]'), null);
    const loaded = { ...props, rows: [{ id: "staff", name: "Maria" }], isLoading: false };
    await h.render(loaded);
    assert.equal(placeholders(h.host).length, 0);
    assert.match(h.host.querySelector("tbody").textContent, /Maria/);
    assert.equal(button(h.host, "Add Staff User").disabled, false);
    await h.render({ ...loaded, isLoading: true });
    assert.doesNotMatch(h.host.querySelector("tbody").textContent, /Maria/);
    await h.render({ ...props, isLoading: false });
    assert.equal(placeholders(h.host).length, 0);
    assert.match(h.host.textContent, /No records match/);
  } finally { await h.close(); }
});

test("staff accounts wait for the real response before showing records and enabling create", async () => {
  const request = pendingFetch();
  const h = await mount("app/admin/(portal)/users/page.tsx");
  try {
    assert.ok(placeholders(h.host).length);
    assert.doesNotMatch(h.host.textContent, /No records match/);
    assert.equal(button(h.host, "Add Staff User").disabled, true);
    await request.respond({ success: true, currentStaffUserId: "admin", rows: [{ id: "staff", full_name: "Maria Cruz", email: "maria@example.com", role: "staff", is_active: true, last_login_at: null, created_at: "2026-11-01T01:00:00Z" }] });
    assert.equal(placeholders(h.host).length, 0);
    assert.match(h.host.textContent, /Maria Cruz/);
    assert.equal(button(h.host, "Add Staff User").disabled, false);
  } finally { await h.close(); request.restore(); }
});

test("permission failures remove skeletons, expose the error and keep saving disabled", async () => {
  const request = pendingFetch();
  const h = await mount("components/admin/users/RolePermissionsEditor.tsx");
  try {
    assert.ok(placeholders(h.host).length);
    assert.equal(h.host.querySelector('input[type="checkbox"]'), null);
    await request.respond({ message: "Permissions unavailable" }, 500);
    assert.equal(placeholders(h.host).length, 0);
    assert.match(h.host.querySelector('[role="alert"]').textContent, /Permissions unavailable/);
    assert.equal(button(h.host, "Save permissions").disabled, true);
  } finally { await h.close(); request.restore(); }
});

test("reports replace skeletons with an error on failure and can retry to real report data", async () => {
  const request = pendingFetch();
  const h = await mount("components/admin/ReportPanel.tsx", { tabs: ["Sales Report"] }, {
    "@/components/content/SiteContent": { useSiteContent: () => ({}), contentText: () => "Marville Resort" },
  });
  try {
    assert.ok(placeholders(h.host).length);
    await request.respond({ success: false, message: "Report unavailable" }, 500);
    assert.equal(placeholders(h.host).length, 0);
    assert.match(h.host.querySelector('[role="alert"]').textContent, /Report unavailable/);
    await act(async () => button(h.host, "Refresh report").click());
    assert.ok(placeholders(h.host).length);
    await request.respond({ success: true, report: {
      startDate: "2026-11-01", endDate: "2026-11-11", generatedAt: "2026-11-11T01:00:00Z", note: "Verified collections.",
      metrics: [{ label: "Verified collections", value: 1000, format: "money", help: "Verified payments" }],
      trend: [], split: [], rows: [],
    } });
    assert.equal(placeholders(h.host).length, 0);
    assert.match(h.host.textContent, /Verified collections/);
    assert.equal(h.host.querySelector('[role="alert"]'), null);
  } finally { await h.close(); request.restore(); }
});
