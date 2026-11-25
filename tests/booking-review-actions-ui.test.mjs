import { LEGAL_POLICY_VERSION } from "./helpers/legal-policies.mjs";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement, useEffect } from "react";
import { create } from "zustand";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/booking/details" });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client"); after(() => dom.window.close());
const draft = { startDatetime: "2027-06-14T08:00:00+08:00", endDatetime: "2027-06-14T16:00:00+08:00", bookingMode: "day", unitId: "", adultCount: 4, childCount: 0,
  firstName: "Maria", lastName: "Cruz", email: "guest@example.com", phone: "09171234567", address: "Taytay", services: [], specialRequests: "", roomPrice: 7500, total: 7500, nights: 1, tax: 0, reservationId: "", reservationReference: "" };
async function mount(fetcher, saved = false, draftPatch = {}) {
  const original = globalThis.fetch; globalThis.fetch = fetcher;
  const store = create(set => ({ bookingDraft: { ...draft, ...draftPatch, ...(saved ? { reservationId: "reservation", reservationReference: "MV-SAVED" } : {}) },
    setBookingDraft: patch => set(state => ({ bookingDraft: { ...state.bookingDraft, ...patch } })) }));
  const Component = loadTsModule("app/booking/details/page.tsx", {
    "next/link": ({ href, children, ...props }) => createElement("a", { href, ...props }, children),
    "@/components/Navigation": () => null, "@/components/Footer": () => null,
    "@/lib/stores/booking-store": { useBookingStore: store },
    "@/components/legal/PolicyAgreement": function PolicyAgreementMock({ accepted, onChange, onPolicyVersion, onLegalVersion }) {
      useEffect(() => { onPolicyVersion(1); onLegalVersion?.(LEGAL_POLICY_VERSION); }, [onPolicyVersion,onLegalVersion]);
      return createElement("input", { type: "checkbox", "aria-label": "Accept terms", checked: accepted, onChange: event => onChange(event.target.checked) });
    },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component)));
  return { container, store, close: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = original; } };
}
const actions = container => container.querySelector('[aria-label="Booking actions"]');
const labels = container => [...actions(container).children].map(child => child.textContent.trim());
const click = el => act(async () => el.click());

test('private review shows package inclusions and paid extra rooms separately and sends them with the full quote',async()=>{
 const posts=[],rooms=[{classificationId:'standard',quantity:1,pricingVersion:1,name:'Standard Rooms',unitPrice:900}];
 const h=await mount(async(url,options)=>{posts.push({url,body:JSON.parse(options.body)});return Response.json({success:true,reservation:{id:'booking',totalAmount:8400}});},false,{swimmingRooms:rooms,total:8400,packageRates:legacyRates});
 try{
  assert.match(h.container.textContent,/2 Standard rooms included at no extra charge/);
  assert.match(h.container.textContent,/Additional Rooms.*Standard Rooms × 1.*900\.00 for the full swimming session/);
  assert.match(h.container.querySelector('[data-booking-guide="review-bill"]').textContent,/Private pool package.*7,500\.00.*Additional rooms.*900\.00.*Subtotal.*8,400\.00/);
  assert.match(h.container.textContent,/20% Down Payment:.*1,680\.00/);
  await click(h.container.querySelector('[aria-label="Accept terms"]'));await click(actions(h.container).querySelector('button'));
  assert.deepEqual(posts[0].body.swimmingRooms,rooms);assert.equal(posts[0].body.expectedTotal,8400);
 }finally{await h.close();}
});

