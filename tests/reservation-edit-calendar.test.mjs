import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/reservations" });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const id = "11111111-1111-4111-8111-111111111111";
const fixture = () => ({
  reservation: { reservation_id: id, reference_number: "MV-EDIT", booking_type: "walk_in", status: "confirmed", booking_mode: "day",
    start_datetime: "2027-06-14T08:00:00+08:00", end_datetime: "2027-06-14T16:00:00+08:00", adult_count: 20, child_count: 0, special_requests: "", package_rate_version: 1 },
  guest: { first_name: "Test", last_name: "Guest", email: "test@example.com", phone_number: null }, bill: { total_amount: 8600, paid_amount: 600, status: "partial" },
  packageRates: legacyRates, version: "a".repeat(64), services: [], units: [{ unit_id: id, quantity: 1, price_per_night: 1 }],
  catalogServices: [], catalogUnits: [{ unit_id: id, name: "Resort", is_active: true, archived_at: null }], canEdit: true, canChangeDetails: true, lockedReason: null,
});
async function click(el) { assert.ok(el); assert.equal(el.disabled, false); await act(async () => el.click()); }
function field(c, label, tag = "select") { return [...c.querySelectorAll("label")].find(el => el.textContent.startsWith(label))?.querySelector(tag); }
async function value(el, next) {
  assert.ok(el);
  await act(async () => {
    const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, next);
    el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}
const day = (c,date) => c.querySelector('[data-date="' + date + '"]');
const saveButton = c => c.querySelector('button[type="submit"]');
async function submit(c) {
  await value(field(c, "Reason", "textarea"), "Guest requested a new date by phone");
  await act(async () => c.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
}
async function mount({ detail = fixture(), availability = () => ({ reservations: [], blockedDates: [] }) } = {}) {
  const originalFetch = globalThis.fetch, requests = [], saved = []; let savedCount = 0;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.startsWith("/api/booking/availability")) {
      assert.equal(new URL(url,"http://localhost").searchParams.get("excludeReservationId"), id);
      const result = await availability(url);
      return result instanceof Response ? result : Response.json(result);
    }
    if (options.method === "PATCH") { saved.push(JSON.parse(options.body)); return Response.json({ success: true, message: "Saved" }); }
    return Response.json(detail);
  };
  const Component = loadTsModule("components/admin/ReservationEditor.tsx").default;
  const c = document.createElement("div"); document.body.append(c); const root = createRoot(c);
  await act(async () => root.render(createElement(Component, { reservationId: id, onSaved: () => savedCount++ })));
  return { c, requests, saved, savedCount: () => savedCount, async close() {
    await act(async () => root.unmount()); c.remove(); globalThis.fetch = originalFetch;
  } };
}

test("the editor keeps the booked package and disables dates even when another package is free", async () => {
  const h = await mount({ availability: () => ({ reservations: [
    { start_datetime: "2027-06-15T08:00:00+08:00", end_datetime: "2027-06-15T16:00:00+08:00" },
    { start_datetime: "2027-06-16T08:00:00+08:00", end_datetime: "2027-06-17T06:00:00+08:00" },
  ], blockedDates: [{ start_date: "2027-06-18", end_date: "2027-06-18" }] }) });
  try {
    const { c } = h;
    assert.equal(c.querySelector('input[type="date"],input[type="datetime-local"]'), null);
    assert.equal(day(c,"2027-06-14").disabled,false); assert.equal(day(c,"2027-06-14").getAttribute("aria-pressed"),"true");
    assert.equal(day(c,"2027-06-16").disabled,true); assert.equal(day(c,"2027-06-18").disabled,true);
    assert.equal(day(c,"2027-06-15").disabled,true,"a free night slot must not change a booked day package");
    assert.equal(field(c,"Booking package"),undefined);
    assert.equal(field(c,"Booked package","input").readOnly,true);
    assert.equal(field(c,"Booked package","input").value,"Day swimming");
    await click(day(c,"2027-06-17"));
    await submit(c); assert.equal(h.saved.length,1); assert.equal(h.saved[0].bookingMode,"day");
    assert.equal(h.saved[0].startDatetime,"2027-06-17T00:00:00.000Z");
    assert.equal(h.saved[0].endDatetime,"2027-06-17T08:00:00.000Z"); assert.equal(h.saved[0].expectedTotal,8650); assert.equal(h.savedCount(),1);
  } finally { await h.close(); }
});

test("whole-day B and its original fixed times stay locked when changing dates",async()=>{
  const detail=fixture();Object.assign(detail.reservation,{booking_mode:"whole_day",start_datetime:"2027-06-14T18:00:00+08:00",end_datetime:"2027-06-15T16:00:00+08:00"});
  const h=await mount({detail});
  try {
    const {c}=h;assert.match(field(c,"Booked package","input").value,/Variant B/);
    assert.equal(field(c,"Whole-day variant"),undefined);
    await click(day(c,"2027-06-20"));await submit(c);
    assert.equal(h.saved[0].bookingMode,"whole_day");
    assert.equal(h.saved[0].startDatetime,"2027-06-20T10:00:00.000Z");assert.equal(h.saved[0].endDatetime,"2027-06-21T08:00:00.000Z");
  }finally{await h.close();}
});

