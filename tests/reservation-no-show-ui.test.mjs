import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/reservations" });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client"); after(() => dom.window.close());
const Component = loadTsModule("components/admin/ReservationNoShow.tsx").default;
const { noShowBlockedReason } = loadTsModule("lib/booking/reservation-no-show.ts");
const now = Date.parse("2026-11-12T00:30:00+08:00");
const reservation = { reservation_id: "reservation", status: "confirmed", start_datetime: "2026-11-11T18:00:00+08:00", end_datetime: "2026-11-12T00:00:00+08:00", checked_in_at: null, checked_out_at: null };
const click = async control => { assert.ok(control); assert.equal(control.disabled, false); await act(async () => control.click()); };
const button = container => container.querySelector("button");
async function change(field, value) {
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(field, value); field.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
}
async function mount(props = {}, handler = async () => Response.json({ success: true, message: "Marked No show", reservation: { ...reservation, status: "no_show" } })) {
  const original = globalThis.fetch, calls = [], saved = [], busy = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return handler(); };
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component, { reservation, canManage: true, now, onRecorded: (...args) => saved.push(args), onBusyChange: value => busy.push(value), ...props })));
  return { container, calls, saved, busy, close: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = original; } };
}

test("no-show eligibility uses the full Philippine departure timestamp including overnight stays and the exact cutoff", () => {
  assert.ok(noShowBlockedReason(reservation, Date.parse("2026-11-11T23:59:59+08:00")));
  assert.ok(noShowBlockedReason(reservation, Date.parse(reservation.end_datetime)));
  assert.equal(noShowBlockedReason(reservation, Date.parse(reservation.end_datetime) + 1), null);
  for (const status of ["pending", "completed", "cancelled", "no_show"]) assert.ok(noShowBlockedReason({ ...reservation, status }, now));
  assert.ok(noShowBlockedReason({ ...reservation, checked_in_at: reservation.start_datetime }, now));
});

test("only eligible manager controls allow submission, after a reason and explicit non-arrival acknowledgement", async () => {
  for (const props of [{ canManage: false }, { reservation: { ...reservation, checked_in_at: reservation.start_datetime } }]) {
    const h = await mount(props); try { assert.equal(button(h.container), null); } finally { await h.close(); }
  }
  const future = await mount({ now: Date.parse(reservation.end_datetime) });
  try { assert.equal(button(future.container).disabled, true); assert.match(future.container.textContent, /only after the scheduled end time/); assert.equal(future.container.querySelector("textarea"), null); } finally { await future.close(); }
  const h = await mount();
  try {
    assert.equal(button(h.container).disabled, true);
    await change(h.container.querySelector("textarea"), "  Guest did not arrive  "); assert.equal(button(h.container).disabled, true);
    await click(h.container.querySelector('input[type="checkbox"]')); await click(button(h.container));
    assert.deepEqual(h.calls, [{ url: "/api/admin/reservations/no-show", body: { reservationId: "reservation", reason: "Guest did not arrive", noShowConfirmed: true } }]);
    assert.equal(h.saved[0][0].status, "no_show"); assert.deepEqual(h.busy, [true, false]);
  } finally { await h.close(); }
});

test("conflicts retain the manager's reason and duplicate clicks cannot submit twice", async () => {
  let finish;
  const h = await mount({}, () => new Promise(resolve => { finish = () => resolve(Response.json({ message: "Guest has already checked in" }, { status: 409 })); }));
  try {
    await change(h.container.querySelector("textarea"), "Guest did not arrive"); await click(h.container.querySelector('input[type="checkbox"]'));
    await act(async () => { button(h.container).click(); button(h.container).click(); }); assert.equal(h.calls.length, 1);
    assert.equal(button(h.container).disabled, true); await act(async () => finish());
    assert.match(h.container.querySelector('[role="alert"]').textContent, /already checked in/);
    assert.equal(h.container.querySelector("textarea").value, "Guest did not arrive"); assert.equal(h.saved.length, 0);
  } finally { await h.close(); }
});

test("recorded no-shows show history without editable controls to all authorized record viewers", async () => {
  const h = await mount({ canManage: false, reservation: { ...reservation, status: "no_show", no_show_at: "2026-11-11T16:30:00Z", no_show_reason: "Guest did not arrive" } });
  try { assert.match(h.container.textContent, /Guest did not arrive/); assert.match(h.container.textContent, /Nov 12.*12:30 AM/); assert.equal(h.container.querySelector("textarea,input,button"), null); } finally { await h.close(); }
});
