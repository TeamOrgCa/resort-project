import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";
import { swimmingRoomCatalog } from "./helpers/swimming-rooms.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/reservations" });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

async function click(element) { assert.ok(element); assert.equal(element.disabled, false); await act(async () => element.click()); }
async function confirmReservationIfOpen() {
  const dialog = document.querySelector('[role="alertdialog"]');
  const confirm = [...(dialog?.querySelectorAll("button") ?? [])].find(button => button.textContent === "Confirm reservation");
  if (confirm) await click(confirm);
}
async function select(container, label, next) {
  const element = [...container.querySelectorAll("label")].find(item => item.textContent.startsWith(label))?.querySelector("select");
  assert.ok(element, label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(element, next);
    element.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}
async function mount(fetcher = () => Response.json({ success: true, reservation: { referenceNumber: "MB-CALENDAR" } }), { availabilityFetcher = () => Response.json({ reservations: [], blockedDates: [] }), roomsFetcher = () => Response.json({ rooms: [], classifications: [] }), realRoomForm = false, times } = {}) {
  const originalFetch = globalThis.fetch, requests = [], bookings = []; let created = 0, closed = 0;
  globalThis.fetch = async (url, options) => {
    if (url === "/api/admin/rooms" && !options?.method) return roomsFetcher();
    if (url.startsWith("/api/booking/rooms?")) return Response.json({success:true,...swimmingRoomCatalog});
    if (url.startsWith("/api/booking/availability")) return availabilityFetcher(url, options);
    requests.push({ url, body: JSON.parse(options.body) }); return fetcher();
  };
  const client = { from(table) {
    assert.notEqual(table, "guests", "Manual entry must not load account choices");
    const data = table === "guests" ? [{ id: "guest", first_name: "Test", last_name: "Guest", email: "test@example.com" }]
      : table === "services" ? [{ service_id: "karaoke", name: "Karaoke", billing_type: "duration", price: 500, description: "Use during the stay" }, { service_id: "chairs", name: "Extra chair", price: 100, description: null }]
      : [{ unit_id: "unit", name: "Resort", capacity: 30 }];
    const q = { select: () => q, order: () => q, limit: () => q, eq: () => q, is: () => q,
      then: (resolve, reject) => Promise.resolve({ data }).then(resolve, reject) };
    return q;
  } };
  const Component = loadTsModule("components/admin/ManualBookingDialog.tsx", {
    "@/components/booking/PublicSwimmingForm": { __esModule: true, default: () => createElement("p", null, "Public swimming reservation form") },
    ...(!realRoomForm ? { "@/components/admin/rooms/RoomActionDialog": { __esModule: true, default: () => createElement("p", null, "Room accommodation reservation form") } } : {}),
    "@/lib/supabase/client": { createClient: () => client },
    "@/lib/booking/use-package-rates": { usePackageRates: () => ({ schedule: { version: 9, rates: legacyRates, times }, error: null }) },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component, { isOpen: true, onClose: () => closed++, onCreated: booking => { created++; bookings.push(booking); } })));
  return { container: document.querySelector('[aria-labelledby="manual-booking-title"]'), requests, bookings, created: () => created, closed: () => closed, async close() {
    await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch;
  } };
}
const dateForWeekday = (month, weekday) => {
  const day = Array.from({ length: 7 }, (_, i) => i + 1).find(day => new Date(month + "-" + String(day).padStart(2, "0") + "T12:00:00Z").getUTCDay() === weekday);
  return month + "-" + String(day).padStart(2, "0");
};

