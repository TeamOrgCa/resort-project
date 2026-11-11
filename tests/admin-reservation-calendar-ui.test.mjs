import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/reservations" });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const tomorrow = new Date(Date.parse(day + "T00:00:00Z") + 86400000).toISOString().slice(0,10);
const id = "11111111-1111-4111-8111-111111111111";
const base = { guest_id: "guest", start_datetime: day + "T00:00:00+08:00", end_datetime: tomorrow + "T06:00:00+08:00", adult_count: 3, child_count: 1, booking_mode: "whole_day", payment_deadline_at: null, checked_in_at: null };
const button = (c,label) => [...c.querySelectorAll("button")].find(el => (el.getAttribute("aria-label") ?? el.textContent.trim()) === label);
const agenda = () => document.querySelector('[aria-label="Mobile calendar entries"]');
const click = async el => { assert.ok(el); assert.equal(el.disabled,false); await act(async () => el.click()); };
async function confirmMaintenanceIfOpen() {
  const dialog = document.querySelector('[role="alertdialog"]');
  const confirm = [...(dialog?.querySelectorAll("button") ?? [])].find(button => button.textContent === "Confirm maintenance block");
  if (confirm) await click(confirm);
}
async function mount({ role = "staff", permissions = ["dashboard","reservations","transactions","records","create_reservation","edit_reservation","cancel_reservation","payment_approval","ocular_approval"], failure = null, initialAccess, blockFailure = false, paymentFollowUpError = false, fullyPaid = false, arrived = false, includeOcular = false, userId = "staff", clearStorage = true, ocularStatus = "pending", manualCreation = false, realManual = false, ended = false, mixedEntries = false } = {}) {
  if (clearStorage) window.localStorage.clear();
  const saved = globalThis.fetch, calls = [], blocks = [];
  const data = {
    reservations: [{ ...base, reservation_id: id, reference_number: "MV-CONFIRMED", status: "confirmed" }, { ...base, reservation_id: "pending", reference_number: "MV-PENDING", status: "payment_submitted" }, { ...base, reservation_id: "cancelled", reference_number: "MV-CANCELLED", status: "cancelled" }],
    payments: [{ payment_id: "payment", reservation_id: id, reference_number: "GCASH-REFERENCE", amount:100, payment_type:"additional", account_name:"Guest", account_number:"09171234567", receipt_paid_at:day+"T08:00:00+08:00", paid_at:day+"T08:01:00+08:00", proof_path:"guest/receipt.png",status:"pending",ocr_status:"consistent",ocr_notes:null }], reservation_reschedules: [{ reservation_id: id, status:"pending" }], refund_requests: [{ reservation_id: "cancelled" }],
    transactions: [{ reservation_id: id, balance: 500 }, { reservation_id: "pending", balance: 1000 }, { reservation_id: "cancelled", balance: 3000 }],
    guests: [{ id: "guest", first_name: "Test", last_name: "Guest", email: "guest@example.com" }],
    staff_users: { role, is_active: true }, role_permissions: { permissions }, ocular_visits: [], walk_in_guests: [],
    units: [{unit_id:"unit",name:"Resort",capacity:30}], services: [],
  };
  if (ended) { data.reservations[0].start_datetime = new Date(Date.now() - 3600000).toISOString(); data.reservations[0].end_datetime = new Date(Date.now() - 1000).toISOString(); }
  if (arrived) data.reservations[0].checked_in_at = new Date().toISOString();
  if (fullyPaid) { data.payments = []; data.reservation_reschedules = []; data.transactions[0].balance = 0; }
  if (includeOcular) data.ocular_visits = [{ visit_id:"ocular",reference_number:"MV-OCULAR",guest_id:"guest",scheduled_date:day,status:ocularStatus }];
  if (mixedEntries) {
    for (const [key, status, attendance] of [
      ["awaiting", "pending", {}], ["checked-in", "confirmed", { checked_in_at: day + "T08:00:00+08:00" }],
      ["completed", "completed", { checked_in_at: day + "T08:00:00+08:00", checked_out_at: day + "T16:00:00+08:00" }],
      ["no-show", "no_show", {}], ["rejected", "rejected", {}], ["rescheduled", "reschedule_requested", {}],
    ]) data.reservations.push({ ...base, ...attendance, reservation_id: key, reference_number: `MV-${key.toUpperCase()}`, status });
    data.ocular_visits.push(...["cancelled", "completed"].map(status => ({ visit_id: `ocular-${status}`, reference_number: `MV-OCULAR-${status.toUpperCase()}`, guest_id: "guest", scheduled_date: day, status })));
    blocks.push({ block_id: "maintenance", name: "Pool maintenance", reason: "Pool repairs", start_date: day, end_date: day, status: "active" });
  }
  const tables = [];
  const client = { storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:"https://example.com/proof.png"},error:null})})}, auth: { getUser: async () => ({ data: { user: { id: userId } } }) }, from(table) {
    tables.push(table);
    const filters=[];
    const result = () => ({ data: Array.isArray(data[table]) ? data[table].filter(row=>filters.every(fn=>fn(row))) : data[table] ?? [], error: table === failure ? { message: "Read failed" } : null });
    const q = { select:()=>q,neq:()=>q,lt:()=>q,gt:()=>q,order:()=>q,limit:()=>q,gte:()=>q,in:()=>q,eq:(key,value)=>{filters.push(row=>row[key]===value);return q;},maybeSingle:async()=>{const r=result();return {...r,data:Array.isArray(r.data)?r.data[0]??null:r.data};},then:(yes,no)=>Promise.resolve(result()).then(yes,no) }; return q;
  } };
  globalThis.fetch = async (url, options) => {
    if (url.startsWith("/api/booking/availability")) return Response.json({reservations:[],blockedDates:[]});
    if (url.startsWith("/api/admin/maintenance-blocks")) {
      if (options?.method === "POST") {
        const body=JSON.parse(options.body); calls.push({url,body});
        if(blockFailure) return Response.json({message:"These dates have an active reservation."},{status:409});
        blocks.push({block_id:"block",name:body.name,reason:body.reason,start_date:body.startDate,end_date:body.endDate,status:"active"});
        return Response.json({blockId:"block",message:"Dates blocked and guest alerts created."},{status:201});
      }
      return Response.json({ blocks });
    }
    if(url.startsWith("/api/admin/payments/")) {
      calls.push({url,body:JSON.parse(options.body)});data.payments[0].status=url.endsWith("approve")?"verified":"rejected";
      if(paymentFollowUpError)return Response.json({message:"Billing follow-up failed"},{status:503});
      return Response.json({success:true});
    }
    if (url.includes("/ocular-visits/")) {
      const body = JSON.parse(options.body); calls.push({url,body});
      data.ocular_visits[0] = {...data.ocular_visits[0],status:url.endsWith("cancel")?"cancelled":url.endsWith("complete")?"completed":"confirmed",review_reason:body.reviewReason,cancellation_reason:body.cancellationReason};
      return Response.json({success:true,message:"Ocular decision saved.",visit:data.ocular_visits[0]});
    }
    if (url.endsWith("/no-show")) {
      const body=JSON.parse(options.body);calls.push({url,body});
      data.reservations[0]={...data.reservations[0],status:"no_show",no_show_at:new Date().toISOString(),no_show_reason:body.reason};
      return Response.json({success:true,reservation:data.reservations[0],message:"Reservation marked No show."});
    }
    if (url.endsWith("/check-out")) {
      calls.push({url,body:JSON.parse(options.body)});data.reservations[0].status="completed";data.reservations[0].checked_out_at=new Date().toISOString();
      return Response.json({success:true,reservation:data.reservations[0],message:"Stay completed."});
    }
    calls.push({ url, body: JSON.parse(options.body) }); data.reservations[0].checked_in_at = new Date().toISOString();
    return Response.json({ success: true });
  };
  const mocks = {
    "@/lib/supabase/client": { createClient:()=>client },
    "@/components/admin/ManualBookingDialog": { __esModule: true, default:({isOpen,onCreated})=>manualCreation && isOpen ? createElement("button", {onClick:()=>{
      data.reservations.push({...base,reservation_id:"created",reference_number:"MB-NEW",status:"pending",start_datetime:tomorrow+"T08:00:00+08:00",end_datetime:tomorrow+"T16:00:00+08:00"});
      onCreated({id:"created",reference:"MB-NEW",date:tomorrow});
    }}, "Create test booking") : null },
    "@/components/admin/ReservationEditor": { __esModule: true, default:()=>createElement("p",null,"Reservation editor") },
    "next/image":{__esModule:true,default:({src,alt,onLoad,onError})=>createElement("img",{src,alt,onLoad,onError})},
    "next/link": { __esModule: true, default: ({ children, ...props }) => createElement("a", props, children) },
  };
  if(realManual) {
    delete mocks["@/components/admin/ManualBookingDialog"];
    const {legacyRates} = await import("./helpers/package-rates.mjs");
    mocks["@/lib/booking/use-package-rates"] = {usePackageRates:()=>({schedule:{version:1,rates:legacyRates},error:null})};
  }
  const Component = loadTsModule("components/admin/ReservationCalendar.tsx", mocks).default;
  const c = document.createElement("div"); document.body.append(c); const root = createRoot(c);
  await act(async()=>root.render(createElement(Component, { initialAccess })));
  return { c, calls, tables, close:async()=>{ await act(async()=>root.unmount()); c.remove(); globalThis.fetch=saved; } };
}
test("calendar reads all workflow signals, distinguishes bookings and confirms and filters the mobile day agenda", async () => {
  const h = await mount();
  try {
    for(const table of ["payments","reservation_reschedules","refund_requests","transactions"]) assert.ok(h.tables.includes(table));
    assert.match(agenda().textContent,/Booking request.*MV-PENDING/); assert.match(agenda().textContent,/Confirmed reservation.*MV-CONFIRMED/);
    assert.match(agenda().textContent,/Refund pending/); assert.match(agenda().textContent,/Today: not checked in/);
    await filter(h.c,"refund"); assert.match(agenda().textContent,/MV-CANCELLED/); assert.doesNotMatch(agenda().textContent,/MV-CONFIRMED|MV-PENDING/);
    await filter(h.c,"arrival"); assert.match(agenda().textContent,/MV-CONFIRMED/); assert.doesNotMatch(agenda().textContent,/MV-CANCELLED|MV-PENDING/);
    await click(button(h.c,"Agenda")); assert.match(agenda().textContent,/MV-CONFIRMED/);
    await click(button(h.c,"Next month") ?? h.c.querySelector('[aria-label="Next month"]'));
    assert.match(agenda().textContent,/No entries match/);
  } finally { await h.close(); }
});

