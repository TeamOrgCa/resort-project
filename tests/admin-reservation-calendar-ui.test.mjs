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
async function mount({ role = "admin", permissions = [], failure = null, initialAccess, blockFailure = false, paymentFollowUpError = false, fullyPaid = false, arrived = false, includeOcular = false } = {}) {
  const saved = globalThis.fetch, calls = [], blocks = [];
  const data = {
    reservations: [{ ...base, reservation_id: id, reference_number: "MV-CONFIRMED", status: "confirmed" }, { ...base, reservation_id: "pending", reference_number: "MV-PENDING", status: "payment_submitted" }, { ...base, reservation_id: "cancelled", reference_number: "MV-CANCELLED", status: "cancelled" }],
    payments: [{ payment_id: "payment", reservation_id: id, reference_number: "GCASH-REFERENCE", amount:100, payment_type:"additional", account_name:"Guest", account_number:"09171234567", receipt_paid_at:day+"T08:00:00+08:00", paid_at:day+"T08:01:00+08:00", proof_path:"guest/receipt.png",status:"pending",ocr_status:"consistent",ocr_notes:null }], reservation_reschedules: [{ reservation_id: id, status:"pending" }], refund_requests: [{ reservation_id: "cancelled" }],
    transactions: [{ reservation_id: id, balance: 500 }, { reservation_id: "pending", balance: 1000 }, { reservation_id: "cancelled", balance: 3000 }],
    guests: [{ id: "guest", first_name: "Test", last_name: "Guest", email: "guest@example.com" }],
    staff_users: { role, is_active: true }, role_permissions: { permissions }, ocular_visits: [], walk_in_guests: [],
  };
  if (arrived) data.reservations[0].checked_in_at = new Date().toISOString();
  if (fullyPaid) { data.payments = []; data.reservation_reschedules = []; data.transactions[0].balance = 0; }
  if (includeOcular) data.ocular_visits = [{ visit_id:"ocular",reference_number:"MV-OCULAR",guest_id:"guest",scheduled_date:day,status:"pending" }];
  const tables = [];
  const client = { storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:"https://example.com/proof.png"},error:null})})}, auth: { getUser: async () => ({ data: { user: { id: "staff" } } }) }, from(table) {
    tables.push(table);
    const filters=[];
    const result = () => ({ data: Array.isArray(data[table]) ? data[table].filter(row=>filters.every(fn=>fn(row))) : data[table] ?? [], error: table === failure ? { message: "Read failed" } : null });
    const q = { select:()=>q,neq:()=>q,lt:()=>q,gt:()=>q,order:()=>q,limit:()=>q,gte:()=>q,in:()=>q,eq:(key,value)=>{filters.push(row=>row[key]===value);return q;},maybeSingle:async()=>{const r=result();return {...r,data:Array.isArray(r.data)?r.data[0]??null:r.data};},then:(yes,no)=>Promise.resolve(result()).then(yes,no) }; return q;
  } };
  globalThis.fetch = async (url, options) => {
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
      data.ocular_visits[0] = {...data.ocular_visits[0],status:url.endsWith("approve")?"confirmed":"rejected",review_reason:body.reviewReason};
      return Response.json({success:true,message:"Ocular decision saved.",visit:data.ocular_visits[0]});
    }
    if (url.endsWith("/check-out")) {
      calls.push({url,body:JSON.parse(options.body)});data.reservations[0].status="completed";data.reservations[0].checked_out_at=new Date().toISOString();
      return Response.json({success:true,reservation:data.reservations[0],message:"Stay completed."});
    }
    calls.push({ url, body: JSON.parse(options.body) }); data.reservations[0].checked_in_at = new Date().toISOString();
    return Response.json({ success: true });
  };
  const Component = loadTsModule("components/admin/ReservationCalendar.tsx", {
    "@/lib/supabase/client": { createClient:()=>client },
    "@/components/admin/ManualBookingDialog": { __esModule: true, default:()=>null },
    "@/components/admin/ReservationEditor": { __esModule: true, default:()=>createElement("p",null,"Reservation editor") },
    "next/image":{__esModule:true,default:({src,alt,onLoad,onError})=>createElement("img",{src,alt,onLoad,onError})},
    "next/link": { __esModule: true, default: ({ children, ...props }) => createElement("a", props, children) },
  }).default;
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

