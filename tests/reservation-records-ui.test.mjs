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
async function mount({ failProfiles = false, detailFails = false, reviewable = false } = {}) {
  const originalFetch = globalThis.fetch, reads = [], requests = []; let failDetail = detailFails;
  const state = { reviewError: false, deferReview: null };
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
  if (reviewable) {
    data.reservation_reschedules[0].status = "pending";
    data.ocular_visits.push({ visit_id: "visit", reference_number: "MV-VISIT", guest_id: walkId, scheduled_date: "2027-06-14", time_slot_id: "slot", status: "pending", created_at: r.created_at });
    data.ocular_time_slots.push({ slot_id: "slot", start_time: "09:00", end_time: "10:00" });
    data.role_permissions[0].permissions.push("reschedule_approval", "ocular_approval");
  }
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
    if (options?.method === "POST") {
      requests.push({ url, method: "POST", body: JSON.parse(options.body) });
      const finish = () => {
        if (state.reviewError) return Response.json({ success: false, message: "Review could not be saved. Please retry." }, { status: 503 });
        const ocular = url.includes("ocular-visits"), approval = url.endsWith("/approve");
        (ocular ? data.ocular_visits[0] : data.reservation_reschedules[0]).status = approval ? (ocular ? "confirmed" : "approved") : "rejected";
        return Response.json({ success: true, message: "Review saved." });
      };
      return state.deferReview ? state.deferReview(finish) : finish();
    }
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
  return { container, reads, requests, state, allowDetail: () => { failDetail = false; }, async close() {
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

const button = (container, text) => [...container.querySelectorAll("button")].find(button => button.textContent.trim() === text);
async function typeReason(dialog, value) {
  const input = dialog.querySelector("textarea");
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

test("record approval and rejection use custom dialogs with reasons and explicit confirmation", async () => {
  const originalPrompt = window.prompt, originalConfirm = window.confirm;
  window.prompt = window.confirm = () => { assert.fail("Native dialogs must not be used"); };
  try {
    for (const ocular of [false, true]) for (const action of ["Approve", "Reject"]) {
      const h = await mount({ reviewable: true });
      try {
        await click(button(h.container.querySelector('[aria-label="Record sections"]'), ocular ? "Ocular Visit Records" : "Reschedule Requests"));
        await click(button(row(h.container, ocular ? "MV-VISIT" : "MV-WALKIN"), action));
        const dialog = document.querySelector('[role="dialog"]'); assert.ok(dialog);
        assert.match(dialog.textContent, new RegExp(`${action} ${ocular ? "ocular visit" : "reschedule request"}`));
        assert.match(dialog.textContent, ocular ? /09:00/ : /Additional charge/);
        const confirm = button(dialog, action === "Approve" ? "Confirm approval" : "Confirm rejection");
        if (ocular || action === "Reject") {
          assert.equal(confirm.disabled, true);
          await typeReason(dialog, "   "); assert.equal(confirm.disabled, true);
          if (ocular) { await typeReason(dialog, "abcd"); assert.equal(confirm.disabled, true); }
          await typeReason(dialog, "  Schedule reviewed with guest.  ");
        } else assert.equal(dialog.querySelector("textarea"), null);
        assert.equal(h.requests.length, 0);
        await click(confirm);
        assert.equal(document.querySelector('[role="dialog"]'), null);
        assert.deepEqual(h.requests, [{ url: `/api/admin/${ocular ? "ocular-visits" : "reschedule-requests"}/${action.toLowerCase()}`, method: "POST",
          body: ocular ? { visitId: "visit", reviewReason: "Schedule reviewed with guest." }
            : { rescheduleId: "reschedule", ...(action === "Reject" ? { rejectionReason: "Schedule reviewed with guest." } : {}) } }]);
        assert.match(h.container.textContent, /Review saved/);
      } finally { await h.close(); }
    }
  } finally { window.prompt = originalPrompt; window.confirm = originalConfirm; }
});

test("review dialogs cancel without saving and retain reasons on failure; pending saves block duplicate submissions and dismissal", async () => {
  const h = await mount({ reviewable: true }); let release;
  try {
    await click(button(h.container.querySelector('[aria-label="Record sections"]'), "Ocular Visit Records"));
    const open = () => click(button(row(h.container, "MV-VISIT"), "Reject"));
    await open(); await typeReason(document.querySelector('[role="dialog"]'), "Old reason");
    await click(button(document.querySelector('[role="dialog"]'), "Cancel"));
    assert.equal(document.querySelector('[role="dialog"]'), null); assert.equal(h.requests.length, 0);
    await open();
    const dialog = document.querySelector('[role="dialog"]');
    assert.equal(dialog.querySelector("textarea").value, "");
    await typeReason(dialog, "Schedule is unavailable.");
    h.state.reviewError = true;
    await click(button(dialog, "Confirm rejection"));
    assert.match(dialog.querySelector('[role="alert"]').textContent, /Review could not be saved/);
    assert.equal(dialog.querySelector("textarea").value, "Schedule is unavailable.");
    h.state.reviewError = false;
    h.state.deferReview = finish => new Promise(resolve => { release = () => resolve(finish()); });
    await click(button(dialog, "Confirm rejection"));
    assert.equal(button(dialog, "Saving...").disabled, true);
    assert.equal(dialog.querySelector("fieldset").disabled, true);
    await act(async () => {
      dialog.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    assert.equal(h.requests.length, 2); assert.equal(document.querySelector('[role="dialog"]'), dialog);
    await act(async () => release()); assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally { await h.close(); }
});