const roomClass = { classification_id: "11111111-1111-4111-8111-111111111111", code: "standard", name: "Standard Rooms", included_capacity: 2, maximum_capacity: 2, cleaning_buffer_minutes: 60, rate_3_hours: 300, rate_12_hours: 900, pricing_version: 4, extension_hourly_rate: 150, additional_guest_rate: 0, base_rate: 900, base_hours: 12 };
const roomInventory = { rooms: [{ room_id: roomClass.classification_id, classification_id: roomClass.classification_id, room_number: "S03", classification: roomClass, is_active: true, status: "vacant", upcoming: [], maintenance: [], current: null }], classifications: [roomClass], canDiscount: false };
const inputField = label => [...document.querySelectorAll("label")].find(item => item.textContent.startsWith(label))?.querySelector("input");
const textButton = text => [...document.querySelectorAll("button")].find(item => item.textContent === text);
async function enterInput(label, value) {
  const input = inputField(label); assert.ok(input, label);
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

test("manual room accommodation keeps one admin modal and the real type selector, preserving edits until discard", async () => {
  const h = await mount(undefined, { realRoomForm: true, roomsFetcher: () => Response.json(roomInventory) });
  try {
    await select(document, "Reservation type", "room_accommodation");
    const dialog = document.querySelector('[role="dialog"]');
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
    assert.equal(dialog.querySelector("h2").textContent, "New Manual Reservation");
    assert.ok(dialog.querySelector(".max-w-3xl"));
    assert.equal(dialog.querySelectorAll("form").length, 1);
    assert.equal(dialog.querySelector("form").getAttribute("aria-label"), "Room accommodation manual reservation");
    assert.equal([...dialog.querySelectorAll("label")].filter(label => label.textContent.startsWith("Reservation type")).length, 1);
    assert.ok(textButton("Create Manual Reservation"));
    assert.equal(textButton("Review & Confirm"), undefined);
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    // An untouched room form can switch in both directions without prompting.
    await select(document, "Reservation type", "public_swimming");
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    await select(document, "Reservation type", "room_accommodation");
    await enterInput("Guest first name", "Maria");
    await select(document, "Reservation type", "private_swimming");
    assert.ok(document.querySelector('[aria-label="Unsaved reservation changes"]'));
    await click(textButton("Continue Editing"));
    assert.equal(inputField("Guest first name").value, "Maria");
    assert.equal(document.querySelector('[data-reservation-guard-ignore]').value, "room_accommodation");
    await select(document, "Reservation type", "public_swimming");
    await click(textButton("Discard Changes"));
    assert.equal(document.querySelector('[data-reservation-guard-ignore]').value, "public_swimming");
    assert.match(document.body.textContent, /Public swimming reservation form/);
  } finally { await h.close(); }
});

test("manual room creation retains pricing and confirmation, blocks navigation while saving and refreshes the booked Manila date", async () => {
  let resolveSave;
  const h = await mount(() => new Promise(resolve => { resolveSave = resolve; }), { realRoomForm: true, roomsFetcher: () => Response.json(roomInventory) });
  try {
    await select(document, "Reservation type", "room_accommodation");
    for (const [label, value] of [["Guest first name", "Maria"], ["Guest last name", "Cruz"], ["Philippine mobile number", "09171234567"], ["Guest address", "Quezon City"], ["Scheduled check-in", "2030-01-02T02:30"], ["Additional extension hours", "2"]]) await enterInput(label, value);
    await select(document, "Accommodation duration", "12");
    assert.match(document.querySelector('[aria-label="Room price quote"]').textContent, /Total to bill.*1,200\.00/);
    const submit = () => act(async () => document.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    await submit(); assert.equal(h.requests.length, 0);
    await click(textButton("Cancel"));
    assert.equal(inputField("Guest first name").value, "Maria"); assert.equal(h.closed(), 0);
    await submit(); await click(textButton("Create reservation"));
    assert.equal(h.requests.length, 1);
    assert.equal(document.querySelector('[data-reservation-guard-ignore]').disabled, true);
    assert.equal(document.querySelector('[aria-label="Close booking dialog"]').disabled, true);
    const { url, body } = h.requests[0];
    assert.equal(url, "/api/admin/rooms"); assert.equal(body.action, "reserve"); assert.equal(body.confirmed, true);
    assert.equal(body.input.commercial_type, "room_accommodation"); assert.equal(body.input.expected_total, 1200);
    assert.equal(body.input.duration_hours, 12); assert.equal(body.input.extension_hours, 2);
    assert.equal(body.input.starts_at, "2030-01-01T18:30:00.000Z");
    await act(async () => resolveSave(Response.json({ success: true, result: { reference_number: "RM-MANUAL" } })));
    assert.deepEqual(h.bookings, [{ date: "2030-01-02", reference: "RM-MANUAL" }]); assert.equal(h.closed(), 1);
  } finally { await h.close(); }
});

test("room inventory loading and failure keep the manual selector usable and support retry", async () => {
  let finishLoad, calls = 0;
  const h = await mount(undefined, { realRoomForm: true, roomsFetcher: () => ++calls === 1 ? new Promise(resolve => { finishLoad = resolve; }) : Response.json(roomInventory) });
  try {
    await select(document, "Reservation type", "room_accommodation");
    assert.match(document.querySelector('[role="status"]').textContent, /Loading room inventory/);
    assert.equal(document.querySelector('[data-reservation-guard-ignore]').disabled, false);
    await act(async () => finishLoad(Response.json({ message: "Unable to load rooms." }, { status: 500 })));
    assert.match(document.querySelector('[role="alert"]').textContent, /Unable to load rooms/);
    await click(textButton("Reload room inventory"));
    assert.ok(document.querySelector('[aria-label="Room accommodation manual reservation"]'));
    await select(document, "Reservation type", "private_swimming");
    assert.equal(Boolean(document.querySelector('[role="alertdialog"]')), false);
    assert.ok(document.querySelector('[aria-labelledby="manual-booking-title"]'));
  } finally { await h.close(); }
});

test("manual room accommodation adds and removes rooms, combines prices, and saves every room under one guest and reference", async () => {
  const primary = roomInventory.rooms[0];
  const familyClass = { ...roomClass, classification_id: "22222222-2222-4222-8222-222222222222", code: "family", name: "Family Rooms", included_capacity: 4, maximum_capacity: 6, rate_3_hours: 500, rate_12_hours: 1500, extension_hourly_rate: 200, additional_guest_rate: 100, pricing_version: 3 };
  const family = { ...primary, room_id: "33333333-3333-4333-8333-333333333333", room_number: "F01", classification_id: familyClass.classification_id, classification: familyClass };
  const protectedRoom = { ...primary, room_id: "44444444-4444-4444-8444-444444444444", room_number: "S01", private_swimming_only: true };
  const inactiveRoom = { ...primary, room_id: "55555555-5555-4555-8555-555555555555", room_number: "S05", is_active: false };
  const inventory = { ...roomInventory, rooms: [primary, family, protectedRoom, inactiveRoom], classifications: [roomClass, familyClass], canDiscount: true };
  let attempts = 0;
  const h = await mount(() => ++attempts === 1 ? Response.json({ message: "Room F01 was just reserved. Choose another room.", outcome: "not_applied" }, { status: 409 }) : Response.json({ success: true, result: { reference_number: "RM-GROUP" } }), { realRoomForm: true, roomsFetcher: () => Response.json(inventory) });
  try {
    await select(document, "Reservation type", "room_accommodation");
    await click(textButton("Add another room"));
    assert.ok(inputField("Occupants for room 2"));
    const extra = [...document.querySelectorAll("label")].find(label => label.textContent.startsWith("Additional room 2")).querySelector("select");
    assert.equal(extra.value, family.room_id);
    assert.equal(extra.querySelector(`option[value="${primary.room_id}"]`).disabled, true);
    assert.equal(extra.querySelector(`option[value="${protectedRoom.room_id}"]`), null);
    assert.equal(extra.querySelector(`option[value="${inactiveRoom.room_id}"]`), null);
    assert.equal(textButton("Add another room").disabled, true);
    assert.match(document.querySelector('[aria-label="Room price quote"]').textContent, /Total to bill.*800\.00/);
    await click(document.querySelector('[aria-label="Remove room 2"]'));
    assert.equal(Boolean(document.querySelector('[aria-label="Additional rooms"] select')), false);
    assert.match(document.querySelector('[aria-label="Room price quote"]').textContent, /Total to bill.*300\.00/);
    // Reverting an added row leaves the original form clean.
    await select(document, "Reservation type", "public_swimming");
    assert.equal(Boolean(document.querySelector('[role="alertdialog"]')), false);
    await select(document, "Reservation type", "room_accommodation");
    await click(textButton("Add another room"));
    for (const [label, value] of [["Guest first name", "Maria"], ["Guest last name", "Cruz"], ["Philippine mobile number", "09171234567"], ["Guest address", "Quezon City"], ["Scheduled check-in", "2030-01-02T02:30"], ["Occupants (maximum", "2"], ["Occupants for room 2", "6"], ["Additional extension hours", "1"], ["Verified PWD / senior", "4"], ["Eligibility verification", "Verified four eligibility IDs"]]) await enterInput(label, value);
    assert.match(document.querySelector('[aria-label="Room price quote"]').textContent, /Total to bill.*1,270\.00/);
    assert.equal(inputField("Verified PWD / senior").max, "8");
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
    const submit = () => act(async () => document.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    await submit(); assert.equal(h.requests.length, 0);
    assert.match(document.querySelector('[role="alertdialog"]').textContent, /S03, F01/);
    await click(textButton("Create reservation"));
    assert.equal(h.created(), 0); assert.equal(h.closed(), 0);
    assert.match(document.querySelector('[role="alert"]').textContent, /just reserved/);
    assert.equal(inputField("Guest first name").value, "Maria"); assert.equal(inputField("Occupants for room 2").value, "6");
    const { body } = h.requests[0];
    assert.equal(body.input.occupants, 8); assert.equal(body.input.expected_total, 1270);
    assert.deepEqual(body.input.rooms, [{ room_id: primary.room_id, occupants: 2, pricing_version: 4 }, { room_id: family.room_id, occupants: 6, pricing_version: 3 }]);
    await submit(); await click(textButton("Create reservation"));
    assert.equal(h.requests.length, 2); assert.deepEqual(h.bookings, [{ date: "2030-01-02", reference: "RM-GROUP" }]); assert.equal(h.closed(), 1);
  } finally { await h.close(); }
});

test("reservation type switches clean manual forms without a discard prompt", async () => {
  for (const [type, destination] of [["public_swimming", "Public swimming reservation form"], ["room_accommodation", "Room accommodation reservation form"]]) {
    const h = await mount();
    try {
      await select(h.container, "Reservation type", type);
      assert.equal(Boolean(document.querySelector('[role="alertdialog"]')), false);
      assert.match(document.body.textContent, new RegExp(destination));
      assert.equal(document.querySelector('[aria-labelledby="manual-booking-title"]'), null);
    } finally { await h.close(); }
  }
});

test("reservation type switches preserve real edits when cancelled and switch to the chosen type after discard", async () => {
  for (const [type, destination] of [["public_swimming", "Public swimming reservation form"], ["room_accommodation", "Room accommodation reservation form"]]) {
    const h = await mount();
    try {
      const name = [...h.container.querySelectorAll("label")].find(label => label.textContent.startsWith("First name")).querySelector("input");
      await act(async () => {
        name.focus();
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(name, "Maria");
        name.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
      await select(h.container, "Reservation type", type);
      assert.ok(document.querySelector('[role="alertdialog"]'));
      await click([...document.querySelectorAll('[role="alertdialog"] button')].find(button => button.textContent === "Continue Editing"));
      assert.equal(name.value, "Maria");
      assert.equal([...h.container.querySelectorAll("label")].find(label => label.textContent.startsWith("Reservation type")).querySelector("select").value, "private_swimming");
      await select(h.container, "Reservation type", type);
      await click([...document.querySelectorAll('[role="alertdialog"] button')].find(button => button.textContent === "Discard Changes"));
      assert.match(document.body.textContent, new RegExp(destination));
      assert.equal(document.querySelector('[aria-labelledby="manual-booking-title"]'), null);
    } finally { await h.close(); }
  }
});

test("offline booking calendar enforces the inclusive advance limit while keeping later months visible",async()=>{
 const {maximumBookingDate}=loadTsModule("lib/booking/advance-window.ts"),last=maximumBookingDate(2);
 const h=await mount(undefined,{availabilityFetcher:()=>Response.json({reservations:[],blockedDates:[],maxBookingDate:last})});
 try{
  let end=h.container.querySelector(`[data-date="${last}"]`);
  if(!end){await click(h.container.querySelector('[aria-label="Next month"]'));end=h.container.querySelector(`[data-date="${last}"]`);}
  assert.ok(end);assert.equal(end.disabled,false);assert.equal(h.container.querySelector('[aria-label="Next month"]').disabled,false);
  const beyond=new Date(`${last}T00:00:00Z`);beyond.setUTCDate(beyond.getUTCDate()+1);
  const button=h.container.querySelector(`[data-date="${beyond.toISOString().slice(0,10)}"]`);if(button)assert.equal(button.disabled,true);
 }finally{await h.close();}
});

test("manual creation waits for confirmation and cancelling keeps the guest and selected date", async () => {
  const h = await mount();
  try {
    const c = h.container;
    await click(c.querySelector('[aria-label="Next month"]'));
    await click(c.querySelector("[data-date]")); await fillGuest(c);
    assert.match(c.textContent,/2 Standard rooms included at no extra charge/);
    const extras=c.querySelector('[aria-label="Extra Standard Rooms"]');
    await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set.call(extras,'2');extras.dispatchEvent(new window.Event('change',{bubbles:true}));});
    const selected = c.querySelector('[data-date][aria-pressed="true"]').dataset.date;
    const submit = () => act(async () => c.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    await submit();
    assert.equal(h.requests.length, 0);
    const dialog = document.querySelector('[role="alertdialog"]');
    assert.match(dialog.textContent, /Walk.*Guest|Guest.*Total/s);
    assert.match(dialog.textContent, /Philippine time/);
    assert.equal(document.activeElement.textContent, "Keep editing");
    await click([...dialog.querySelectorAll("button")].find(button => button.textContent === "Keep editing"));
    assert.equal(h.requests.length, 0);
    assert.equal(c.querySelector('[data-date][aria-pressed="true"]').dataset.date, selected);
    assert.equal(c.querySelector('input[type="email"]').value, "walkin@example.com");
    await submit(); await confirmReservationIfOpen();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].body.swimmingRooms[0].quantity,2);assert.ok(h.requests[0].body.expectedTotal>1200);
  } finally { await h.close(); }
});

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
    await confirmReservationIfOpen();
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
    await confirmReservationIfOpen();
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
    await confirmReservationIfOpen();
    assert.equal(h.requests.length,0);
  }finally{await h.close();}
});

