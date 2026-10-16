import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/reservations" });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

async function click(element) { assert.ok(element); assert.equal(element.disabled, false); await act(async () => element.click()); }
async function select(container, label, next) {
  const element = [...container.querySelectorAll("label")].find(item => item.textContent.startsWith(label))?.querySelector("select");
  assert.ok(element, label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(element, next);
    element.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}
async function mount(fetcher = () => Response.json({ success: true, reservation: { referenceNumber: "MB-CALENDAR" } }), { availabilityFetcher = () => Response.json({ reservations: [], blockedDates: [] }) } = {}) {
  const originalFetch = globalThis.fetch, requests = []; let created = 0;
  globalThis.fetch = async (url, options) => {
    if (url.startsWith("/api/booking/availability")) return availabilityFetcher(url, options);
    requests.push({ url, body: JSON.parse(options.body) }); return fetcher();
  };
  const client = { from(table) {
    assert.notEqual(table, "guests", "Manual entry must not load account choices");
    const data = table === "guests" ? [{ id: "guest", first_name: "Test", last_name: "Guest", email: "test@example.com" }]
      : table === "services" ? [{ service_id: "karaoke", name: "Karaoke", price: 500, description: "Use during the stay" }, { service_id: "chairs", name: "Extra chair", price: 100, description: null }]
      : [{ unit_id: "unit", name: "Resort", capacity: 30 }];
    const q = { select: () => q, order: () => q, limit: () => q, eq: () => q, is: () => q,
      then: (resolve, reject) => Promise.resolve({ data }).then(resolve, reject) };
    return q;
  } };
  const Component = loadTsModule("components/admin/ManualBookingDialog.tsx", {
    "@/lib/supabase/client": { createClient: () => client },
    "@/lib/booking/use-package-rates": { usePackageRates: () => ({ schedule: { version: 9, rates: legacyRates }, error: null }) },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component, { isOpen: true, onClose: () => {}, onCreated: () => created++ })));
  return { container, requests, created: () => created, async close() {
    await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch;
  } };
}
const dateForWeekday = (month, weekday) => {
  const day = Array.from({ length: 7 }, (_, i) => i + 1).find(day => new Date(month + "-" + String(day).padStart(2, "0") + "T12:00:00Z").getUTCDay() === weekday);
  return month + "-" + String(day).padStart(2, "0");
};