test("type and status filters work in both calendars, combine with search and attention, and clear together", async () => {
  const h = await mount({ includeOcular: true, ocularStatus: "confirmed", mixedEntries: true });
  const selector = '[aria-label="Filter calendar by type or status"]';
  const visible = root => new Set([...root.querySelectorAll('[data-calendar-event]')].map(el => el.getAttribute("data-calendar-event").split(":")[0]));
  const desktop = h.c.querySelector('[aria-label="Desktop reservation calendar"]');
  try {
    assert.equal(button(h.c, "Clear filters").disabled, true);
    const all = visible(agenda());
    const availability = () => [...desktop.querySelectorAll("p[title]")].map(p => p.textContent);
    const originalAvailability = availability();
    const cases = [
      ["reservations", [id, "pending", "cancelled", "awaiting", "checked-in", "completed", "no-show", "rejected", "rescheduled"]],
      ["booking", ["pending", "awaiting"]], ["ocular", ["ocular", "ocular-cancelled", "ocular-completed"]], ["maintenance", ["maintenance"]],
      ["pending", ["awaiting"]], ["payment_submitted", ["pending"]], ["confirmed", [id, "checked-in", "ocular"]],
      ["checked_in", ["checked-in"]], ["completed", ["completed", "ocular-completed"]],
      ["cancelled", ["cancelled", "ocular-cancelled"]], ["no_show", ["no-show"]], ["rejected", ["rejected"]], ["reschedule_requested", ["rescheduled"]],
    ];
    for (const [value, expected] of cases) {
      await filter(h.c, value, selector);
      assert.deepEqual(visible(agenda()), new Set(expected), value + " mobile");
      assert.deepEqual(visible(desktop), new Set(expected), value + " desktop");
      assert.deepEqual(availability(), originalAvailability, "Filtering does not change package availability");
    }
    await filter(h.c, "checked_in", selector); assert.match(agenda().textContent, /Checked in/);
    await click(button(h.c, "Week"));
    await act(async () => new Promise(resolve => setTimeout(resolve, 500)));
    assert.deepEqual(visible(agenda()), new Set(["checked-in"]));
    assert.ok(h.c.querySelector(".calendar-match-pulse"));
    await filter(h.c, "cancelled", selector); await filter(h.c, "refund");
    assert.deepEqual(visible(agenda()), new Set(["cancelled"]));
    await filter(h.c, "all");
    await input(h.c.querySelector('input[type="search"]'), "MV-OCULAR");
    assert.deepEqual(visible(agenda()), new Set(["ocular-cancelled"]));
    await input(h.c.querySelector('input[type="search"]'), "no-such-entry");
    assert.deepEqual(visible(agenda()), new Set());
    assert.match(h.c.textContent, /No entries match your search and filters/);
    await click(button(h.c, "Clear filters"));
    assert.equal(h.c.querySelector(selector).value, "all"); assert.equal(h.c.querySelector('input[type="search"]').value, "");
    assert.deepEqual(visible(agenda()), all);
    assert.equal(h.c.querySelector(".calendar-match-pulse"), null);
    assert.equal(button(h.c, "Clear filters").disabled, true);
  } finally { await h.close(); }
});