async function filter(c,next) {
  const select=c.querySelector('[aria-label="Filter calendar entries"]');
  await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,"value").set.call(select,next);select.dispatchEvent(new window.Event("change",{bubbles:true}));});
}
async function input(el,next) {
  assert.ok(el);
  await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set.call(el,next);el.dispatchEvent(new window.Event("input",{bubbles:true}));el.dispatchEvent(new window.Event("change",{bubbles:true}));});
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
    await click(h.c.querySelector('[aria-label="Next calendar period"]'));assert.doesNotMatch(agenda().textContent,/MV-CONFIRMED/);
    await click(h.c.querySelector('[aria-label="Previous calendar period"]'));assert.match(agenda().textContent,/MV-CONFIRMED/);
    await click(button(h.c,"Agenda"));assert.equal(button(h.c,"Agenda").getAttribute("aria-pressed"),"true");
    await click(desktop.querySelector('[aria-label="View reservation details for '+day+'"]'));assert.match(document.querySelector('[role="dialog"]').textContent,/Reservation editor/);
  }finally{await h.close();}
});
test("server-verified admin access shows the maintenance action without another role lookup; saving refreshes its calendar entry",async()=>{
  const h=await mount({initialAccess:{role:"admin",permissions:[]},failure:"staff_users"});
  try {
    assert.equal(h.tables.includes("staff_users"),false);
    await click(button(h.c,"Add maintenance block"));
    const dialog=document.querySelector('[role="dialog"]');assert.match(dialog.textContent,/Add maintenance block/);
    const inputs=dialog.querySelectorAll("input");await input(inputs[0],"Pool maintenance");await input(inputs[1],"Pool repairs");await input(inputs[2],day);await input(inputs[3],tomorrow);
    await act(async()=>dialog.querySelector("form").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true})));
    assert.equal(document.querySelector('[role="dialog"]'),null);
    assert.deepEqual(h.calls,[{url:"/api/admin/maintenance-blocks",body:{name:"Pool maintenance",reason:"Pool repairs",startDate:day,endDate:tomorrow}}]);
    assert.match(agenda().textContent,/Pool maintenance/);assert.match(h.c.textContent,/Dates blocked and guest alerts created/);
  }finally{await h.close();}
});
test("maintenance conflicts remain visible in the modal and staff cannot see an admin-only action",async()=>{
  const h=await mount({initialAccess:{role:"admin",permissions:[]},blockFailure:true});
  try {
    await click(button(h.c,"Add maintenance block"));const dialog=document.querySelector('[role="dialog"]');const inputs=dialog.querySelectorAll("input");
    for (const [index,next] of ["Pool maintenance","Pool repairs",day,tomorrow].entries()) await input(inputs[index],next);
    await act(async()=>dialog.querySelector("form").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true})));
    assert.match(dialog.querySelector('[role="alert"]').textContent,/active reservation/);assert.ok(button(dialog,"Block dates and alert guests"));
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

test("authorized managers can approve or reject an ocular request in the calendar only with a documented reason", async () => {
  for (const action of ["Approve", "Reject"]) {
    const h = await mount({ role:"staff", permissions:["reservations", "ocular_approval"], includeOcular:true });
    try {
      await click([...agenda().querySelectorAll("button")].find(el => el.textContent.includes("MV-OCULAR")));
      const dialog = document.querySelector('[role="dialog"]'); const control = button(dialog, `${action} ocular visit`);
      assert.ok(control); assert.equal(control.disabled, true);
      await act(async () => { const text = dialog.querySelector("textarea"); Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set.call(text,"Requested date was reviewed"); text.dispatchEvent(new window.Event("input",{bubbles:true})); });
      await click(control); assert.equal(h.calls[0].url, `/api/admin/ocular-visits/${action.toLowerCase()}`);
      assert.equal(h.calls[0].body.reviewReason, "Requested date was reviewed"); assert.match(dialog.textContent, /Review reason: Requested date was reviewed/);
      assert.equal(button(dialog, "Approve ocular visit"), undefined);
    } finally { await h.close(); }
  }
});