test("manual reservations use a custom calendar, update weekday/weekend pricing and submit fixed Philippine package times", async () => {
  const h = await mount();
  try {
    const c = h.container;
    assert.equal(c.textContent.includes("Existing account"), false);
    assert.equal(c.querySelector('input[type="date"]'), null);
    await click(c.querySelector('[aria-label="Next month"]'));
    const first = c.querySelector("[data-date]").dataset.date, month = first.slice(0, 7);
    const monday = dateForWeekday(month, 1), friday = dateForWeekday(month, 5);
    await click(c.querySelector('[data-date="' + monday + '"]')); assert.match(c.textContent, /Weekday package/);
    await click(c.querySelector('[data-date="' + friday + '"]')); assert.match(c.textContent, /Weekend package/);
    assert.equal(c.querySelector('[data-date="' + friday + '"]').getAttribute("aria-pressed"), "true");
    await click(c.querySelector('[aria-label="Next month"]')); assert.notEqual(c.querySelector("[data-date]").dataset.date.slice(0, 7), month);
    await click(c.querySelector('[aria-label="Previous month"]'));
    assert.equal(c.querySelector('[data-date="' + friday + '"]').getAttribute("aria-pressed"), "true");
    assert.equal(h.requests.length, 0, "calendar controls must not submit the form");
    await fillGuest(c); await select(c, "Booking package", "whole_day"); await select(c, "Whole-day variant", "night_to_day");
    await act(async () => c.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(h.requests.length, 1); const request = h.requests[0];
    assert.equal(request.url, "/api/admin/reservations/create"); assert.equal(request.body.packageRateVersion, 9);
    assert.equal(request.body.startDatetime, friday + "T10:00:00.000Z"); assert.equal(request.body.wholeDayVariant, "night_to_day");
    assert.equal((Date.parse(request.body.endDatetime) - Date.parse(request.body.startDatetime)) / 3600000, 22);
    assert.equal(request.body.guestId, undefined); assert.equal(request.body.guestType, "walk_in"); assert.equal(request.body.walkInGuest.email, "walkin@example.com"); assert.equal(h.created(), 1);
  } finally { await h.close(); }
});

test("calendar controls stay disabled while creating and a failed save preserves the selected date for correction", async () => {
  let resolveSave; const h = await mount(() => new Promise(resolve => { resolveSave = resolve; }));
  try {
    const c = h.container;
    await click(c.querySelector('[aria-label="Next month"]'));
    await click(c.querySelector('[data-date]'));
    const selected = c.querySelector('[data-date][aria-pressed="true"]').dataset.date;
    await fillGuest(c);
    await act(async () => c.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(c.querySelector('[aria-label="Next month"]').disabled, true);
    assert.equal(c.querySelector('[data-date="' + selected + '"]').disabled, true);
    await act(async () => resolveSave(Response.json({ success: false, message: "Selected package is already booked. Choose another date." }, { status: 409 })));
    assert.match(c.textContent, /already booked/); assert.equal(h.created(), 0);
    assert.equal(c.querySelector('[data-date="' + selected + '"]').getAttribute("aria-pressed"), "true");
    assert.equal(c.querySelector('[aria-label="Next month"]').disabled, false);
  } finally { await h.close(); }
});

async function input(element, next) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(element, next);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}
const submitButton = c => [...c.querySelectorAll("button")].find(button => button.type === "submit");
const monthAfter = month => { const [y,m] = month.split("-").map(Number); return new Date(Date.UTC(y,m,1)).toISOString().slice(0,7); };

test("booked dates and packages are disabled while free night slots and month-end day slots remain selectable", async () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const month = monthAfter(today.slice(0,7)), next = monthAfter(month);
  const last = new Date(next + "-01T12:00:00Z"); last.setUTCDate(0); const lastDay = last.toISOString().slice(0,10);
  const h = await mount(undefined, { availabilityFetcher: () => Response.json({
    reservations: [
      { start_datetime: month + "-02T08:00:00+08:00", end_datetime: month + "-03T06:00:00+08:00" },
      { start_datetime: month + "-03T08:00:00+08:00", end_datetime: month + "-03T16:00:00+08:00" },
      { start_datetime: month + "-04T08:00:00+08:00", end_datetime: month + "-04T16:00:00+08:00" },
    ], blockedDates: [{ start_date: next + "-01", end_date: next + "-01" }],
  }) });
  try {
    const c=h.container; await click(c.querySelector('[aria-label="Next month"]'));
    assert.equal(c.querySelector('[data-date="' + month + '-02"]').disabled,true);
    const partial=c.querySelector('[data-date="' + month + '-03"]');assert.equal(partial.disabled,false);assert.match(partial.textContent,/Night only/);
    await click(partial);
    const packages=[...c.querySelectorAll("label")].find(label=>label.textContent.startsWith("Booking package")).querySelector("select");
    assert.equal(packages.value,"night");assert.equal(packages.querySelector('[value="day"]').disabled,true);
    assert.equal(packages.querySelector('[value="whole_day"]').disabled,true,"whole-day B must include the following day's booked window");
    await click(c.querySelector('[data-date="' + lastDay + '"]'));
    assert.equal(packages.value,"day");assert.equal(packages.querySelector('[value="night"]').disabled,true,"night crosses into maintenance next month");
    assert.equal(packages.querySelector('[value="whole_day"]').disabled,true);
  } finally {await h.close();}
});