test("calendar uses red attention backgrounds without exclamation badges and distinct default status colors", async () => {
  const h = await mount();
  try {
    const events = h.c.querySelectorAll('[data-needs-attention="true"]');
    assert.ok(events.length > 0);
    for (const event of events) {
      assert.equal(event.style.backgroundColor, "rgb(185, 28, 28)");
      assert.doesNotMatch(event.textContent, /!/);
    }
    const legend = h.c.querySelector('[aria-label="Calendar legend"]');
    const colors = [...legend.querySelectorAll('span[style]')].map(dot => dot.style.backgroundColor);
    assert.equal(new Set(colors).size, colors.length);
    assert.match(legend.textContent, /Confirmed.*Completed.*Cancelled/);
  } finally { await h.close(); }
});

test("calendar colors and viewed dots persist per staff account and reset colors keeps bookings viewed", async () => {
  let h = await mount({ fullyPaid: true, arrived: true });
  const event = () => [...agenda().querySelectorAll('[data-calendar-event]')].find(el => el.textContent.includes("MV-CONFIRMED"));
  try {
    assert.ok(event().querySelector('[aria-label="New booking — not yet viewed"]'));
    assert.equal(h.c.querySelector('[aria-label="Confirmed color"]'), null);
    const settings = button(h.c, "Calendar color settings"); settings.focus();
    await click(settings);
    assert.match(document.querySelector('[role="dialog"]').textContent, /Calendar colors/);
    assert.ok(document.querySelector('[aria-label="Confirmed color"]').classList.contains("calendar-color-picker"));
    await input(document.querySelector('[aria-label="Confirmed color"]'), "#ffffff");
    assert.equal(event().style.backgroundColor, "rgb(255, 255, 255)");
    assert.equal(event().style.color, "rgb(17, 17, 17)");
    await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(document.activeElement, settings);
    await click(event());
    assert.equal(h.c.querySelector(`[data-calendar-event^="${id}"] [aria-label="New booking — not yet viewed"]`), null);
    await h.close(); h = await mount({ fullyPaid: true, arrived: true, clearStorage: false });
    assert.equal(event().style.backgroundColor, "rgb(255, 255, 255)");
    assert.equal(event().querySelector('[aria-label="New booking — not yet viewed"]'), null);
    await click(button(h.c, "Calendar color settings"));
    await click(button(document.body, "Reset default colors"));
    assert.equal(event().style.backgroundColor, "rgb(29, 78, 216)");
    assert.equal(event().querySelector('[aria-label="New booking — not yet viewed"]'), null);
    await h.close(); h = await mount({ userId: "other-staff", clearStorage: false });
    assert.ok(event().querySelector('[aria-label="New booking — not yet viewed"]'));
  } finally { await h.close(); }
});

