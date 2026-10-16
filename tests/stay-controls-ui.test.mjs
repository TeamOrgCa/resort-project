import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin" });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client"); after(() => dom.window.close());

test("the permission matrix saves Manager and Cashier changes using one save action", async () => {
  const originalFetch = globalThis.fetch, writes = [];
  globalThis.fetch = async (_url, options) => {
    if (options?.method === "PUT") { writes.push(JSON.parse(options.body)); return Response.json({ success: true }); }
    return Response.json({ roles: [{ role: "staff", permissions: ["reservations"] }, { role: "cashier", permissions: ["transactions"] }] });
  };
  const Component = loadTsModule("components/admin/users/RolePermissionsEditor.tsx").default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Component)));
    assert.equal(container.querySelectorAll("button").length, 1);
    for (const role of ["Manager", "Cashier"]) await act(async () => [...container.querySelectorAll("input")].find(input => input.getAttribute("aria-label").startsWith(role) && !input.disabled && !input.checked).click());
    await act(async () => container.querySelector("button").click());
    assert.equal(writes.length, 1); assert.equal(writes[0].roles.length, 2);
    assert.ok(writes[0].roles.every(role => role.permissions.length === 2));
    assert.match(container.querySelector('[role="status"]').textContent, /permissions saved/);
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; }
});

test("catalog uses Package rates and Units while hiding the duplicate legacy rate tabs", async () => {
  const originalFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async url => { calls.push(String(url)); return Response.json(String(url).includes("resource=references") ? { success: true, references: { units: [], paymentMethods: [] } } : { success: true, records: [], total: 0, counts: { active: 0, archived: 0 } }); };
  const Component = loadTsModule("components/admin/catalog/CatalogClient.tsx", { "next/image": () => null, "./PackageRatesEditor": { __esModule: true, default: () => createElement("div", null, "Package rate editor") } }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Component)));
    const nav = container.querySelector('[aria-label="Catalog categories"]');
    const button = label => [...nav.querySelectorAll("button")].find(node => node.textContent === label);
    assert.equal(button("Unit rates"), undefined); assert.equal(button("Guest rates"), undefined);
    await act(async () => button("Units").click()); assert.ok(calls.some(url => url.includes("resource=units")));
    await act(async () => button("Package rates").click()); assert.match(container.textContent, /Package rate editor/);
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; }
});