test("refreshing availability invalidates a selected package and prevents even a direct form submission",async()=>{
  let booked=false;let selected;
  const h=await mount(undefined,{availabilityFetcher:()=>Response.json({reservations:booked?[{start_datetime:selected+"T08:00:00+08:00",end_datetime:selected+"T16:00:00+08:00"}]:[],blockedDates:[]})});
  try{
    const c=h.container;await click(c.querySelector('[aria-label="Next month"]'));selected=c.querySelector("[data-date]").dataset.date;
    await click(c.querySelector("[data-date]"));await fillGuest(c);assert.equal(submitButton(c).disabled,false);
    booked=true;await act(async()=>window.dispatchEvent(new window.Event("focus")));
    assert.equal(submitButton(c).disabled,true);assert.match(c.textContent,/Already reserved for this package/);
    await act(async()=>c.querySelector("form").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true})));
    assert.equal(h.requests.length,0);
  }finally{await h.close();}
});

test("services and quantities recalculate the bill and downpayment and are included in the saved reservation",async()=>{
  const h=await mount();
  try{
    const c=h.container;await click(c.querySelector('[aria-label="Next month"]'));await click(c.querySelector("[data-date]"));
    await fillGuest(c);
    const checks=c.querySelectorAll('input[type="checkbox"]');await click(checks[0]);await click(checks[1]);
    await input(c.querySelector('[aria-label="Quantity for Karaoke"]'),"2");
    await input(c.querySelector('[aria-label="Quantity for Extra chair"]'),"3");
    const preview=c.querySelector('[aria-label="Billing preview"]');assert.match(preview.textContent,/Additional services: .*1,300\.00/);
    const expected=preview.textContent.includes("Weekend")?9300:8800;assert.ok(preview.textContent.includes(expected.toLocaleString("en-PH")+".00"));
    await input(c.querySelector('[aria-label="Quantity for Karaoke"]'),"0");assert.equal(submitButton(c).disabled,true);
    await input(c.querySelector('[aria-label="Quantity for Karaoke"]'),"1.5");assert.equal(submitButton(c).disabled,true);
    await input(c.querySelector('[aria-label="Quantity for Karaoke"]'),"2");assert.equal(submitButton(c).disabled,false);
    await act(async()=>c.querySelector("form").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true})));
    assert.deepEqual(h.requests[0].body.selectedServices,[{serviceId:"karaoke",quantity:2},{serviceId:"chairs",quantity:3}]);
  }finally{await h.close();}
});

test("availability failures block selection and saving until a successful retry",async()=>{
  let failed=true;
  const h=await mount(undefined,{availabilityFetcher:()=>failed?Response.json({message:"Unavailable"},{status:503}):Response.json({reservations:[],blockedDates:[]})});
  try{
    const c=h.container;assert.match(c.textContent,/Unable to load available dates/);assert.equal(submitButton(c).disabled,true);
    assert.equal(c.querySelector("[data-date]").disabled,true);failed=false;
    await click([...c.querySelectorAll("button")].find(button=>button.textContent==="Retry availability"));
    await click(c.querySelector('[aria-label="Next month"]'));assert.equal(c.querySelector("[data-date]").disabled,false);
  }finally{await h.close();}
});

test("a stale availability response cannot overwrite a newer refresh",async()=>{
  let resolveFirst,call=0;
  const h=await mount(undefined,{availabilityFetcher:()=>++call===1?new Promise(resolve=>{resolveFirst=resolve;}):Response.json({reservations:[],blockedDates:[]})});
  try{
    const c=h.container;assert.equal(c.querySelector("[data-date]").disabled,true);
    await act(async()=>window.dispatchEvent(new window.Event("focus")));await click(c.querySelector('[aria-label="Next month"]'));
    await act(async()=>resolveFirst(Response.json({reservations:[],blockedDates:[{start_date:"2020-01-01",end_date:"2100-12-31"}]})));
    assert.equal(c.querySelector("[data-date]").disabled,false);
  }finally{await h.close();}
});

async function fillGuest(c) {
  for (const [label,next] of Object.entries({ "First name":"Test", "Last name":"Guest", Email:"walkin@example.com", Phone:"09123456789", Address:"Manila" })) {
    const element=[...c.querySelectorAll("label")].find(item=>item.textContent===label)?.querySelector("input");
    assert.ok(element,label);await input(element,next);
  }
}
