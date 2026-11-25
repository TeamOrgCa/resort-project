import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/rooms", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "Node"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const c = { classification_id: "11111111-1111-4111-8111-111111111111", code: "standard", name: "Standard Rooms", included_capacity: 2, maximum_capacity: 2, cleaning_buffer_minutes: 60, rate_3_hours: 300, rate_12_hours: 900, pricing_version: 4, extension_hourly_rate: 150, additional_guest_rate: 0, base_rate: 900, base_hours: 12 };
const room = { room_id: c.classification_id, classification_id: c.classification_id, room_number: "S01", classification: c, is_active: true, status: "vacant", upcoming: [], maintenance: [], current: null };
async function change(el, value) {
  assert.ok(el);
  await act(async () => {
    const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,"value").set.call(el,String(value));
    el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input",{bubbles:true}));
  });
}
const button = label => [...document.querySelectorAll("button")].find(e => e.textContent.trim() === label);
async function click(el) { assert.ok(el); assert.equal(el.disabled,false); await act(async () => el.click()); }
const field = label => [...document.querySelectorAll("label")].find(e => e.textContent.startsWith(label))?.querySelector("input,select");
async function mount(file, props, fetcher, mocks = {}) {
  const saved = globalThis.fetch; globalThis.fetch = fetcher;
  const Component = loadTsModule(file,mocks).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component,props)));
  return { container, close: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch=saved; } };
}
test('staff room reservation choices exclude the protected pair and transfers admit only private pool packages',async()=>{
  const dedicated={...room,room_id:'dedicated',room_number:'S01',private_swimming_only:true};
  const general={...room,room_id:'general',room_number:'S03'};
  const props={rooms:[dedicated,general],classifications:[c],now:Date.now(),onClose(){},onSaved(){}};
  const h=await mount('components/admin/rooms/RoomActionDialog.tsx',{...props,action:'reserve',initialRoomId:dedicated.room_id},async()=>Response.json({}));
  try{
    const choices=field('Room');assert.equal(choices.value,'general');
    assert.equal(choices.querySelector('option[value="dedicated"]'),null);
    assert.match(h.container.textContent,/dedicated to private swimming packages are excluded/);
  }finally{await h.close();}
  for(const [commercial_type,room_pricing,allowed] of [['public_swimming',false,false],['room_accommodation',true,false],['private_swimming',true,false],['private_swimming',false,true]]){
    const source={...general,current:{assignment_id:'active',expected_checkout:'2030-01-01T06:00:00Z',reservation:{commercial_type,room_pricing}}};
    const transfer=await mount('components/admin/rooms/RoomActionDialog.tsx',{...props,rooms:[dedicated,source],action:'transfer',initialRoomId:source.room_id},async()=>Response.json({}));
    try{assert.equal(!!field('Replacement room').querySelector('option[value="dedicated"]'),allowed,commercial_type+' '+room_pricing);}
    finally{await transfer.close();}
  }
});

test("walk-in duration, extension and non-stacking discount preview match the confirmed server payload",async()=>{
  const posts=[], saved=[];
  const h=await mount("components/admin/rooms/RoomActionDialog.tsx",{action:"reserve",rooms:[room],classifications:[c],initialRoomId:room.room_id,now:Date.parse("2030-01-01T00:00:00Z"),canDiscount:true,onClose(){},onSaved:message=>saved.push(message)},async(url,options)=>{
    if(url==="/api/promos/quote")return Response.json({promo:{code:"ROOM20",discount_type:"percent",discount_value:20}});
    posts.push(JSON.parse(options.body));return Response.json({success:true,result:{reference_number:"RM-TEST"}});
  });
  try{
    assert.match(field("Accommodation duration").textContent,/3 hours.*300\.00.*12 hours.*900\.00/);
    await change(field("Accommodation duration"),12); await change(field("Additional extension hours"),2);
    await change(field("Occupants"),2);await change(field("Verified PWD / senior"),1);
    await change(field("Promo / voucher code"),"ROOM20");await click(button("Apply code"));
    const quote=document.querySelector('[aria-label="Room price quote"]');
    assert.match(quote.textContent,/PWD \/ senior discount candidate.*90\.00/);
    assert.match(quote.textContent,/Applied discount \(larger only\).*180\.00/);
    assert.match(quote.textContent,/Total to bill.*1,020\.00/);
    for(const [label,value]of [["Guest first name","Real"],["Guest last name","Guest"],["Philippine mobile number","09171234567"],["Guest address","Guest address"],["Eligibility verification","Verified senior ID"]])await change(field(label),value);
    await act(async()=>document.querySelector("form").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true})));
    assert.equal(posts.length,0); // Reviewing never creates a booking.
    await click(button("Create reservation"));
    assert.equal(posts.length,1); const input=posts[0].input;
    assert.equal(input.duration_hours,12);assert.equal(input.extension_hours,2);assert.equal(input.pricing_version,4);
    assert.equal(input.expected_total,1020);assert.equal(input.eligible_guests,1);assert.equal(input.promo_code,"ROOM20");
    assert.equal(Date.parse(input.ends_at)-Date.parse(input.starts_at),14*3600000);assert.equal(saved.length,1);
  }finally{await h.close();}
});

