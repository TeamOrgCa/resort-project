import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import("react-dom/client");after(()=>dom.window.close());
const button=(c,label)=>[...c.querySelectorAll("button")].find(el=>el.textContent.trim()===label);
async function click(el){assert.ok(el);assert.equal(el.disabled,false);await act(async()=>el.click());}
async function input(el,value){await act(async()=>{const proto=el.tagName==="TEXTAREA"?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value").set.call(el,value);el.dispatchEvent(new window.Event("input",{bubbles:true}));});}

test("guest counts retain zero when cleared, accept native increments, and reject three digits and exponent syntax",async()=>{
 const Input=loadTsModule("components/ui/GuestCountInput.tsx").default;
 function Demo(){const [value,setValue]=useState(0);return createElement(Input,{value,onValueChange:setValue,min:0,max:99});}
 const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 try{
  await act(async()=>root.render(createElement(Demo)));const el=c.querySelector("input");
  await input(el,"12");assert.equal(el.value,"12");await input(el,"123");assert.equal(el.value,"12");
  await input(el,"");assert.equal(el.value,"0");await input(el,"1");assert.equal(el.value,"1");
  const event=new window.KeyboardEvent("keydown",{key:"e",bubbles:true,cancelable:true});el.dispatchEvent(event);assert.equal(event.defaultPrevented,true);
 }finally{await act(async()=>root.unmount());c.remove();}
});

test("booking and reschedule calendar disables dates beyond the inclusive maximum and stops next-month navigation",async()=>{
 const Calendar=loadTsModule("components/booking/BookingDateCalendar.tsx").default;
 const c=document.createElement("div");document.body.append(c);const root=createRoot(c);const selected=[];
 try{
  await act(async()=>root.render(createElement(Calendar,{value:"",initialDate:"2027-01-01",minDate:"2027-01-01",maxDate:"2027-01-10",onChange:value=>selected.push(value)})));
  assert.equal(c.querySelector('[data-date="2027-01-10"]').disabled,false);
  assert.equal(c.querySelector('[data-date="2027-01-11"]').disabled,true);
  assert.equal(c.querySelector('[aria-label="Next month"]').disabled,true);
  await click(c.querySelector('[data-date="2027-01-10"]'));assert.deepEqual(selected,["2027-01-10"]);
 }finally{await act(async()=>root.unmount());c.remove();}
});

test("a late-arriving advance limit never traps the calendar beyond its last allowed month",async()=>{
 const Calendar=loadTsModule("components/booking/BookingDateCalendar.tsx").default;
 function Demo({maxDate}){const[month,setMonth]=useState("2027-03");return createElement(Calendar,{value:"",minDate:"2027-01-01",visibleMonth:month,maxDate,onMonthChange:setMonth,onChange:()=>{}});}
 const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 try{
  await act(async()=>root.render(createElement(Demo)));
  for(let i=0;i<3;i++)await click(c.querySelector('[aria-label="Next month"]'));
  assert.ok(c.querySelector('[data-date="2027-06-01"]'));
  await act(async()=>root.render(createElement(Demo,{maxDate:"2027-02-10"})));
  for(const month of["05","04","03","02"]){
   assert.equal(c.querySelector('[aria-label="Next month"]').disabled,true);
   await click(c.querySelector('[aria-label="Previous month"]'));
   assert.ok(c.querySelector(`[data-date="2027-${month}-01"]`),"Previous month must work even when still beyond the maximum");
  }
  assert.equal(c.querySelector('[data-date="2027-02-10"]').disabled,false);
  assert.equal(c.querySelector('[data-date="2027-02-11"]').disabled,true);
 }finally{await act(async()=>root.unmount());c.remove();}
});

test("month loading, refresh and failed requests preserve the last known advance booking limit",async()=>{
 const Calendar=loadTsModule("components/booking/BookingDateCalendar.tsx").default;
 const {useBookingAvailability}=loadTsModule("lib/booking/use-booking-availability.ts");
 const original=globalThis.fetch;let fail=false;
 globalThis.fetch=async url=>{
  if(fail)return Response.json({message:"Offline"},{status:503});
  if(url.includes("month=2027-02"))return new Promise(()=>{});
  return Response.json({reservations:[],blockedDates:[],maxBookingDate:"2027-02-10"});
 };
 function Demo(){const[month,setMonth]=useState("2027-01");const availability=useBookingAvailability([month],true);return createElement("div",null,
  createElement(Calendar,{value:"",minDate:"2027-01-01",visibleMonth:month,maxDate:availability.maxBookingDate,onMonthChange:setMonth,onChange:()=>{}}),
  createElement("button",{onClick:availability.refresh},"Refresh"),createElement("output",null,availability.error));}
 const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 try{
  await act(async()=>root.render(createElement(Demo)));await click(c.querySelector('[aria-label="Next month"]'));
  assert.ok(c.querySelector('[data-date="2027-02-01"]'));assert.equal(c.querySelector('[aria-label="Next month"]').disabled,true,"Loading another month must not remove the limit");
  assert.equal(c.querySelector('[data-date="2027-02-11"]').disabled,true);
  fail=true;await click(button(c,"Refresh"));assert.match(c.querySelector("output").textContent,/Unable to load/);
  assert.equal(c.querySelector('[aria-label="Next month"]').disabled,true,"A refresh failure must retain the limit");
  await click(c.querySelector('[aria-label="Previous month"]'));assert.ok(c.querySelector('[data-date="2027-01-01"]'));
 }finally{await act(async()=>root.unmount());c.remove();globalThis.fetch=original;}
});

test("administrator reviews attached feedback and confirms approval through the dedicated endpoint",async()=>{
 const original=globalThis.fetch,posts=[];let approved=false;
 const review={review_id:"11111111-1111-4111-8111-111111111111",public_display_name:"Guest",overall_rating:5,title:"Our pool photo",review_text:"We enjoyed our family stay and the beautiful pool.",created_at:"2026-11-18T01:00:00Z",updated_at:"2026-11-18T01:00:00Z",archived_at:null,is_approved:false,image_url:"https://example.com/review.png"};
 globalThis.fetch=async(url,options)=>{if(options?.method==="POST"){posts.push({url,body:JSON.parse(options.body)});approved=true;return Response.json({success:true,message:"Review published"});}return Response.json({success:true,rows:[{...review,is_approved:approved}],total:1,pageSize:10,canArchive:false,canModerate:true});};
 const Panel=loadTsModule("components/admin/GuestFeedbackPanel.tsx",{"next/image":({src,alt})=>createElement("img",{src,alt})}).default;
 const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 try{
  await act(async()=>root.render(createElement(Panel,{query:"period=Daily",revision:0,onChanged:()=>{}})));
  await click(button(c,"Approve review"));assert.equal(posts.length,0);
  await input(c.querySelector("textarea"),"Photo and content reviewed");assert.equal(button(c,"Confirm approval").disabled,true);
  await click(c.querySelector('input[type="checkbox"]'));await click(button(c,"Confirm approval"));
  assert.equal(posts[0].url,"/api/admin/analytics/feedback/moderate");assert.equal(posts[0].body.approve,true);assert.equal(posts[0].body.expectedUpdatedAt,review.updated_at);assert.match(c.textContent,/Published/);
 }finally{await act(async()=>root.unmount());c.remove();globalThis.fetch=original;}
});
