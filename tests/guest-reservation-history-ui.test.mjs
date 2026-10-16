import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/users" });
for (const key of ["window", "document", "HTMLElement", "Node"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client"); after(() => dom.window.close());
const guest = { id: "11111111-1111-4111-8111-111111111111", first_name: "Alex", last_name: "Guest", middle_name: null, email: "alex@example.com", phone_number: "09123456789", is_active: true, email_confirmed: true, created_at: "2026-01-01T00:00:00Z" };
const other = { ...guest, id: "22222222-2222-4222-8222-222222222222", first_name: "Sam", email: "sam@example.com", is_active: false };
const history = ["confirmed", "completed", "cancelled"].map((status, index) => ({ id: `33333333-3333-4333-8333-33333333333${index}`, reference: `MV-${status}`, status, bookingMode: "day", startDatetime: "2027-06-15T08:00:00+08:00", endDatetime: "2027-06-15T16:00:00+08:00", createdAt: "2027-05-01T00:00:00Z", adults: 20, children: 2, totalAmount: 3000, paidAmount: 600, balance: 2400, checkedInAt: null, checkedOutAt: null }));
const dialog = () => document.querySelector('[role="dialog"]');
const button = (container, label) => [...container.querySelectorAll("button")].find(button => button.textContent.trim() === label);
async function click(control) { assert.ok(control); assert.equal(control.disabled, false); await act(async () => control.click()); }
async function mount(fetchHistory) {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/reservations?")) return fetchHistory(url, options);
    return Response.json({ success: true, rows: [guest, other], total: 21 });
  };
  const Component = loadTsModule("components/admin/users/GuestAccountsPanel.tsx").default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component)));
  return { container, calls, open: email => click(button(container.querySelector(`[aria-label="Guest account ${email}"]`), "View bookings")),
    close: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = original; } };
}

test("View bookings opens the selected guest's complete history, pages it and opens the exact reservation", async () => {
  const h = await mount(async url => Response.json({ success: true, rows: new URL(url, "http://localhost").searchParams.get("page") === "1" ? [history[2]] : history, total: 21 }));
  try {
    await click(button(h.container, "Next"));
    await h.open(guest.email); assert.match(dialog().textContent, /Guest booking history/); assert.match(dialog().textContent, /Alex Guest/);
    for (const row of history) assert.ok(dialog().querySelector(`[aria-label="Reservation ${row.reference}"]`));
    const closed = dialog().querySelector('[aria-label="Reservation MV-cancelled"]'); assert.match(closed.textContent, /Closed booking/);
    const open = dialog().querySelector('[aria-label="Reservation MV-confirmed"] a');
    const url = new URL(open.href); assert.equal(url.pathname, "/admin/reservations"); assert.equal(url.searchParams.get("reservation"), history[0].id);
    assert.equal(url.searchParams.get("date"), "2027-06-15"); assert.equal(open.target, "_blank");
    await click(button(dialog(), "Next history page")); assert.match(h.calls.at(-1).url, /page=1/);
    assert.equal(dialog().querySelectorAll("article").length, 1); assert.match(dialog().textContent, /Page 2 of 2/);
    await click(button(dialog(), "Previous history page")); await click(button(dialog(), "Refresh history"));
    await click(dialog().querySelector('[aria-label="Close dialog"]'));
    assert.equal(dialog(), null); assert.match(h.container.textContent, /Page 2 of 3/);
    assert.ok(button(h.container.querySelector(`[aria-label="Guest account ${guest.email}"]`), "Deactivate"));
    await h.open(other.email); assert.match(h.calls.at(-1).url, new RegExp(other.id)); assert.match(dialog().textContent, /Sam Guest/);
  } finally { await h.close(); }
});

test("history errors can be retried, and an empty account shows no invented bookings or balances", async () => {
  let fail = true;
  const h = await mount(async () => fail ? Response.json({ success: false, message: "History unavailable" }, { status: 503 }) : Response.json({ success: true, rows: [], total: 0 }));
  try {
    await h.open(guest.email); assert.match(dialog().querySelector('[role="alert"]').textContent, /History unavailable/);
    fail = false; await click(button(dialog(), "Try again")); assert.match(dialog().textContent, /no booking or reservation records yet/);
    assert.equal(dialog().querySelectorAll("article").length, 0); assert.equal(button(dialog(), "Next history page").disabled, true);
  } finally { await h.close(); }
});

test("closing history aborts its request and a late response cannot replace another guest's records", async () => {
  let release;
  const h = await mount(async url => url.includes(guest.id) ? new Promise(resolve => { release = () => resolve(Response.json({ success: true, rows: history, total: 3 })); }) : Response.json({ success: true, rows: [], total: 0 }));
  try {
    await h.open(guest.email); const request = h.calls.at(-1); assert.match(dialog().textContent, /Loading reservation history/);
    await click(dialog().querySelector('[aria-label="Close dialog"]')); assert.equal(request.options.signal.aborted, true);
    await h.open(other.email); await act(async () => release());
    assert.match(dialog().textContent, /Sam Guest/); assert.match(dialog().textContent, /no booking or reservation records yet/);
    assert.equal(dialog().textContent.includes("MV-confirmed"), false);
  } finally { await h.close(); }
});