test("search and filters scroll to the full calendar, briefly pulse matching events and explain empty results", async () => {
  const original = window.HTMLElement.prototype.scrollIntoView;
  const scrolls = [];
  window.HTMLElement.prototype.scrollIntoView = function (options) { scrolls.push({ label: this.getAttribute("aria-label"), options }); };
  const h = await mount();
  try {
    assert.equal(scrolls.length, 0);
    await input(h.c.querySelector('input[type="search"]'), "MV-CONFIRMED");
    await act(async () => new Promise(resolve => setTimeout(resolve, 500)));
    assert.equal(scrolls.at(-1).label, "Full reservation calendar");
    const matches = h.c.querySelectorAll(".calendar-match-pulse");
    assert.ok(matches.length > 0);
    for (const match of matches) assert.match(match.getAttribute("data-calendar-event"), new RegExp(id));
    await act(async () => new Promise(resolve => setTimeout(resolve, 2450)));
    assert.equal(h.c.querySelector(".calendar-match-pulse"), null);
    await input(h.c.querySelector('input[type="search"]'), "no-such-booking");
    await act(async () => new Promise(resolve => setTimeout(resolve, 500)));
    assert.match(h.c.textContent, /No entries match your search and filters/);
    assert.equal(h.c.querySelector(".calendar-match-pulse"), null);
  } finally { await h.close(); window.HTMLElement.prototype.scrollIntoView = original; }
});

