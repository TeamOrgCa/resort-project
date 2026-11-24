import test,{after}from"node:test";
import assert from"node:assert/strict";
import{JSDOM}from"jsdom";
import{act,createElement}from"react";
import{create}from"zustand";
import{loadTsModule}from"./helpers/load-ts-module.mjs";
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/booking/form",pretendToBeVisual:true});
for(const k of["window","document","HTMLElement","Node"])globalThis[k]=dom.window[k];globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const{createRoot}=await import("react-dom/client");after(()=>dom.window.close());
const base={rate_3_hours:300,rate_12_hours:900,pricing_version:1,included_capacity:2,maximum_capacity:2,additional_guest_rate:100};
const classes=[{...base,classification_id:"standard",code:"standard",name:"Standard Rooms"},{...base,classification_id:"family",code:"family",name:"Family Rooms",included_capacity:4,maximum_capacity:6}];
const inventory={classifications:classes,services:[{service_id:"table",name:"Extra table",price:100,description:"Table rental",image_url:null,max_quantity:5,billing_type:"quantity"}],rooms:[...Array.from({length:2},(_,i)=>({room_id:`S${i}`,classification_id:"standard",unavailable:false,blocks:[]})),{room_id:"F01",classification_id:"family",unavailable:false,blocks:[]}]};
async function change(el,value){assert.ok(el);await act(async()=>{const proto=el.tagName==="SELECT"?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value").set.call(el,String(value));el.dispatchEvent(new window.Event(el.tagName==="SELECT"?"change":"input",{bubbles:true}));});}
const button=(c,text)=>[...c.querySelectorAll("button")].find(b=>b.textContent.trim()===text);
const click=el=>act(async()=>{assert.ok(el);assert.equal(el.disabled,false);el.click();});
async function mount(patch={}){
  const original=globalThis.fetch,calls=[],routes=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json(url==="/api/promos/quote"?{promo:{code:"ROOM20",discount_type:"percent",discount_value:20}}:{success:true,...inventory});};
  const start=new Date(Math.ceil((Date.now()+86400000)/1800000)*1800000).toISOString(),end=new Date(Date.parse(start)+3*3600000).toISOString();
  const store=create(set=>({bookingDraft:{commercialType:"room_accommodation",firstName:"",lastName:"",phone:"",email:"",address:"",services:[],roomSelections:[],eligibleGuests:0,specialRequests:"",startDatetime:start,endDatetime:end,...patch},setBookingDraft:d=>set(s=>({bookingDraft:{...s.bookingDraft,...d}}))}));
  const Component=loadTsModule("components/booking/RoomBookingForm.tsx",{
    "next/navigation":{useRouter:()=>({push:path=>routes.push(path)})},"next/link":({href,children,...p})=>createElement("a",{href,...p},children),
    "@/components/Navigation":()=>null,"@/components/Footer":()=>null,"@/lib/stores/booking-store":{useBookingStore:store},
    "@/components/ui/PhilippineAddressFields":({value})=>createElement("p",{"aria-label":"Prefilled address"},Object.values(value).join(", ")),
    "@/lib/supabase/client":{createClient:()=>({auth:{getUser:async()=>({data:{user:{id:"guest",email:"guest@example.com"}}})},from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{first_name:"Maria",last_name:"Cruz",phone_number:"+639171234567",address:"Street, City, Province, 1234"},error:null})};return q;}})},
  }).default;
  const c=document.createElement("div");document.body.append(c);const root=createRoot(c);await act(async()=>root.render(createElement(Component)));
  return{c,store,calls,routes,close:async()=>{await act(async()=>root.unmount());c.remove();globalThis.fetch=original;}};
}
test("customer room details prefill contacts, allow multiple rooms and services, and preserve only the winning discount for review",async()=>{
  const h=await mount();try{
    assert.equal([...h.c.querySelectorAll("label")].find(l=>l.textContent.startsWith("First name")).querySelector("input").value,"Maria");
    assert.match(h.c.querySelector('[aria-label="Prefilled address"]').textContent,/Province/);
    await click(button(h.c,"+ Add another room"));await change(h.c.querySelector('[aria-label="Room 2 type"]'),"family");
    await change(h.c.querySelector('[aria-label="Room 1 guests"]'),2);await change(h.c.querySelector('[aria-label="Room 2 guests"]'),4);
    const service=[...h.c.querySelectorAll('input[type="checkbox"]')][0];await click(service);
    await change(h.c.querySelector('[aria-label="PWD / senior guests"]'),3);
    await change(h.c.querySelector('[aria-label="Promo code"]'),"ROOM20");await click(button(h.c,"Apply code"));
    await act(async()=>h.c.querySelector("form").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true})));
    assert.deepEqual(h.routes,["/booking/details"]);const d=h.store.getState().bookingDraft;
    assert.equal(d.roomSelections.length,2);assert.equal(d.adultCount,6);assert.equal(d.eligibleGuests,3);assert.equal(d.discountAmount,120);assert.equal(d.discountKind,"promo");assert.equal(d.total,580);assert.equal(d.downPayment,580);
    assert.equal(d.phone,"+639171234567");assert.equal(d.commercialType,"room_accommodation");assert.ok(d.roomRequestId);assert.equal(d.services.length,1);
    assert.ok(!h.calls.some(c=>c.url.startsWith("/api/reservations/")));
  }finally{await h.close();}
});
test("returning to a saved room form preserves the booking instead of creating another reservation",async()=>{
  const h=await mount({reservationId:"saved",reservationReference:"RM-SAVED"});try{assert.equal(h.c.querySelector("form"),null);assert.match(h.c.textContent,/already saved as RM-SAVED/);assert.equal([...h.c.querySelectorAll("a")].find(a=>/View saved booking details/.test(a.textContent)).getAttribute("href"),"/booking/details");}finally{await h.close();}
});
