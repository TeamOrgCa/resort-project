import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/booking"});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import("react-dom/client");after(()=>dom.window.close());
test("customer calendar distinguishes maintenance closures from fully booked dates and preserves partial overnight availability",async()=>{
 const saved=globalThis.fetch;const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const [y,m]=today.split("-").map(Number);const month=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);
 globalThis.fetch=async url=>url.startsWith("/api/ocular-time-slots")?Response.json({slots:[]}):Response.json({reservations:[{start_datetime:month+"-06T08:00:00+08:00",end_datetime:month+"-07T06:00:00+08:00"}],blockedDates:[{start_date:month+"-05",end_date:month+"-05"},{start_date:month+"-08",end_date:month+"-08",start_datetime:month+"-08T13:00:00+08:00",end_datetime:month+"-08T14:00:00+08:00"}]});
 const q={select:()=>q,in:()=>q,then:(yes,no)=>Promise.resolve({data:[],error:null}).then(yes,no)};
 const Component=loadTsModule("app/booking/page.tsx",{
  "next/link":({children,href})=>createElement("a",{href},children),"next/image":({src,alt})=>createElement("img",{src,alt}),
  "next/navigation":{useRouter:()=>({push:()=>{}})},"@/components/Navigation":()=>null,"@/components/Footer":()=>null,
  "@/lib/booking/use-package-rates":{usePackageRates:()=>({schedule:{version:1,rates:legacyRates},error:null})},
  "@/lib/supabase/client":{createClient:()=>({from:()=>q})},
  "@/lib/stores/booking-store":{useBookingStore:selector=>selector({setBookingWindow:()=>{},resetBookingDraft:()=>{}})},
 }).default;
 const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 try {
  await act(async()=>root.render(createElement(Component)));
  await act(async()=>c.querySelector('[aria-label="Next month"]').click());
  const maintenance=c.querySelector('[aria-label="'+month+'-05: Closed for maintenance"]');assert.ok(maintenance);assert.equal(maintenance.disabled,true);assert.ok(maintenance.style.backgroundColor);assert.equal(maintenance.textContent.trim(),"5");assert.equal(maintenance.title,"Closed for maintenance");
  const booked=c.querySelector('[aria-label="'+month+'-06: Fully booked"]');assert.ok(booked);assert.equal(booked.disabled,true);assert.notEqual(booked.style.backgroundColor,maintenance.style.backgroundColor);
  const legend=[...c.querySelectorAll("span")].find(span=>span.textContent==="Closed for maintenance");assert.equal(legend.previousElementSibling.style.backgroundColor,maintenance.style.backgroundColor);
  const timed=c.querySelector('[aria-label^="'+month+'-08:"]');assert.equal(timed.disabled,true);assert.equal(timed.title,"Closed for maintenance");
  const partial=c.querySelector('[aria-label^="'+month+'-04:"]');assert.equal(partial.disabled,false);assert.match(partial.textContent,/Day only/);
  await act(async()=>partial.click());
  const mode=name=>[...c.querySelectorAll('button')].find(button=>button.querySelector('p')?.textContent===name);
  await act(async()=>mode('Night').click());
  assert.equal(c.querySelector('[aria-label^="'+month+'-08:"]').disabled,false);
  assert.equal(c.querySelector('[aria-label^="'+month+'-04:"]').disabled,true);
  const continueButton=[...c.querySelectorAll('button')].find(button=>/Continue/i.test(button.textContent));
  assert.equal(continueButton.disabled,true,"switching to a mode unavailable on the selected date clears the date");
  assert.match(c.textContent,/Showing dates available for Night/);
  assert.match(c.textContent,/Closed for maintenance/);
 }finally{await act(async()=>root.unmount());c.remove();globalThis.fetch=saved;}
});