test("room booking review saves room selections through the room API and then offers full payment", async () => {
  const posts=[];
  const h=await mount(async(url,options)=>{posts.push({url,body:JSON.parse(options.body)});return Response.json({success:true,reservation:{id:"room-reservation",referenceNumber:"RM-SAVED",totalAmount:270}});},false,
    {commercialType:"room_accommodation",unitId:"room-accommodation",roomRequestId:"room-request",roomSelections:[{classificationId:"standard",pricingVersion:1,occupants:2,name:"Standard Rooms",accommodation:300,additionalGuestCharge:0,includedCapacity:2}],adultCount:2,eligibleGuests:1,discountAmount:30,discountKind:"pwd_senior",roomPrice:300,total:270,endDatetime:"2027-06-14T11:00:00+08:00"});
  try{
    assert.deepEqual(labels(h.container),["Back to Booking Details","Save Booking"]);assert.doesNotMatch(h.container.textContent,/Down Payment/);
    assert.match(h.container.textContent,/Full Payment:.*₱270\.00/);
    assert.ok(h.container.querySelector('[aria-label="Applied PWD / senior discount"]'));
    await click(h.container.querySelector('[aria-label="Accept terms"]'));await click(actions(h.container).querySelector("button"));
    assert.equal(posts[0].url,"/api/reservations/rooms");assert.equal(posts[0].body.rooms.length,1);assert.equal(posts[0].body.durationHours,3);assert.equal(posts[0].body.eligibleGuests,1);
    assert.deepEqual(labels(h.container),["View Saved Bookings","Continue to Payment"]);assert.equal(h.store.getState().bookingDraft.downPayment,270);
  }finally{await h.close();}
});

test("booking review has exactly two actions and switches them only after a successful save", async () => {
  let finish, posts = 0;
  const h = await mount(async () => { posts++; return new Promise(resolve => { finish = () => resolve(Response.json({ success: true, reservation: { id: "reservation", referenceNumber: "MV-TEST", totalAmount: 7500, paymentDeadlineAt: "2027-06-14T01:00:00Z" } })); }); });
  try {
    assert.deepEqual(labels(h.container), ["Back to Edit", "Save Booking"]);
    assert.match(h.container.textContent,/20% Down Payment:/);
    assert.equal(actions(h.container).querySelector("a").getAttribute("href"), "/booking/form");
    const save = actions(h.container).querySelector("button"); assert.equal(save.disabled, true);
    await click(h.container.querySelector('[aria-label="Accept terms"]'));
    await act(async () => { save.click(); save.click(); }); assert.equal(posts, 1);
    assert.deepEqual(labels(h.container), ["Back to Edit", "Saving Booking..."]);
    assert.equal(actions(h.container).querySelector("a").getAttribute("aria-disabled"), "true");
    await act(async () => finish());
    assert.deepEqual(labels(h.container), ["Back to Home", "Continue to Payment"]);
    assert.deepEqual([...actions(h.container).querySelectorAll("a")].map(a => a.getAttribute("href")), ["/", "/booking/payment"]);
    const status = h.container.querySelector('[role="status"]'); assert.equal(status.nextElementSibling, actions(h.container));
    assert.match(status.textContent, /Booking saved successfully/); assert.match(status.textContent, /MV-TEST/); assert.match(status.textContent, /Submit payment by/);
    assert.equal(h.store.getState().bookingDraft.reservationId, "reservation"); assert.equal(actions(h.container).querySelector("button"), null);
  } finally { await h.close(); }
});