test("hourly rentals and item quantities recalculate manual billing and save the selected hours/counts",async()=>{
  const h=await mount();
  try{
    const c=h.container;await click(c.querySelector('[aria-label="Next month"]'));await click(c.querySelector("[data-date]"));
    await fillGuest(c);
    const checks=c.querySelectorAll('input[type="checkbox"]');await click(checks[0]);await click(checks[1]);
    await input(c.querySelector('[aria-label="Duration (Hours) for Karaoke"]'),"2");
    await input(c.querySelector('[aria-label="Quantity for Extra chair"]'),"3");
    const preview=c.querySelector('[aria-label="Billing preview"]');assert.match(preview.textContent,/Additional services: .*1,300\.00/);
    assert.match(c.textContent, /Per Hour/); assert.match(c.textContent, /per hour/); assert.match(c.textContent, /Per Piece/);
    const expected=preview.textContent.includes("Weekend")?9300:8800;assert.ok(preview.textContent.includes(expected.toLocaleString("en-PH")+".00"));
    await input(c.querySelector('[aria-label="Duration (Hours) for Karaoke"]'),"0");assert.equal(submitButton(c).disabled,true);
    await input(c.querySelector('[aria-label="Duration (Hours) for Karaoke"]'),"1.5");assert.equal(submitButton(c).disabled,true);
    await input(c.querySelector('[aria-label="Duration (Hours) for Karaoke"]'),"2");assert.equal(submitButton(c).disabled,false);
    await act(async()=>c.querySelector("form").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true})));
    await confirmReservationIfOpen();
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
  for (const [label,next] of Object.entries({ "First name":"Test", "Last name":"Guest", "Email (optional)":"walkin@example.com", Phone:"09123456789", Address:"Manila" })) {
    const fieldLabel=[...c.querySelectorAll("label")].find(item=>item.textContent===label);
    const element=fieldLabel?.control??fieldLabel?.querySelector("input");
    assert.ok(element,label);await input(element,next);
  }
}