test("selected Day, Night and both Whole Day variants disable only their own conflicting dates", async () => {
 const saved=globalThis.fetch;
 const {DEFAULT_PACKAGE_TIMES}=loadTsModule("lib/booking/package-times.ts");
 const times=structuredClone(DEFAULT_PACKAGE_TIMES);
 times.day={start:"08:00",end:"10:00",endDayOffset:0};times.night={start:"11:00",end:"13:00",endDayOffset:0};
 times.whole_day.day_to_night={start:"14:00",end:"16:00",endDayOffset:0};
 times.whole_day.night_to_day={start:"17:00",end:"19:00",endDayOffset:0};
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const [y,m]=today.split("-").map(Number),month=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7),date=month+"-05";
 globalThis.fetch=async url=>url.startsWith("/api/ocular-time-slots")?Response.json({slots:[]}):Response.json({reservations:[
  {start_datetime:date+"T08:00:00+08:00",end_datetime:date+"T10:00:00+08:00"},
  {start_datetime:date+"T11:00:00+08:00",end_datetime:date+"T13:00:00+08:00"},
  {start_datetime:month+"-06T11:00:00+08:00",end_datetime:month+"-06T13:00:00+08:00"},
  {start_datetime:month+"-06T14:00:00+08:00",end_datetime:month+"-06T16:00:00+08:00"},
  {start_datetime:month+"-07T08:00:00+08:00",end_datetime:month+"-07T10:00:00+08:00"},
  {start_datetime:month+"-07T17:00:00+08:00",end_datetime:month+"-07T19:00:00+08:00"}],blockedDates:[]});
 const q={select:()=>q,in:()=>q,then:(yes,no)=>Promise.resolve({data:[],error:null}).then(yes,no)};
 const selected=[];
 const Component=loadTsModule("app/booking/page.tsx",{
  "next/link":({children,href})=>createElement("a",{href},children),"next/image":({src,alt})=>createElement("img",{src,alt}),
  "next/navigation":{useRouter:()=>({push:()=>{}})},"@/components/Navigation":()=>null,"@/components/Footer":()=>null,
  "@/lib/booking/use-package-rates":{usePackageRates:()=>({schedule:{version:2,rates:legacyRates,times},error:null})},
  "@/lib/supabase/client":{createClient:()=>({from:()=>q})},
  "@/lib/stores/booking-store":{useBookingStore:selector=>selector({setBookingWindow:(...args)=>selected.push(args),setBookingDraft:()=>{},resetBookingDraft:()=>{}})},
 }).default;
 const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 try{
  await act(async()=>root.render(createElement(Component)));
  await act(async()=>c.querySelector('[aria-label="Next month"]').click());
  const mode=name=>[...c.querySelectorAll('button')].find(button=>button.querySelector('p')?.textContent===name);
  const day=key=>c.querySelector(`[aria-label^="${month}-${key}:"]`);
  assert.equal(day('05').disabled,true); assert.equal(day('06').disabled,false); assert.equal(day('07').disabled,true);
  await act(async()=>day('06').click());
  await act(async()=>mode('Night').click());
  assert.equal(day('05').disabled,true); assert.equal(day('06').disabled,true); assert.equal(day('07').disabled,false);
  await act(async()=>day('07').click());
  await act(async()=>mode('Whole-Day').click());
  assert.equal(day('05').disabled,false); assert.equal(day('06').disabled,true); assert.equal(day('07').disabled,false);
  await act(async()=>mode('Variant B').click());
  assert.equal(day('05').disabled,false); assert.equal(day('06').disabled,false); assert.equal(day('07').disabled,true);
  assert.equal(mode('Whole-Day').getAttribute('aria-pressed'),'true');
  await act(async()=>mode('Variant A').click());
  await act(async()=>day('05').click());
  const next=[...c.querySelectorAll("button")].find(button=>/Continue.*Booking|Continue.*Details|Book.*Stay|Continue/i.test(button.textContent));
  assert.ok(next);assert.equal(next.disabled,false);
  await act(async()=>next.click());
  assert.equal(selected[0][0],"whole_day");assert.equal(selected[0][1],date+"T06:00:00.000Z");
 }finally{await act(async()=>root.unmount());c.remove();globalThis.fetch=saved;}
});
