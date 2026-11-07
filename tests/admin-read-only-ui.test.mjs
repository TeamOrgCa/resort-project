import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/records" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const cache = new Map();
const { AdminReadOnlyProvider } = loadTsModule("components/admin/AdminReadOnlyContext.tsx", {}, cache);
const Table = loadTsModule("components/admin/AdminTablePreview.tsx", {}, cache).default;

test("read-only tables keep working search, filters and details while hiding operational actions", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const props = {
    title: "Reservations", columns: [{ key: "name", label: "Guest" }, { key: "status", label: "Status" }],
    rows: [{ id: "one", name: "Alice", status: "Confirmed" }, { id: "two", name: "Bob", status: "Pending" }],
    filters: [{ key: "status", label: "Status", options: ["Confirmed", "Pending"] }],
    actions: ["Refresh records", "Export CSV", "Print report", "New reservation"], rowActions: ["View details", "Edit", "Approve", "Delete"],
  };
  const buttons = () => [...container.querySelectorAll("button")].map(b => b.textContent.trim());
  try {
    await act(async () => root.render(createElement(AdminReadOnlyProvider, { value: true }, createElement(Table, props))));
    assert.ok(buttons().includes("Refresh records")); assert.ok(buttons().includes("View details"));
    for (const label of ["Export CSV", "Print report", "New reservation", "Edit", "Approve", "Delete"]) assert.equal(buttons().includes(label), false, label);
    const input = container.querySelector('input[type="search"]') ?? container.querySelector('input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "Alice");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    assert.match(container.querySelector("tbody").textContent, /Alice/); assert.doesNotMatch(container.querySelector("tbody").textContent, /Bob/);
    const select = container.querySelector("select"); assert.ok(select);
    await act(async () => { select.value = "Pending"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    assert.doesNotMatch(container.querySelector("tbody").textContent, /Alice/);
    await act(async () => root.render(createElement(AdminReadOnlyProvider, { value: false }, createElement(Table, props))));
    assert.ok(buttons().includes("Export CSV")); assert.ok(buttons().includes("New reservation"));
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("the permission matrix shows admin view-only access and reserves refund approval for managers", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ roles: [{ role: "staff", permissions: ["transactions", "refund_approval"] }, { role: "cashier", permissions: ["transactions"] }] });
  const Editor = loadTsModule("components/admin/users/RolePermissionsEditor.tsx").default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Editor)));
    const rows = [...container.querySelectorAll("tbody tr")];
    const row = label => rows.find(r => r.querySelector("th").textContent === label);
    assert.equal(row("View reservations").lastElementChild.textContent, "View only");
    assert.equal(row("Manage catalog").lastElementChild.textContent, "Full access");
    assert.equal(row("Approve or reject refunds (manager only)").lastElementChild.textContent, "Unavailable");
    const inputs = row("Approve or reject refunds (manager only)").querySelectorAll("input");
    assert.equal(inputs[0].checked, true); assert.equal(inputs[0].disabled, false);
    assert.equal(inputs[1].checked, false); assert.equal(inputs[1].disabled, true);
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = saved; }
});
