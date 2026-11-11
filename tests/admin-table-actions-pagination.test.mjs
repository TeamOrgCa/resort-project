import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { dashboardDatabase } from "./helpers/dashboard-database.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin" });
for (const key of ["window", "document", "HTMLElement", "Node"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const button = (c, label) => [...c.querySelectorAll("button")].find(b => b.textContent.trim() === label);
const click = async el => { assert.ok(el); assert.equal(el.disabled, false); await act(async () => el.click()); };

test("record tables paginate by default, preserve all matching export rows, and use keyboard-accessible menus", async () => {
  const Table = loadTsModule("components/admin/AdminTablePreview.tsx").default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const rows = Array.from({ length: 61 }, (_, i) => ({ id: String(i), name: `Guest ${String(i).padStart(2, "0")}` }));
  const selected = [], exported = [];
  const props = { title: "Staff records", columns: [{ key: "name", label: "Name" }], rows, actions: ["Export CSV"],
    rowActions: ["View", "Edit", "Disable"], isRowActionDisabled: action => action === "Edit",
    onRowAction: (action, row) => selected.push([action, row.id]), onAction: (_action, matches) => exported.push(matches.length) };
  try {
    await act(async () => root.render(createElement(Table, props)));
    assert.equal(container.querySelectorAll("tbody tr").length, 25);
    assert.match(container.textContent, /Page 1 of 3/);
    await click(button(container, "Export CSV")); assert.deepEqual(exported, [61]);
    await click(button(container, "Last")); assert.equal(container.querySelectorAll("tbody tr").length, 11);
    assert.match(container.textContent, /Showing 51–61 of 61/);
    const trigger = container.querySelector('button[aria-haspopup="menu"]'); await click(trigger);
    const menu = document.querySelector('[role="menu"]'); assert.ok(menu); assert.equal(container.contains(menu), false);
    assert.equal(trigger.getAttribute("aria-expanded"), "true"); assert.equal(button(menu, "Edit").disabled, true);
    assert.equal(document.activeElement, button(menu, "View"));
    await act(async () => menu.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    assert.equal(document.activeElement, button(menu, "Disable"));
    await act(async () => menu.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(document.querySelector('[role="menu"]'), null); assert.equal(document.activeElement, trigger);
    await click(trigger); await click(button(document.body, "Disable")); assert.deepEqual(selected, [["Disable", "50"]]);
    assert.equal(document.querySelector('[role="menu"]'), null);
    const input = container.querySelector("input");
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "Guest 60"); input.dispatchEvent(new window.Event("input", { bubbles: true })); });
    assert.match(container.textContent, /Page 1 of 1/); assert.equal(container.querySelectorAll("tbody tr").length, 1);
    assert.equal(button(container, "Next").disabled, true); await click(button(container, "Export CSV")); assert.deepEqual(exported, [61, 1]);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("row clicks and keyboard open details while large checkbox labels and portaled menus remain independent", async () => {
  const Table = loadTsModule("components/admin/AdminTablePreview.tsx").default;
  const c = document.createElement("div"); document.body.append(c); const root = createRoot(c);
  const opened = [], selected = [];
  try {
    await act(async () => root.render(createElement(Table, { title: "Records", columns: [{ key: "name", label: "Name" }],
      rows: [{ id: "1", name: "Maria" }], selectableRows: true, rowActions: ["View", "Edit"],
      onRowAction: (action, row) => opened.push([action, row.id]), onSelectedRowIdsChange: ids => selected.push(ids) })));
    const row = c.querySelector("tbody tr");
    await act(async () => row.querySelector('[data-label="Name"]').click()); assert.deepEqual(opened, [["View", "1"]]);
    await act(async () => row.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    assert.equal(opened.length, 2);
    await act(async () => row.querySelector("label").click()); assert.deepEqual(selected, [["1"]]); assert.equal(opened.length, 2);
    await click(row.querySelector('[aria-haspopup="menu"]')); assert.equal(opened.length, 2);
    await click(button(document.querySelector('[role="menu"]'), "Edit"));
    assert.deepEqual(opened, [["View", "1"], ["View", "1"], ["Edit", "1"]]);
  } finally { await act(async () => root.unmount()); c.remove(); }
});

test("staff accounts load beyond PostgREST's first page so pagination and search include older users", async () => {
  const { client, calls } = dashboardDatabase({ staff_users: Array.from({ length: 1003 }, (_, i) => ({ id: `staff-${i}`, full_name: `Staff ${i}`, created_at: "2026-01-01" })) });
  const { GET } = loadTsModule("app/api/admin/users/route.ts", {
    "@/lib/server/admin-audit": { requireAdminStaff: async () => ({ staffUser: { id: "admin", role: "admin" } }) },
    "@/lib/supabase/admin": { tryCreateAdminClient: () => client },
  });
  const response = await GET(); assert.equal(response.status, 200); assert.equal((await response.json()).rows.length, 1003);
  assert.ok(calls.some(c => c.from === 1000));
});

test("refund requests and their payment records have separate pagination and reset when filters change", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ refunds: Array.from({ length: 27 }, (_, i) => ({ refund_id: `refund-${i}`, reservation_id: "booking", amount: 100, status: i === 26 ? "reviewed" : "pending", request_kind: "cancellation", workflow_version: 2, requested_at: "2026-01-01" })),
    payments: Array.from({ length: 12 }, (_, i) => ({ payment_id: `p-${i}`, reservation_id: "booking", amount: 100, status: "verified", reference_number: `PAYMENT-${i}` })), permissions: { canReview: false, canApprove: false, canPay: false, canVerify: false } });
  const Panel = loadTsModule("components/admin/transactions/RefundRequestsPanel.tsx", { "@/lib/supabase/client": { createClient: () => ({}) } }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Panel)));
    const pager = container.querySelector('[aria-label="Refund requests pagination"]');
    assert.equal(container.querySelectorAll("tbody tr").length, 25); await click(button(pager, "Next")); assert.equal(container.querySelectorAll("tbody tr").length, 2);
    const filter = container.querySelector("select");
    await act(async () => { filter.value = "pending"; filter.dispatchEvent(new window.Event("change", { bubbles: true })); });
    assert.match(pager.textContent, /Page 1 of 2/); await click(button(container, "View"));
    const dialog = document.querySelector('[role="dialog"]'); assert.equal(dialog.querySelectorAll("tbody tr").length, 10);
    await click(button(dialog.querySelector('[aria-label="Refund payment records pagination"]'), "Next"));
    assert.equal(dialog.querySelectorAll("tbody tr").length, 2); assert.match(dialog.textContent, /PAYMENT-11/);
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = saved; }
});