test("admins can manage maintenance while other operational actions stay unavailable", async () => {
  const h = await mount({ role: "admin", initialAccess: { role: "admin", permissions: ["reservations", "create_reservation", "edit_reservation", "cancel_reservation", "payment_approval", "ocular_approval"] } });
  try {
    assert.equal(Boolean(button(h.c, "New reservation")), false);
    assert.equal(Boolean(button(h.c, "Add maintenance block")), true);
    await filter(h.c, "arrival");
    assert.match(agenda().textContent, /MV-CONFIRMED/);
    await click([...agenda().querySelectorAll("button")].find(b => b.textContent.includes("MV-CONFIRMED")));
    for (const label of ["Record guest arrival", "Cancel reservation", "Approve payment", "Reject payment"]) assert.equal(Boolean(button(document.body, label)), false, label);
    assert.equal(h.calls.length, 0);
  } finally { await h.close(); }
});
test("recorded guest arrival needs acknowledgement, submits once, refreshes its flag and links to the review modules",async()=>{
  const h=await mount();
  try {
    await click([...agenda().querySelectorAll("button")].find(el=>el.textContent.includes("MV-CONFIRMED")));
    const dialog=document.querySelector('[role="dialog"]');assert.ok(dialog);assert.match(dialog.textContent,/Needs attention/);
    assert.equal(button(dialog,"Mark guest checked in").disabled,true);
    for (const path of ["/admin/transactions?tab=payments","/admin/records?tab=reschedules","/admin/transactions?tab=ledger"]) assert.ok(dialog.querySelector('a[href="'+path+'"]'));
    await click(dialog.querySelector('input[type="checkbox"]'));await click(button(dialog,"Mark guest checked in"));
    assert.deepEqual(h.calls,[{url:"/api/admin/reservations/check-in",body:{reservationId:id,arrivalConfirmed:true}}]);
    assert.match(dialog.textContent,/Checked in:/);assert.doesNotMatch(dialog.textContent,/Today: not checked in/);
    assert.match(dialog.textContent,/Unpaid balance/);assert.equal(button(dialog,"Mark guest checked in"),undefined);
  }finally{await h.close();}
});
test("staff with view permission can inspect flags but cannot create, check in or follow restricted module links",async()=>{
  const h=await mount({role:"staff",permissions:["reservations"]});
  try {
    assert.equal(button(h.c,"New reservation"),undefined);
    await click([...agenda().querySelectorAll("button")].find(el=>el.textContent.includes("MV-CONFIRMED")));
    const dialog=document.querySelector('[role="dialog"]');assert.equal(button(dialog,"Mark guest checked in"),undefined);
    assert.equal(dialog.querySelectorAll("a").length,0);assert.match(dialog.textContent,/Today: not checked in/);
  }finally{await h.close();}
});
test("failed financial flag reads show an error and retry rather than claiming there is nothing to review",async()=>{
  const h=await mount({failure:"refund_requests"});
  try {assert.match(h.c.querySelector('[role="alert"]').textContent,/Unable to load payment, reschedule, refund or balance flags/);assert.ok(button(h.c,"Retry calendar"));}
  finally{await h.close();}
});

