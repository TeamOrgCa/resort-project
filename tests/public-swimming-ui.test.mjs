import test,{after}from"node:test";
import assert from"node:assert/strict";
import{JSDOM}from"jsdom";
import{act,createElement}from"react";
import{create}from"zustand";
import{loadTsModule}from"./helpers/load-ts-module.mjs";
import { swimmingRoomCatalog, standardId } from './helpers/swimming-rooms.mjs';
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/booking",pretendToBeVisual:true});
for(const k of["window","document","HTMLElement","Node"])globalThis[k]=dom.window[k];globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const{createRoot}=await import("react-dom/client");after(()=>dom.window.close());
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'}),addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),date=addDays(today,1),third=addDays(today,2);
const type={type_id:'day',mode:'day',name:'Day Public Swimming',start_time:'08:00:00',end_time:'16:00:00',end_day_offset:0,adult_rate:150,child_rate:120,max_guests:100,pricing_version:1,is_active:true};
const slot={date,typeId:'day',startDatetime:date+'T08:00:00+08:00',endDatetime:date+'T16:00:00+08:00',remainingCapacity:100};
const catalog={types:[type,{...type,type_id:'night',mode:'night',name:'Night Public Swimming',start_time:'18:00:00',end_time:'23:00:00',adult_rate:200,child_rate:180}],dates:[today,date,third],slots:[slot],today,now:new Date().toISOString(),services:[{service_id:'videoke',name:'Videoke',price:100,description:'Hourly rental',image_url:null,max_quantity:24,billing_type:'duration'}]};
function monthCatalog(month=today.slice(0,7)){
 const [year,number]=month.split('-').map(Number),days=new Date(Date.UTC(year,number,0)).getUTCDate();
 const sessions=Array.from({length:days},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`).flatMap(day=>catalog.types.map(t=>({date:day,typeId:t.type_id,startDatetime:`${day}T${t.start_time}+08:00`,endDatetime:`${day}T${t.end_time}+08:00`,remainingCapacity:day===date?97:100,availability:day===third?'maintenance':day===date&&t.mode==='night'?'private':'available',eligibility:day<today?'past':day>third?'not_open':day===today?'cutoff':'eligible',opensAt:addDays(day,-2)+'T00:00:00+08:00'})));
 return {...catalog,sessions};
}
const click=el=>act(async()=>{assert.ok(el);assert.equal(el.disabled,false);el.click();});
async function change(el,value){assert.ok(el);await act(async()=>{const proto=el.tagName==='SELECT'?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,String(value));el.dispatchEvent(new window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});}

test('Public Only sessions remain bookable beyond three days and display their configured cutoff',async()=>{
 const oldFetch=globalThis.fetch,chosen=[],future=addDays(today,20);
 globalThis.fetch=async url=>{
   const data=monthCatalog(new URL(url,'http://localhost').searchParams.get('month')??today.slice(0,7));
   data.sessions=data.sessions.map(s=>s.date===future?{...s,accessMode:'public_only',availability:'available',eligibility:'eligible',cutoffAt:future+'T07:30:00+08:00'}:s);
   return Response.json({success:true,...data});
 };
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(createElement(loadTsModule('components/booking/PublicSwimmingSelection.tsx').default,{onChoose:(...args)=>chosen.push(args)})));
  if(future.slice(0,7)!==today.slice(0,7))await click(host.querySelector('[aria-label="Next month"]'));
  await click(host.querySelector(`[data-date="${future}"]`));await click(host.querySelector('[data-public-session="day"]'));
  assert.match(host.textContent,/Public Only/);assert.match(host.textContent,/Booking cutoff: 7:30 AM/);
  await click([...host.querySelectorAll('button')].find(b=>b.textContent==='Continue to Reservation'));
  assert.equal(chosen.length,1);assert.equal(chosen[0][1].date,future);
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=oldFetch;}
});
test('public calendar shows the entire month, permits inspection of unavailable dates and shows both independent sessions',async()=>{
 const oldFetch=globalThis.fetch,chosen=[],requests=[];globalThis.fetch=async url=>{requests.push(url);return Response.json({success:true,...monthCatalog(new URL(url,'http://localhost').searchParams.get('month')??today.slice(0,7))});};
 const Component=loadTsModule('components/booking/PublicSwimmingSelection.tsx').default,host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await act(async()=>root.render(createElement(Component,{onChoose:(...args)=>chosen.push(args)})));
   if(date.slice(0,7)!==today.slice(0,7))await click(host.querySelector('[aria-label="Next month"]'));
   assert.equal(host.querySelectorAll('[data-date]').length,new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7)),0)).getUTCDate());
   assert.equal(host.querySelector(`[data-date="${date}"]`)?.disabled,false);
   assert.match(host.querySelector(`[data-date="${date}"]`)?.textContent,/Partial/);
   assert.match(host.textContent,/Selected.*Fully booked \/ Unavailable.*Available/);
   const day=[...host.querySelectorAll('button')].find(b=>b.textContent.startsWith('Day Public Swimming'));assert.match(day.textContent,/8:00 AM.*4:00 PM/);
   assert.ok(host.querySelector('[data-booking-guide="public-times"]').compareDocumentPosition(host.querySelector('[data-booking-guide="dates-calendar"]')) & window.Node.DOCUMENT_POSITION_FOLLOWING);
   assert.equal([...host.querySelectorAll('button')].find(b=>b.textContent.startsWith('Night Public Swimming')).disabled,false);
   await click(day);assert.equal(host.querySelector('[data-booking-guide="dates-continue"]').disabled,true);
   await click(host.querySelector(`[data-date="${date}"]`));
   assert.match(host.querySelector('[data-public-session="day"]').textContent,/Available.*Remaining capacity: 97/);
   assert.match(host.querySelector('[data-public-session="night"]').textContent,/6:00 PM.*11:00 PM.*Unavailable — Private Reservation/);
   await click(host.querySelector('[data-public-session="night"]'));assert.equal(host.querySelector('[data-booking-guide="dates-continue"]').disabled,true);
   assert.equal(host.querySelector(`[data-date="${date}"]`).disabled,false);
   await click(host.querySelector('[data-public-session="day"]'));await click(host.querySelector('[data-booking-guide="dates-continue"]'));assert.equal(chosen.length,1);assert.equal(chosen[0][0].type_id,'day');
   await click(host.querySelector('[aria-label="Next month"]'));
   const future=host.querySelector('[data-date]');assert.equal(future.disabled,false);await click(future);
   assert.match(host.textContent,/Not Yet Open for Booking/);assert.match(host.textContent,/Reservations open.*Tentative availability.*Private reservations may still be made/);
   assert.equal(host.querySelector('[data-booking-guide="dates-continue"]').disabled,true);
   const inspected=future.dataset.date.slice(0,7);await act(async()=>window.dispatchEvent(new window.Event('focus')));
   assert.equal(host.querySelector('[data-date]').dataset.date.slice(0,7),inspected);
   assert.ok(requests.at(-1).includes('month='+inspected));
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=oldFetch;}
});
test('public details prefill contacts, preserve adult/child counts, cap rental hours and save one winning discount for review',async()=>{
 const oldFetch=globalThis.fetch,calls=[],routes=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json(url.startsWith('/api/booking/rooms?')?{success:true,...swimmingRoomCatalog}:url==='/api/promos/quote'?{promo:{code:'PUBLIC20',discount_type:'percent',discount_value:20}}:{success:true,...catalog});};
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
  assert.match(host.textContent,/Public admission does not include a room/);
  await change(host.querySelector('[aria-label="Extra Standard Rooms"]'),1);
  await act(async()=>host.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  assert.deepEqual(routes,['/booking/details']);const d=store.getState().bookingDraft;assert.equal(d.firstName,'Maria');assert.equal(d.lastName,'Cruz');assert.equal(d.phone,'+639171234567');assert.equal(d.address,'Street, City, Province, 1234');assert.equal(d.adultCount,2);assert.equal(d.childCount,1);assert.equal(d.discountAmount,84);assert.equal(d.total,1136);assert.equal(d.downPayment,1136);assert.equal(d.discountKind,'promo');assert.ok(d.publicRequestId);
  assert.equal(d.swimmingRooms[0].classificationId,standardId);assert.equal(d.swimmingRooms[0].unitPrice,600);assert.equal(d.subtotal,1220);
  assert.ok(!calls.some(c=>c.url.startsWith('/api/reservations/')));
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=oldFetch;}
});