test("catalog rows group Edit and Archive under a three-dot menu and preserve confirmation dialogs", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async url => Response.json(String(url).includes("resource=references")
    ? { success: true, references: { units: [], paymentMethods: [] } }
    : { success: true, records: [{ service_id: "service", name: "Pool extras", price: 100, is_active: true }], total: 1, counts: { active: 1, archived: 0 } });
  const Catalog = loadTsModule("components/admin/catalog/CatalogClient.tsx", { "next/image": () => null }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Catalog)));
    assert.equal(button(container, "Edit"), undefined);
    const actionCell = container.querySelector('[aria-label="Options for Pool extras"]').closest("td");
    assert.ok(actionCell.classList.contains("align-middle"));
    assert.ok(actionCell.firstElementChild.classList.contains("justify-end"));
    await click(container.querySelector('[aria-label="Options for Pool extras"]'));
    assert.ok(button(document.body, "Edit")); await click(button(document.body, "Archive"));
    assert.equal(document.querySelector('[role="menu"]'), null);
    const dialog = document.querySelector('[role="dialog"]'); assert.ok(dialog);
    assert.match(dialog.textContent, /Archive service/); assert.ok(button(dialog, "Archive item"));
    await click(button(dialog, "Cancel"));
    assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = saved; }
});