async function filter(c,next,selector = '[aria-label="Filter calendar entries"]') {
  const select=c.querySelector(selector);
  await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,"value").set.call(select,next);select.dispatchEvent(new window.Event("change",{bubbles:true}));});
}
async function input(el,next) {
  assert.ok(el);
  await act(async()=>{Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,"value").set.call(el,next);el.dispatchEvent(new window.Event("input",{bubbles:true}));el.dispatchEvent(new window.Event("change",{bubbles:true}));});
}
test("mobile Week, Month and Agenda controls navigate their own periods and desktop retains the compact month grid",async()=>{
  const h=await mount();
  try {
    const desktop=h.c.querySelector('[aria-label="Desktop reservation calendar"]');assert.ok(desktop);assert.match(desktop.className,/hidden.*md:block/);
    assert.ok(desktop.querySelector('.grid-cols-7'));assert.match(desktop.textContent,/Day|Night|Fully booked/);
    assert.match(h.c.querySelector('[aria-label="Mobile reservation calendar"]').className,/md:hidden/);
    assert.equal(button(h.c,"Month").getAttribute("aria-pressed"),"true");
    assert.match(agenda().textContent,/MV-CONFIRMED/);
    await click(button(h.c,"Week"));assert.equal(button(h.c,"Week").getAttribute("aria-pressed"),"true");assert.match(agenda().textContent,/MV-CONFIRMED/);
    // Overnight stays can occupy both weeks when today is Sunday.
    await click(h.c.querySelector('[aria-label="Next calendar period"]'));await click(h.c.querySelector('[aria-label="Next calendar period"]'));assert.doesNotMatch(agenda().textContent,/MV-CONFIRMED/);
    await click(h.c.querySelector('[aria-label="Previous calendar period"]'));await click(h.c.querySelector('[aria-label="Previous calendar period"]'));assert.match(agenda().textContent,/MV-CONFIRMED/);
    await click(button(h.c,"Agenda"));assert.equal(button(h.c,"Agenda").getAttribute("aria-pressed"),"true");
    await click(desktop.querySelector('[aria-label="View reservation details for '+day+'"]'));assert.match(document.querySelector('[role="dialog"]').textContent,/Reservation editor/);
  }finally{await h.close();}
});
test("server-verified manager access shows the maintenance action without another role lookup; saving refreshes its calendar entry",async()=>{
  const h=await mount({initialAccess:{role:"staff",permissions:["reservations","edit_reservation"]},failure:"staff_users"});
  try {
    assert.equal(h.tables.includes("staff_users"),false);
    await click(button(h.c,"Add maintenance block"));
    const dialog=document.querySelector('[role="dialog"]');assert.match(dialog.textContent,/Add maintenance block/);
    const inputs=dialog.querySelectorAll("input");await input(inputs[0],"Pool maintenance");await input(inputs[1],"Pool repairs");await input(inputs[2],day);await input(inputs[3],tomorrow);
    await act(async()=>dialog.querySelector("form").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true})));
    assert.equal(h.calls.length, 0);
    assert.match(document.querySelector('[role="alertdialog"]').textContent, /Pool maintenance.*Philippine time.*prevents new reservations/s);
    await click(button(document.querySelector('[role="alertdialog"]'), "Keep editing"));
    assert.equal(h.calls.length, 0); assert.equal(inputs[0].value, "Pool maintenance");
    await act(async()=>dialog.querySelector("form").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true})));
    await confirmMaintenanceIfOpen();
    assert.equal(document.querySelector('[role="dialog"]'),null);
    assert.deepEqual(h.calls,[{url:"/api/admin/maintenance-blocks",body:{name:"Pool maintenance",reason:"Pool repairs",startDate:day,endDate:tomorrow,startTime:"08:00",endTime:"17:00",allDay:false}}]);
    assert.match(agenda().textContent,/Pool maintenance/);assert.match(h.c.textContent,/Maintenance period blocked successfully/);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 160)); });
    assert.ok(agenda().querySelector('[data-calendar-event^="block:"].calendar-match-pulse'));
  }finally{await h.close();}
});
test("maintenance conflicts remain visible in the modal and staff cannot see an admin-only action",async()=>{
  const h=await mount({initialAccess:{role:"staff",permissions:["reservations","edit_reservation"]},blockFailure:true});
  try {
    await click(button(h.c,"Add maintenance block"));const dialog=document.querySelector('[role="dialog"]');const inputs=dialog.querySelectorAll("input");
    for (const [index,next] of ["Pool maintenance","Pool repairs",day,tomorrow].entries()) await input(inputs[index],next);
    await act(async()=>dialog.querySelector("form").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true})));
    await confirmMaintenanceIfOpen();
    assert.match(dialog.querySelector('[role="alert"]').textContent,/active reservation/);assert.ok(button(dialog,"Create maintenance block"));assert.equal(inputs[0].value,"Pool maintenance");assert.equal(inputs[1].value,"Pool repairs");
  }finally{await h.close();}
  const staff=await mount({initialAccess:{role:"staff",permissions:["reservations"]}});
  try{assert.equal(button(staff.c,"Add maintenance block"),undefined);assert.equal(button(staff.c,"New reservation"),undefined);}
  finally{await staff.close();}
});

test("a manager with payment approval permission can approve a proof inside the calendar without opening Transactions",async()=>{
 const h=await mount({initialAccess:{role:"staff",permissions:["reservations","payment_approval"]}});
 try {
  await click([...agenda().querySelectorAll("button")].find(el=>el.textContent.includes("MV-CONFIRMED")));
  const dialog=document.querySelector('[role="dialog"]');await click(button(dialog,"Review payment"));
  assert.equal(document.querySelectorAll('[role="dialog"]').length,1);
  assert.equal(button(dialog,"Approve").disabled,true);const image=dialog.querySelector("img");assert.ok(image);
  await act(async()=>image.dispatchEvent(new window.Event("load")));
  assert.equal(button(dialog,"Approve").disabled,true,"screening acknowledgement stays required");
  await click(dialog.querySelector('[aria-label="Review payment GCASH-REFERENCE"] input[type="checkbox"]'));
  await click(button(dialog,"Approve"));await click(button(dialog,"Confirm approval"));
  assert.deepEqual(h.calls,[{url:"/api/admin/payments/approve",body:{paymentId:"payment",screenshotReviewed:true}}]);
  assert.match(dialog.textContent,/Payment approved/);assert.match(dialog.textContent,/No payments awaiting review/);
 }finally{await h.close();}
});
test("calendar payment rejection requires a reason and sends it through the same guarded review endpoint",async()=>{
 const h=await mount({initialAccess:{role:"staff",permissions:["reservations","payment_approval"]}});
 try {
  await click([...agenda().querySelectorAll("button")].find(el=>el.textContent.includes("MV-CONFIRMED")));
  const dialog=document.querySelector('[role="dialog"]');await click(button(dialog,"Review payment"));await click(button(dialog,"Reject"));
  assert.equal(button(dialog,"Confirm rejection").disabled,true);
  const textarea=dialog.querySelector("textarea");assert.ok(textarea);
  await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set.call(textarea,"Incorrect receiving account");textarea.dispatchEvent(new window.Event("input",{bubbles:true}));});
  await click(button(dialog,"Confirm rejection"));
  assert.deepEqual(h.calls,[{url:"/api/admin/payments/reject",body:{paymentId:"payment",screenshotReviewed:false,rejectionReason:"Incorrect receiving account"}}]);
  assert.match(dialog.textContent,/Payment rejected/);
 }finally{await h.close();}
});