test("manual entry filters numbers and emojis from both walk-in names", async () => {
  const h = await mount();
  try {
    for (const label of ["First name", "Last name"]) {
      const field = [...h.container.querySelectorAll("label")].find(item => item.textContent === label).querySelector("input");
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(field, "José123 😀 ９");
        field.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
      assert.equal(field.value, "José  ");
    }
    assert.equal(h.requests.length, 0);
  } finally { await h.close(); }
});

test("manual entry blocks invalid phone numbers and saves valid contacts with the country code", async () => {
  const h = await mount();
  try {
    const c = h.container;
    await click(c.querySelector('[aria-label="Next month"]'));
    await click(c.querySelector("[data-date]")); await fillGuest(c);
    const phone = c.querySelector("#walk-in-phone");
    assert.match(phone.parentElement.textContent, /\+63/);
    for (const value of ["0917abc4567", "+649171234567", "+63 917 123 4567"]) {
      await input(phone, value);
      await act(async () => c.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
      await confirmReservationIfOpen();
      if (value === "+63 917 123 4567") {
        assert.equal(h.requests.length, 1);
        assert.equal(h.requests[0].body.walkInGuest.phoneNumber, "+639171234567");
      } else {
        assert.equal(h.requests.length, 0);
        assert.match(c.textContent, /valid Philippine mobile number/);
      }
    }
  } finally { await h.close(); }
});


test("manual booking labels and submitted windows follow edited catalog time slots", async () => {
  const { DEFAULT_PACKAGE_TIMES } = loadTsModule("lib/booking/package-times.ts");
  const times = structuredClone(DEFAULT_PACKAGE_TIMES);
  times.day = { start: "09:30", end: "17:00", endDayOffset: 0 };
  const h = await mount(undefined, { times });
  try {
    const c = h.container;
    assert.match(c.textContent, /9:30 AM/);
    await click(c.querySelector('[aria-label="Next month"]'));
    await click(c.querySelector('button[data-date]:not([disabled])'));
    await fillGuest(c);
    await act(async () => c.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    await confirmReservationIfOpen();
    assert.equal(h.requests.length, 1);
    assert.match(h.requests[0].body.startDatetime, /T01:30:00.000Z$/);
    assert.match(h.requests[0].body.endDatetime, /T09:00:00.000Z$/);
  } finally { await h.close(); }
});

test("an independently edited whole-day slot remains selectable when day and night are occupied", async () => {
  const { DEFAULT_PACKAGE_TIMES } = loadTsModule("lib/booking/package-times.ts");
  const times = structuredClone(DEFAULT_PACKAGE_TIMES);
  times.day = { start: "08:00", end: "10:00", endDayOffset: 0 };
  times.night = { start: "11:00", end: "13:00", endDayOffset: 0 };
  times.whole_day.day_to_night = { start: "14:00", end: "16:00", endDayOffset: 0 };
  times.whole_day.night_to_day = { start: "17:00", end: "19:00", endDayOffset: 0 };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const date = monthAfter(today.slice(0, 7)) + "-05";
  const h = await mount(undefined, { times, availabilityFetcher: () => Response.json({ reservations: [
    { start_datetime: date + "T08:00:00+08:00", end_datetime: date + "T10:00:00+08:00" },
    { start_datetime: date + "T11:00:00+08:00", end_datetime: date + "T13:00:00+08:00" },
  ], blockedDates: [] }) });
  try {
    const c = h.container;
    await click(c.querySelector('[aria-label="Next month"]'));
    const day = c.querySelector(`[data-date="${date}"]`);
    assert.match(day.textContent, /Whole day only/);
    await click(day); await fillGuest(c);
    await act(async () => c.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    await confirmReservationIfOpen();
    assert.equal(h.requests[0].body.bookingMode, "whole_day");
    assert.equal(h.requests[0].body.wholeDayVariant, "day_to_night");
    assert.equal(h.requests[0].body.startDatetime, date + "T06:00:00.000Z");
  } finally { await h.close(); }
});

test("staff cannot select an ongoing package and can still submit a future night package today", async () => {
  const originalNow = Date.now;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  Date.now = () => Date.parse(today + "T12:00:00+08:00");
  let h;
  try {
    h = await mount();
    const c = h.container;
    await click(c.querySelector(`[data-date="${today}"]`));
    const dayOption = [...c.querySelectorAll("label")].find(label => label.textContent.startsWith("Booking package")).querySelector('option[value="day"]');
    assert.equal(dayOption.disabled, true);
    assert.doesNotMatch(c.textContent, /Choose a start time at least 30 minutes/);
    await select(c, "Booking package", "night"); await fillGuest(c);
    await act(async () => c.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    await confirmReservationIfOpen();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].body.startDatetime, today + "T10:00:00.000Z");
    assert.equal(h.requests[0].body.endDatetime, new Date(Date.parse(today + "T22:00:00Z")).toISOString());
  } finally { if (h) await h.close(); Date.now = originalNow; }
});

test("staff cannot select or submit today's fully ended package", async () => {
  const originalNow = Date.now;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  Date.now = () => Date.parse(today + "T16:00:00+08:00");
  let h;
  try {
    h = await mount();
    const c = h.container;
    const dayOption = [...c.querySelectorAll("label")].find(label => label.textContent.startsWith("Booking package")).querySelector('option[value="day"]');
    assert.equal(dayOption.disabled, true);
    await fillGuest(c);
    await act(async () => c.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    await confirmReservationIfOpen();
    assert.equal(h.requests.length, 0);
    assert.match(c.textContent, /scheduled start time is still in the future/);
  } finally { if (h) await h.close(); Date.now = originalNow; }
});


test("manual reservations allow blank email and month navigation stays clean while choosing a date is guarded", async () => {
  const h=await mount();
  try {
    const c=h.container, close=()=>c.querySelector('[aria-label="Close booking dialog"]');
    await click(close()); assert.equal(h.closed(),1);
    await click(c.querySelector('[aria-label="Next month"]'));
    await click(close()); assert.equal(h.closed(),2,"browsing the calendar is not an unsaved change");
    await click(c.querySelector('[data-date]'));
    await click(close()); assert.equal(h.closed(),2);
    assert.ok(document.querySelector('[role="alertdialog"]'));
    await click([...document.querySelectorAll("button")].find(button=>button.textContent==="Continue Editing"));
    await fillGuest(c);
    await input(c.querySelector('input[type="email"]'),"");
    await act(async()=>c.querySelector("form").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true})));
    await confirmReservationIfOpen();
    assert.equal(h.requests.length,1); assert.equal(h.requests[0].body.walkInGuest.email,"");
    assert.equal(h.created(),1);
  } finally {await h.close();}
});