test("custom bookings keep their original time and duration and check availability for that window",async()=>{
  const detail=fixture();Object.assign(detail.reservation,{booking_mode:"custom",start_datetime:"2027-06-14T09:00:00+08:00",end_datetime:"2027-06-14T14:00:00+08:00"});
  const h=await mount({detail,availability:()=>({reservations:[{start_datetime:"2027-06-21T10:00:00+08:00",end_datetime:"2027-06-21T11:00:00+08:00"}],blockedDates:[]})});
  try{
    const {c}=h;assert.equal(c.querySelectorAll("section").length,1);assert.equal(c.querySelectorAll('input[type="time"]').length,0);
    assert.equal(day(c,"2027-06-21").disabled,true);
    await click(day(c,"2027-06-20"));await submit(c);
    assert.equal(h.saved[0].bookingMode,"custom");
    assert.equal(h.saved[0].startDatetime,"2027-06-20T01:00:00.000Z");assert.equal(h.saved[0].endDatetime,"2027-06-20T06:00:00.000Z");
  }finally{await h.close();}
});

test("availability refresh blocks a newly occupied selection; failures do not stop unchanged service or note edits",async()=>{
  let fail=false,booked=false;
  const h=await mount({availability:()=>fail?Response.json({message:"Unavailable"},{status:503}):({reservations:booked?[{start_datetime:"2027-06-20T08:00:00+08:00",end_datetime:"2027-06-20T16:00:00+08:00"}]:[],blockedDates:[]})});
  try{
    const {c}=h;await click(day(c,"2027-06-20"));assert.equal(saveButton(c).disabled,false);
    booked=true;await act(async()=>window.dispatchEvent(new window.Event("focus")));
    assert.equal(saveButton(c).disabled,true);await submit(c);assert.equal(h.saved.length,0);
    await click(day(c,"2027-06-14"));fail=true;await act(async()=>window.dispatchEvent(new window.Event("focus")));
    assert.match(c.textContent,/Unable to load available dates/);assert.equal(saveButton(c).disabled,false);
    await submit(c);assert.equal(h.saved.length,1);
  }finally{await h.close();}
});

test("in-stay reservations keep schedule calendars disabled while notes and additional services remain editable",async()=>{
  const detail=fixture();detail.canChangeDetails=false;
  const h=await mount({detail});
  try{
    const {c}=h;assert.equal(day(c,"2027-06-14").disabled,true);
    assert.equal(h.requests.some(request=>request.url.startsWith("/api/booking/availability")),false);
    await submit(c);assert.equal(h.saved.length,1);
  }finally{await h.close();}
});

test("late staff edits show a notice alert and fee; authorized exceptions must be acknowledged", async () => {
  const originalNow = Date.now; Date.now = () => Date.parse("2027-06-13T10:00:00+08:00");
  const detail = { ...fixture(), canApproveLateReschedule: true, canRescheduleException: true };
  let h;
  try {
    h = await mount({ detail });
    assert.match(h.c.textContent, /deadline was 2027-06-07/);
    assert.equal(day(h.c, "2027-06-20").disabled, true);
    await click(h.c.querySelector('input[type="checkbox"]'));
    assert.equal(day(h.c, "2027-06-20").disabled, false);
    await click(day(h.c, "2027-06-20"));
    assert.match(h.c.textContent, /Reschedule notice fee/);
    await submit(h.c); assert.equal(h.saved[0].lateRescheduleAcknowledged, true); assert.equal(h.saved[0].expectedTotal, 9400); // PHP 300 notice + PHP 500 weekend difference.
  } finally { await h?.close(); Date.now = originalNow; }
});

test("staff without approval cannot unlock late dates; ended confirmed stays can move with an authorized exception", async () => {
  const originalNow = Date.now; Date.now = () => Date.parse("2027-06-15T10:00:00+08:00");
  let h;
  try {
    const detail = { ...fixture(), canChangeDetails: false, lockedReason: "This stay has ended.", canApproveLateReschedule: true, canRescheduleException: true };
    h = await mount({ detail });
    assert.equal(day(h.c, "2027-06-20").disabled, true);
    await click(h.c.querySelector('input[type="checkbox"]')); await click(day(h.c, "2027-06-20"));
    assert.equal(field(h.c, "Adults", "input").disabled, true);
    await submit(h.c); assert.equal(h.saved[0].expectedTotal, 9600); // PHP 500 past-date notice + PHP 500 weekend difference.
    await h.close(); h = await mount({ detail: { ...detail, canApproveLateReschedule: false, canRescheduleException: false } });
    assert.equal(h.c.querySelector('input[type="checkbox"]'), null); assert.equal(day(h.c, "2027-06-20").disabled, true);
  } finally { await h?.close(); Date.now = originalNow; }
});