test("a committed calendar payment is reconciled after a follow-up error and is not offered for approval again",async()=>{
 const h=await mount({initialAccess:{role:"staff",permissions:["reservations","payment_approval"]},paymentFollowUpError:true});
 try {
  await click([...agenda().querySelectorAll("button")].find(el=>el.textContent.includes("MV-CONFIRMED")));const dialog=document.querySelector('[role="dialog"]');
  await click(button(dialog,"Review payment"));await act(async()=>dialog.querySelector("img").dispatchEvent(new window.Event("load")));
  await click(dialog.querySelector('[aria-label="Review payment GCASH-REFERENCE"] input[type="checkbox"]'));await click(button(dialog,"Approve"));await click(button(dialog,"Confirm approval"));
  assert.equal(h.calls.length,1);assert.match(dialog.querySelector('[role="alert"]').textContent,/payment is now verified/);assert.match(dialog.textContent,/No payments awaiting review/);assert.equal(button(dialog,"Review payment"),undefined);
 }finally{await h.close();}
});
test("checked-in reservations expose checkout only after full settlement and completion removes cancellation and schedule actions", async () => {
  for (const fullyPaid of [false, true]) {
    const h = await mount({ arrived: true, fullyPaid });
    try {
      await click([...agenda().querySelectorAll("button")].find(el => el.textContent.includes("MV-CONFIRMED")));
      const dialog = document.querySelector('[role="dialog"]');
      assert.equal(button(dialog, "Cancel reservation / review refund"), undefined);
      const checkout = button(dialog, "Check out and complete stay"); assert.ok(checkout); assert.equal(checkout.disabled, true);
      if (!fullyPaid) { assert.match(dialog.textContent, /Settle the remaining balance/); continue; }
      const confirmation = [...dialog.querySelectorAll("label")].find(label => label.textContent.includes("guest is checking out")).querySelector("input");
      await click(confirmation); await click(checkout);
      assert.equal(h.calls.filter(call => call.url.endsWith("/check-out")).length, 1);
      assert.match(dialog.textContent, /Checked out:.*Stay completed/); assert.equal(button(dialog, "Check out and complete stay"), undefined);
    } finally { await h.close(); }
  }
});

test("ocular visits have no approval controls and authorized staff can record attendance", async () => {
  const h = await mount({ role:"staff", permissions:["reservations", "ocular_approval"], includeOcular:true, ocularStatus:"confirmed" });
  try {
    await click([...agenda().querySelectorAll("button")].find(el => el.textContent.includes("MV-OCULAR")));
    const dialog = document.querySelector('[role="dialog"]');
    assert.equal(button(dialog, "Approve ocular visit"), undefined);
    assert.equal(button(dialog, "Reject ocular visit"), undefined);
    await click(button(dialog, "Mark as visited"));
    assert.equal(h.calls[0].url, "/api/admin/ocular-visits/complete");
    assert.match(dialog.textContent, /guest has visited/);
  } finally { await h.close(); }
});