test("walk-in sends one request on final confirmation and shows pending and slow-server feedback", async () => {
  const saved = [], posts = [];
  let resolveRequest;
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let slowTimer;
  globalThis.setTimeout = (callback, ms, ...args) => ms === 8000 ? (slowTimer = callback, -8000) : originalSet(callback, ms, ...args);
  globalThis.clearTimeout = timer => { if (timer !== -8000) originalClear(timer); };
  const h = await mount("components/admin/rooms/RoomActionDialog.tsx", { action: "reserve", rooms: [room], classifications: [c], initialRoomId: room.room_id, now: Date.now(), onClose() {}, onSaved: message => saved.push(message) }, async (url, options) => {
    posts.push({ url, options }); return new Promise(resolve => { resolveRequest = resolve; });
  });
  try {
    await act(async () => document.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(posts.length, 0);
    const create = button("Create reservation");
    await act(async () => { create.click(); create.click(); });
    assert.equal(posts.length, 1); assert.equal(posts[0].url, "/api/admin/rooms"); assert.equal(posts[0].options.method, "POST");
    assert.match(document.querySelector('[role="alertdialog"]').textContent, /Your request has been sent/);
    assert.equal(button("Creating reservation...").disabled, true);
    await act(async () => slowTimer());
    assert.match(document.querySelector('[role="alertdialog"]').textContent, /server is taking longer/);
    await act(async () => resolveRequest(Response.json({ success: true, result: { reference_number: "RM-REAL" } })));
    assert.equal(saved.length, 1);
  } finally { await h.close(); globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});

test("an unanswered walk-in request leaves loading, blocks duplicate submission and offers refresh", async () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let expire, refreshed = 0, calls = 0, signal, saved = 0;
  globalThis.setTimeout = (callback, ms, ...args) => ms === 30000 ? (expire = callback, -30000) : originalSet(callback, ms, ...args);
  globalThis.clearTimeout = timer => { if (timer !== -30000) originalClear(timer); };
  const h = await mount("components/admin/rooms/RoomActionDialog.tsx", { action: "reserve", rooms: [room], classifications: [c], initialRoomId: room.room_id, now: Date.now(), onClose() {}, onUnconfirmed: () => refreshed++, onSaved: () => saved++ }, async (_url, options) => {
    calls++; signal = options.signal; return new Promise(() => {});
  });
  try {
    await act(async () => document.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    await click(button("Create reservation"));
    await act(async () => expire());
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    assert.match(document.querySelector('[role="alert"]').textContent, /may have completed/);
    assert.equal(signal.aborted, true); assert.equal(saved, 0); assert.equal(calls, 1);
    assert.equal(button("Review & Confirm").disabled, true);
    await click(button("Close & refresh rooms")); assert.equal(refreshed, 1);
  } finally { await h.close(); globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});
test("staff without discount permission receive stay rates without eligibility or promo controls",async()=>{
  const h=await mount("components/admin/rooms/RoomActionDialog.tsx",{action:"reserve",rooms:[room],classifications:[c],initialRoomId:room.room_id,now:Date.now(),canDiscount:false,onClose(){},onSaved(){}},async()=>Response.json({}));
  try{assert.equal(field("Verified PWD / senior"),undefined);assert.equal(document.querySelector('[aria-label="Promo code"]'),null);assert.ok(field("Accommodation duration"));}finally{await h.close();}
});
test("Business Catalog publishes room prices with the loaded version and reflects saved rates",async()=>{
  const posts=[];
  const h=await mount("components/admin/catalog/RoomRatesEditor.tsx",{},async(_url,options)=>{
    if(!options?.method)return Response.json({classifications:[c]});
    const body=JSON.parse(options.body);posts.push(body);return Response.json({classification:{...c,...body.rates,pricing_version:5},message:"Room rates saved."});
  },{"@/components/ui/use-action-confirmation":{useActionConfirmation:()=>({confirm:async()=>true,confirmation:null})}});
  try{
    await change(field("3-hour accommodation"),350);await click(button("Save Standard Rooms rates"));
    assert.deepEqual(posts[0],{classificationId:c.classification_id,expectedVersion:4,rates:{rate_3_hours:350,rate_12_hours:900,extension_hourly_rate:150,additional_guest_rate:0}});
    assert.match(h.container.textContent,/Room rates saved/);assert.equal(button("Save Standard Rooms rates").disabled,true);
  }finally{await h.close();}
});
