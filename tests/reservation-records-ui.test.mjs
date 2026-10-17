import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/records" });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const id = "11111111-1111-4111-8111-111111111111", walkId = "22222222-2222-4222-8222-222222222222";
async function mount({ failProfiles = false, detailFails = false } = {}) {
  const originalFetch = globalThis.fetch, reads = [], requests = []; let failDetail = detailFails;
  const r = { reservation_id: id, reference_number: "MV-WALKIN", guest_id: null, walk_in_guest_id: walkId,
    start_datetime: "2027-06-14T08:00:00+08:00", end_datetime: "2027-06-14T16:00:00+08:00", adult_count: 20, child_count: 2,
    status: "completed", created_at: "2027-06-01T08:00:00+08:00", booking_type: "walk_in", booking_mode: "day",
    checked_in_at: "2027-06-14T08:10:00+08:00", checked_out_at: "2027-06-14T16:00:00+08:00", special_requests: "Guest requested a mattress." };
  const guest = { first_name: "Maria", last_name: "Walkin", email: "maria@example.com", phone_number: "09123456789", address: "Taytay" };
  const data = {
    reservations: [r, { ...r, reservation_id: "33333333-3333-4333-8333-333333333333", reference_number: "MV-ONLINE", guest_id: walkId, walk_in_guest_id: null, status: "confirmed" },
      { ...r, reservation_id: "44444444-4444-4444-8444-444444444444", reference_number: "MV-MISSING", walk_in_guest_id: "missing", status: "cancelled" }],
    guests: [{ id: walkId, first_name: "Juan", last_name: "Online" }], walk_in_guests: [{ walk_in_guest_id: walkId, ...guest }],
    reservation_reschedules: [{ reschedule_id: "reschedule", reservation_id: id, requested_by: null, old_start: r.start_datetime, old_end: r.end_datetime, new_start: r.start_datetime, new_end: r.end_datetime, reschedule_fee: 50, rate_adjustment: 0, status: "approved", created_at: r.created_at }],
    ocular_visits: [], ocular_time_slots: [], staff_users: [{ id: "staff", role: "staff" }], role_permissions: [{ role: "staff", permissions: ["records"] }],
  };
  const client = { auth: { getUser: async () => ({ data: { user: { id: "staff" } } }) }, from(table) {
    const predicates = []; let fields = null, range = null;
    reads.push({ table });
    const result = () => {
      let rows = (data[table] ?? []).filter(row => predicates.every(predicate => predicate(row)));
      if (range) rows = rows.slice(range[0], range[1] + 1);
      if (fields) rows = rows.map(row => Object.fromEntries(fields.split(",").map(field => [field.trim(), row[field.trim()]])));
      return { data: rows, error: failProfiles && table === "walk_in_guests" ? { message: "Read failed" } : null };
    };
    const q = { select: selected => { fields = selected; return q; }, order: () => q,
      range: (from, to) => { range = [from, to]; return q; }, in: (key, values) => { predicates.push(row => values.includes(row[key])); return q; },
      eq: (key, value) => { predicates.push(row => row[key] === value); return q; },
      maybeSingle: async () => { const response = result(); return { ...response, data: response.data[0] ?? null }; },
      then: (yes, no) => Promise.resolve(result()).then(yes, no) };
    return q;
  } };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, method: options?.method ?? "GET" });
    if (failDetail) return Response.json({ message: "Unable to load this reservation record. Please retry." }, { status: 503 });
    return Response.json({ detail: { reservation: r, guest,
      units: [{ name: "Cottage A", quantity: 1, price: 8000 }], services: [{ name: "Mattress rental", quantity: 2, price: 300 }],
      bill: { total: 8900, paid: 8900, balance: 0, status: "paid" } } });
  };
  const Component = loadTsModule("app/admin/(portal)/records/page.tsx", {
    "@/lib/supabase/client": { createClient: () => client },
    "@/lib/admin/use-module-tab": { useModuleTab: () => useState("Reservation Records") },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component)));
  return { container, reads, requests, allowDetail: () => { failDetail = false; }, async close() {
    await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch;
  } };
}
const row = (container, ref) => [...container.querySelectorAll("tbody tr")].find(row => row.textContent.includes(ref));
const click = async element => { assert.ok(element); assert.equal(element.disabled, false); await act(async () => element.click()); };

test("records resolves separate walk-in and account names, including the walk-in owner of a reschedule", async () => {
  const h = await mount();
  try {
    assert.match(row(h.container, "MV-WALKIN").textContent, /Maria Walkin/);
    assert.match(row(h.container, "MV-ONLINE").textContent, /Juan Online/);
    assert.match(row(h.container, "MV-MISSING").textContent, /Guest profile unavailable/);
    for (const ref of ["MV-WALKIN", "MV-ONLINE", "MV-MISSING"]) assert.equal(row(h.container, ref).querySelector("button").disabled, false);
    await click([...h.container.querySelectorAll('[aria-label="Record sections"] button')].find(tab => tab.textContent === "Reschedule Requests"));
    assert.match(h.container.textContent, /Maria Walkin/);
  } finally { await h.close(); }
});

test("completed reservation View opens a read-only walk-in dialog using Records access", async () => {
  const h = await mount();
  try {
    await click(row(h.container, "MV-WALKIN").querySelector("button"));
    const dialog = document.querySelector('[role="dialog"]'); assert.ok(dialog);
    for (const text of ["Maria Walkin", "maria@example.com", "Staff entry / Walk-in", "Completed", "Cottage A", "Mattress rental", "8,900", "Guest requested a mattress."]) assert.ok(dialog.textContent.includes(text), text);
    assert.equal(dialog.querySelector('input,textarea,select'), null);
    assert.doesNotMatch(dialog.textContent, /Save reservation|Mark guest checked in|Approve|Reject/);
    assert.deepEqual(h.requests, [{ url: `/api/admin/records/reservations/${id}`, method: "GET" }]);
    await click(dialog.querySelector('[aria-label="Close booking dialog"]'));
    assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally { await h.close(); }
});

test("profile and detail failures show errors, and details can be retried", async () => {
  const failed = await mount({ failProfiles: true });
  try { assert.match(failed.container.textContent, /Failed to load records/); }
  finally { await failed.close(); }
  const h = await mount({ detailFails: true });
  try {
    await click(row(h.container, "MV-WALKIN").querySelector("button"));
    const dialog = document.querySelector('[role="dialog"]');
    assert.match(dialog.textContent, /Unable to load this reservation record/);
    h.allowDetail(); await click([...dialog.querySelectorAll("button")].find(button => button.textContent === "Retry details"));
    assert.match(dialog.textContent, /Maria Walkin/);
  } finally { await h.close(); }
});