test("only managers can cancel a confirmed ocular visit and the cancellation reason is required and displayed", async () => {
  for (const role of ["staff", "admin", "cashier"]) {
    const h = await mount({ role, permissions: ["reservations", "ocular_approval"], includeOcular: true, ocularStatus: "confirmed" });
    try {
      await click([...agenda().querySelectorAll("button")].find(el => el.textContent.includes("MV-OCULAR")));
      const dialog = document.querySelector('[role="dialog"]');
      const cancel = button(dialog, "Cancel ocular visit");
      if (role !== "staff") { assert.equal(cancel, undefined); continue; }
      assert.equal(cancel.disabled, true);
      await input(dialog.querySelector("textarea"), "The resort is closed for urgent repairs");
      await click(cancel);
      assert.equal(h.calls[0].url, "/api/admin/ocular-visits/cancel");
      assert.equal(h.calls[0].body.cancellationReason, "The resort is closed for urgent repairs");
      assert.match(dialog.textContent, /Cancellation reason: The resort is closed/);
      assert.equal(button(dialog, "Cancel ocular visit"), undefined);
    } finally { await h.close(); }
  }
});


test("new reservation creation navigates and scrolls to the calendar, pulses only its rows and shows success", async () => {
  const previous = window.HTMLElement.prototype.scrollIntoView, scrolled = [];
  window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.getAttribute("aria-label")); };
  const h = await mount({manualCreation:true});
  try {
    await filter(h.c, "completed", '[aria-label="Filter calendar by type or status"]');
    await click(button(h.c,"New reservation"));
    await click(button(h.c,"Create test booking"));
    await act(async () => new Promise(resolve => setTimeout(resolve, 160)));
    assert.ok(scrolled.includes("Full reservation calendar"));
    assert.ok(h.c.querySelector('[data-calendar-event^="created:"].calendar-match-pulse'));
    assert.equal(h.c.querySelector('[data-calendar-event^="11111111"].calendar-match-pulse'),null);
    assert.match(h.c.textContent,/Reservation MB-NEW created successfully/);
    assert.match(agenda().textContent,/MB-NEW/);
    assert.equal(h.c.querySelector('[aria-label="Filter calendar by type or status"]').value, "all");
  } finally { await h.close(); window.HTMLElement.prototype.scrollIntoView = previous; }
});


test("manager can type continuously into the real manual reservation form without losing focus", async () => {
  const h=await mount({realManual:true});
  try {
    await click(button(h.c,"New reservation"));
    const modal=document.querySelector('[aria-labelledby="manual-booking-title"]');
    assert.ok(modal);
    assert.equal(modal.parentElement,document.body,"manual entry must escape the calendar stacking context");
    assert.equal(h.c.contains(modal),false);
    assert.ok(document.activeElement===modal.querySelector('input[type="text"]'),"typing must start in the guest name field");
    for(const [label,text] of [["First name","Maria"],["Last name","Santos"],["Email (optional)","maria@example.com"],["Address","Taytay Rizal"]]) {
      const input=[...modal.querySelectorAll("label")].find(el=>el.textContent===label)?.querySelector("input");
      assert.ok(input,label); assert.equal(input.matches(":disabled"),false);
      await act(async()=>input.focus());
      let typed="";
      for(const character of text) {
        typed+=character;
        await act(async()=>{
          input.dispatchEvent(new window.KeyboardEvent("keydown",{key:character,bubbles:true,cancelable:true}));
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set.call(input,typed);
          input.dispatchEvent(new window.Event("input",{bubbles:true}));
        });
        assert.equal(input.value,typed);
        assert.ok(document.activeElement===input,`Focus must stay in ${label}`);
        assert.ok(input.isConnected);
      }
    }
  } finally {await h.close();}
});


test("a manager can mark an ended reservation No show from calendar details and sees the closed record immediately", async()=>{
  const h=await mount({fullyPaid:true,ended:true});
  try {
    const event=[...agenda().querySelectorAll("button")].find(node=>node.textContent.includes("MV-CONFIRMED"));
    await click(event);const dialog=document.querySelector('[role="dialog"]');
    const form=dialog.querySelector('[aria-label="Record a no-show"]');assert.ok(form);
    const field=form.querySelector("textarea");
    await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set.call(field,"Guest did not arrive before the stay ended");field.dispatchEvent(new window.Event("input",{bubbles:true}));});
    assert.equal(button(form,"Mark as No show").disabled,true);
    await click(form.querySelector('input[type="checkbox"]'));await click(button(form,"Mark as No show"));
    assert.deepEqual(h.calls,[{url:"/api/admin/reservations/no-show",body:{reservationId:id,reason:"Guest did not arrive before the stay ended",noShowConfirmed:true}}]);
    assert.match(dialog.textContent,/This reservation is closed/);assert.match(dialog.textContent,/Guest did not arrive before the stay ended/);
    assert.equal(button(dialog,"Cancel reservation / review refund"),undefined);assert.equal(dialog.querySelector('[aria-label="Record a no-show"]'),null);
    assert.match(agenda().textContent,/No Show/);
  }finally{await h.close();}
});
