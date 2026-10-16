import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/audit" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const button = (container, label) => [...container.querySelectorAll("button")].find(node => node.textContent.trim() === label);
const click = async node => { assert.ok(node); assert.equal(node.disabled, false); await act(async () => node.click()); };

test("shared dialogs retain field focus during updates, block dismissal while saving and restore trigger focus", async () => {
  const Dialog = loadTsModule("components/admin/catalog/CatalogDialog.tsx").default;
  const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); let closes = 0;
  const render = busy => act(async () => root.render(createElement(Dialog, {
    title: "Update staff", description: "Account details", busy, onClose: () => closes++,
  }, createElement("input", { "data-autofocus": true, "aria-label": "Name" }))));
  const escape = () => act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  try {
    await render(false);
    const input = container.querySelector("input");
    assert.equal(document.activeElement, input); assert.equal(document.body.style.overflow, "hidden");
    await render(false); assert.equal(document.activeElement, input);
    await render(true); await escape();
    await click(input); // Interior clicks never dismiss the dialog.
    await act(async () => container.querySelector('[role="dialog"]').click());
    assert.equal(closes, 0); assert.equal(container.querySelector('button[aria-label="Close dialog"]').disabled, true);
    await render(false); await escape(); assert.equal(closes, 1);
  } finally {
    await act(async () => root.unmount());
    assert.equal(document.activeElement, trigger); assert.equal(document.body.style.overflow, "");
    container.remove(); trigger.remove();
  }
});

test("audit exports the current filters, opens details in the shared dialog and refreshes actual records", async () => {
  const downloads = []; let reads = 0;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    reads++;
    return Response.json({ success: true, rows: [
      { id: "1", staff: "manager@example.com", module: "Reservations", action: "Updated reservation", record: "MV-1", timestamp: "2026-10-16T23:00:00Z", summary: "Guest count updated" },
      { id: "2", staff: "admin@example.com", module: "Payments", action: "Verified payment", record: `MV-${reads + 1}`, timestamp: "2026-10-17T00:00:00Z", summary: "Payment verified" },
    ] });
  };
  const Page = loadTsModule("app/admin/(portal)/audit/page.tsx", {
    "@/lib/reports/export": { downloadReportCsv: (columns, rows, filename) => downloads.push({ columns, rows, filename }) },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Page)));
    const search = container.querySelector('input[placeholder]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(search, "manager@example.com");
      search.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await click(button(container, "Export Log"));
    assert.equal(downloads[0].filename, "audit-log.csv"); assert.equal(downloads[0].rows.length, 1);
    assert.equal(downloads[0].rows[0].record, "MV-1");
    assert.match(downloads[0].rows[0].timestamp, /Oct 17, 2026/); // Philippine date, not the UTC day.
    await click(button(container, "View Details"));
    assert.match(container.querySelector('[role="dialog"]').textContent, /Guest count updated/);
    await act(async () => container.querySelector('[aria-label="Close dialog"]').click());
    assert.equal(container.querySelector('[role="dialog"]'), null);
    await click(button(container, "Clear table filters")); await click(button(container, "Refresh log"));
    assert.equal(reads, 2); assert.match(container.querySelector("tbody").textContent, /MV-3/);
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = savedFetch; }
});

test("a failed audit read disables export and the refresh action recovers", async () => {
  const savedFetch = globalThis.fetch; let failed = true;
  globalThis.fetch = async () => failed ? Response.json({ message: "Unable to read activity" }, { status: 500 }) : Response.json({ success: true, rows: [] });
  const Page = loadTsModule("app/admin/(portal)/audit/page.tsx").default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Page)));
    assert.match(container.querySelector('[role="alert"]').textContent, /Unable to read activity/);
    assert.equal(button(container, "Export Log").disabled, true);
    failed = false; await click(button(container, "Refresh log"));
    assert.equal(container.querySelector('[role="alert"]'), null);
    assert.match(container.textContent, /No records match/);
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = savedFetch; }
});

test("audit date selection fetches the applied period, keeps exports in scope, validates and clears the range", async () => {
  const savedFetch = globalThis.fetch, calls = [], downloads = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    return Response.json({ success: true, hasMore: calls.length === 1, rows: [{ id: "log", staff: "System", module: "Reservation", action: "Updated", record: String(url).includes("startDate") ? "MV-OLDER" : "MV-RECENT", timestamp: "2026-10-17T00:00:00Z" }] });
  };
  const Page = loadTsModule("app/admin/(portal)/audit/page.tsx", { "@/lib/reports/export": { downloadReportCsv: (_columns, rows) => downloads.push(rows) } }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const date = async (label, value) => act(async () => {
    const input = container.querySelector(`[aria-label="${label}"]`);
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  const apply = () => act(async () => container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
  try {
    await act(async () => root.render(createElement(Page)));
    assert.match(container.textContent, /Narrow the date range/);
    await date("Audit start date", "2026-10-01"); await date("Audit end date", "2026-10-05");
    assert.equal(calls.length, 1);
    await apply(); assert.equal(calls.at(-1), "/api/admin/audit?startDate=2026-10-01&endDate=2026-10-05");
    assert.match(container.querySelector("tbody").textContent, /MV-OLDER/);
    await click(button(container, "Export Log")); assert.equal(downloads[0][0].record, "MV-OLDER");
    await click(button(container, "Refresh log")); assert.match(calls.at(-1), /startDate=2026-10-01/);
    const reads = calls.length;
    await date("Audit start date", "2026-10-10"); await apply();
    assert.equal(calls.length, reads); assert.match(container.querySelector('[role="alert"]').textContent, /valid date range/);
    await click(button(container, "Clear dates")); assert.equal(calls.at(-1), "/api/admin/audit");
    assert.equal(container.querySelector('[role="alert"]'), null);
    assert.match(container.querySelector("tbody").textContent, /MV-RECENT/);
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = savedFetch; }
});