test("public swimming review saves adult/child eligibility and services through its API with full payment",async()=>{
  const posts=[];
  const date=new Date(Date.now()+86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
  const h=await mount(async(url,options)=>{posts.push({url,body:JSON.parse(options.body)});return Response.json({success:true,reservation:{id:'public-reservation',referenceNumber:'PS-SAVED',totalAmount:420}});},false,
    {commercialType:'public_swimming',unitId:'public-swimming',publicRequestId:'public-request',publicSwimmingType:{type_id:'day',name:'Day Public Swimming',pricing_version:1},adultCount:2,childCount:1,eligibleGuests:0,discountAmount:0,roomPrice:420,total:420,startDatetime:date+'T08:00:00+08:00',endDatetime:date+'T16:00:00+08:00'});
  try{
    assert.doesNotMatch(h.container.textContent,/Down Payment/);assert.match(h.container.textContent,/Public swimming admission/);
    assert.match(h.container.textContent,/Full Payment:.*₱420\.00/);
    await click(h.container.querySelector('[aria-label="Accept terms"]'));await click(actions(h.container).querySelector('button'));
    assert.equal(posts[0].url,'/api/reservations/public-swimming');assert.equal(posts[0].body.typeId,'day');assert.equal(posts[0].body.adultCount,2);assert.equal(posts[0].body.childCount,1);assert.equal(posts[0].body.eligibleGuests,0);
    assert.equal(h.store.getState().bookingDraft.downPayment,420);
    assert.doesNotMatch(h.container.textContent,/Down Payment/);assert.match(h.container.textContent,/Full Payment:.*₱420\.00/);
  }finally{await h.close();}
});

test("public review rejects a passed one-hour cutoff and dates outside the rolling window before posting",async()=>{
  for(const [start,message] of [[new Date(Date.now()+30*60000).toISOString(),/at least one hour/],[new Date(Date.now()+4*86400000).toISOString(),/today and the next two calendar days/]]){
    let posts=0;
    const h=await mount(async()=>{posts++;return Response.json({success:true});},false,{commercialType:'public_swimming',startDatetime:start,endDatetime:new Date(Date.parse(start)+8*3600000).toISOString()});
    try{
      await click(h.container.querySelector('[aria-label="Accept terms"]'));await click(actions(h.container).querySelector('button'));
      assert.equal(posts,0);assert.match(h.container.querySelector('[role="alert"]').textContent,message);
    }finally{await h.close();}
  }
});

test("failed saves retain the edit/save actions and show the retry error directly above them", async () => {
  let fail = true;
  const h = await mount(async () => fail ? Response.json({ message: "That date was just booked." }, { status: 409 }) : Response.json({ success: true, reservation: { id: "reservation" } }));
  try {
    await click(h.container.querySelector('[aria-label="Accept terms"]')); await click(actions(h.container).querySelector("button"));
    assert.deepEqual(labels(h.container), ["Back to Edit", "Save Booking"]);
    assert.match(h.container.querySelector('[role="alert"]').textContent, /date was just booked/);
    assert.equal(h.container.querySelector('[role="alert"]').nextElementSibling, actions(h.container));
    assert.equal(h.store.getState().bookingDraft.reservationId, "");
    fail = false; await click(actions(h.container).querySelector("button")); assert.deepEqual(labels(h.container), ["Back to Home", "Continue to Payment"]);
  } finally { await h.close(); }
});

test("reopening an already saved booking shows its confirmation and only home/payment actions", async () => {
  let posts = 0; const h = await mount(async () => { posts++; throw Error("No second reservation should be created"); }, true);
  try {
    assert.deepEqual(labels(h.container), ["Back to Home", "Continue to Payment"]);
    assert.match(h.container.querySelector('[role="status"]').textContent, /MV-SAVED/);
    assert.equal(h.container.querySelector('[aria-label="Accept terms"]'), null); assert.equal(posts, 0);
  } finally { await h.close(); }
});

test("booking review displays quantity line totals and submits the chosen quantity, including legacy drafts",async()=>{
  for(const quantity of [3,undefined]){
    const expected=quantity??1;let posted;
    const h=await mount(async(_url,options)=>{posted=JSON.parse(options.body);return Response.json({success:true,reservation:{id:"reservation"}});},false,
      {services:[{id:"mattress",name:"Extra mattress",price:500,...(quantity?{quantity}:{})}],total:7500+expected*500});
    try{
      assert.ok(h.container.textContent.includes(`Extra mattress × ${expected}`));assert.ok(h.container.textContent.includes((expected*500).toLocaleString("en-PH",{minimumFractionDigits:2})));
      await click(h.container.querySelector('[aria-label="Accept terms"]'));await click(actions(h.container).querySelector("button"));
      assert.deepEqual(posted.selectedServices,[{serviceId:"mattress",quantity:expected}]);
      assert.equal(posted.acceptedPoliciesVersion,LEGAL_POLICY_VERSION);
    }finally{await h.close();}
  }
});

test("booking review identifies rental hours and submits their billable count", async () => {
  let posted;
  const h = await mount(async (_url, options) => { posted = JSON.parse(options.body); return Response.json({ success: true, reservation: { id: "reservation" } }); }, false,
    { services: [{ id: "karaoke", name: "Karaoke", price: 200, quantity: 3, billingType: "duration" }], total: 8100 });
  try {
    assert.match(h.container.textContent, /Karaoke.*3 hours/);
    assert.match(h.container.textContent, /600\.00/);
    await click(h.container.querySelector('[aria-label="Accept terms"]')); await click(actions(h.container).querySelector("button"));
    assert.deepEqual(posted.selectedServices, [{ serviceId: "karaoke", quantity: 3 }]);
  } finally { await h.close(); }
});

test("full booking details show the promo separately from package and service charges before and after saving", async () => {
  for (const [promo, savings] of [
    [{code:"SAVE20",discount_type:"percent",discount_value:20},1500],
    [{code:"LESS500",discount_type:"fixed",discount_value:500},500],
  ]) {
    let posted;
    const total=8500-savings;
    const h=await mount(async (_url,options)=>{posted=JSON.parse(options.body);return Response.json({success:true,reservation:{id:"reservation",totalAmount:total}});},false,
      {promo,promoCode:promo.code,packageRates:legacyRates,services:[{id:"mattress",name:"Extra mattress",price:500,quantity:2}],subtotal:8500,total});
    try {
      const bill=h.container.querySelector('[data-booking-guide="review-bill"]');
      const summary=[...h.container.querySelectorAll("h3")].find(node=>node.textContent==="Quick Summary").parentElement;
      for (const section of [bill,summary]) {
        assert.match(section.querySelector('[aria-label="Applied promo discount"]').textContent,new RegExp(promo.code));
        assert.ok(section.textContent.includes(`-₱${savings.toLocaleString("en-PH",{minimumFractionDigits:2})}`));
        assert.ok(section.textContent.includes(total.toLocaleString("en-PH",{minimumFractionDigits:2})));
      }
      assert.match(bill.textContent,/Private pool package₱7,500\.00/);
      assert.match(bill.textContent,/Extra mattress.*1,000\.00/);assert.match(bill.textContent,/Subtotal₱8,500\.00/);
      const firstPayment=[...h.container.querySelectorAll("h3")].find(node=>node.textContent==="To Pay First").parentElement;
      assert.ok(firstPayment.textContent.includes((total*.2).toLocaleString("en-PH",{minimumFractionDigits:2})));
      await click(h.container.querySelector('[aria-label="Accept terms"]'));await click(actions(h.container).querySelector("button"));
      assert.equal(posted.promoCode,promo.code);
      assert.equal(h.container.querySelectorAll('[aria-label="Applied promo discount"]').length,2);
      assert.equal(h.store.getState().bookingDraft.total,total);
    } finally {await h.close();}
  }
});

test("a saved fully discounted booking shows its promo and zero payment; bookings without promos omit the row", async () => {
  const h=await mount(async()=>{throw Error("Saved bookings must not be recreated");},true,
    {promo:{code:"FREEPOOL",discount_type:"percent",discount_value:100},promoCode:"FREEPOOL",packageRates:legacyRates,total:0});
  try {
    const bill=h.container.querySelector('[data-booking-guide="review-bill"]');
    assert.match(bill.textContent,/Private pool package₱7,500\.00/);assert.match(bill.textContent,/FREEPOOL.*-₱7,500\.00/);
    assert.match(bill.textContent,/Total₱0\.00/);assert.deepEqual(labels(h.container),["Back to Home","Manage confirmed booking"]);
  } finally {await h.close();}
  const plain=await mount(async()=>Response.json({}));
  try {assert.equal(plain.container.querySelector('[aria-label="Applied promo discount"]'),null);}
  finally {await plain.close();}
});
