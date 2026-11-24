import test,{after}from"node:test";
import assert from"node:assert/strict";
import{JSDOM}from"jsdom";
import{act,createElement}from"react";
import{create}from"zustand";
import{loadTsModule}from"./helpers/load-ts-module.mjs";
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/booking",pretendToBeVisual:true});
for(const k of["window","document","HTMLElement","Node"])globalThis[k]=dom.window[k];globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const{createRoot}=await import("react-dom/client");after(()=>dom.window.close());
const date=new Date(Date.now()+86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Manila'}),third=new Date(Date.parse(date+'T00:00:00Z')+2*86400000).toISOString().slice(0,10);
const type={type_id:'day',mode:'day',name:'Day Public Swimming',start_time:'08:00:00',end_time:'16:00:00',end_day_offset:0,adult_rate:150,child_rate:120,max_guests:null,pricing_version:1,is_active:true};
const slot={date,typeId:'day',startDatetime:date+'T08:00:00+08:00',endDatetime:date+'T16:00:00+08:00',remainingCapacity:100};
const catalog={types:[type,{...type,type_id:'night',mode:'night',name:'Night Public Swimming',adult_rate:200,child_rate:180}],dates:[date,new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10),third],slots:[slot,{...slot,date:third,startDatetime:third+'T08:00:00+08:00',endDatetime:third+'T16:00:00+08:00'}],services:[{service_id:'videoke',name:'Videoke',price:100,description:'Hourly rental',image_url:null,max_quantity:24,billing_type:'duration'}]};
const click=el=>act(async()=>{assert.ok(el);assert.equal(el.disabled,false);el.click();});
async function change(el,value){assert.ok(el);await act(async()=>{const proto=el.tagName==='SELECT'?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,String(value));el.dispatchEvent(new window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
test('public date picker restricts the three consecutive dates and offers only available sessions in AM/PM',async()=>{
 const oldFetch=globalThis.fetch,chosen=[];globalThis.fetch=async()=>Response.json({success:true,...catalog});
 const Component=loadTsModule('components/booking/PublicSwimmingSelection.tsx').default,host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await act(async()=>root.render(createElement(Component,{onChoose:(...args)=>chosen.push(args)})));
   assert.equal(host.querySelector(`[data-date="${catalog.dates[1]}"]`)?.disabled,true);
   assert.match(host.querySelector(`[data-date="${date}"]`)?.textContent,/Day only/);
   assert.match(host.textContent,/Selected.*Fully booked \/ Unavailable.*Available/);
   const day=[...host.querySelectorAll('button')].find(b=>b.textContent.startsWith('Day Public Swimming'));assert.match(day.textContent,/8:00 AM.*4:00 PM/);
   assert.ok(host.querySelector('[data-booking-guide="public-times"]').compareDocumentPosition(host.querySelector('[data-booking-guide="dates-calendar"]')) & window.Node.DOCUMENT_POSITION_FOLLOWING);
   assert.equal([...host.querySelectorAll('button')].find(b=>b.textContent.startsWith('Night Public Swimming')).disabled,true);
   await click(day);assert.equal(host.querySelector('[data-booking-guide="dates-continue"]').disabled,true);
   await click(host.querySelector(`[data-date="${date}"]`));await click(host.querySelector('[data-booking-guide="dates-continue"]'));assert.equal(chosen.length,1);assert.equal(chosen[0][0].type_id,'day');
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=oldFetch;}
});
test('public details prefill contacts, preserve adult/child counts, cap rental hours and save one winning discount for review',async()=>{
 const oldFetch=globalThis.fetch,calls=[],routes=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json(url==='/api/promos/quote'?{promo:{code:'PUBLIC20',discount_type:'percent',discount_value:20}}:{success:true,...catalog});};
 const store=create(set=>({bookingDraft:{commercialType:'public_swimming',publicSwimmingType:type,...slot,firstName:'',lastName:'',email:'',phone:'',address:'',adultCount:1,childCount:0,services:[],eligibleGuests:0,specialRequests:''},setBookingDraft:d=>set(s=>({bookingDraft:{...s.bookingDraft,...d}}))}));
 const Component=loadTsModule('components/booking/PublicSwimmingForm.tsx',{
  'next/navigation':{useRouter:()=>({push:path=>routes.push(path)})},'next/link':({href,children,...p})=>createElement('a',{href,...p},children),
  '@/components/Navigation':()=>null,'@/components/Footer':()=>null,'@/lib/stores/booking-store':{useBookingStore:store},
  '@/components/ui/PhilippineAddressFields':({value})=>createElement('p',{'aria-label':'Prefilled address'},Object.values(value).join(', ')),
  '@/lib/supabase/client':{createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'guest',email:'guest@example.com'}}})},from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{first_name:'Maria',last_name:'Cruz',phone_number:'+639171234567',address:'Street, City, Province, 1234'},error:null})};return q;}})},
 }).default;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await act(async()=>root.render(createElement(Component)));
  assert.equal([...host.querySelectorAll('label')].find(l=>l.textContent.startsWith('First name')).querySelector('input').value,'Maria');
  await change(host.querySelector('[aria-label="Adults"]'),2);await change(host.querySelector('[aria-label="Children"]'),1);await change(host.querySelector('[aria-label="PWD / senior guests"]'),1);
  await click(host.querySelector('input[type="checkbox"]'));
  const hours=[...host.querySelectorAll('input[type="number"]')].find(i=>i.getAttribute('max')==='8');assert.ok(hours);await change(hours,2);
  await change(host.querySelector('[aria-label="Promo code"]'),'PUBLIC20');await click([...host.querySelectorAll('button')].find(b=>b.textContent==='Apply code'));
  await act(async()=>host.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  assert.deepEqual(routes,['/booking/details']);const d=store.getState().bookingDraft;assert.equal(d.firstName,'Maria');assert.equal(d.lastName,'Cruz');assert.equal(d.phone,'+639171234567');assert.equal(d.address,'Street, City, Province, 1234');assert.equal(d.adultCount,2);assert.equal(d.childCount,1);assert.equal(d.discountAmount,84);assert.equal(d.total,536);assert.equal(d.downPayment,536);assert.equal(d.discountKind,'promo');assert.ok(d.publicRequestId);
  assert.ok(!calls.some(c=>c.url.startsWith('/api/reservations/')));
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=oldFetch;}
});
