import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { swimmingRoomCatalog, standardId, familyId } from "./helpers/swimming-rooms.mjs";
const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/booking/form" });
for (const key of ["window", "document", "HTMLElement", "Node"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const Selection = loadTsModule("components/booking/SwimmingRoomSelection.tsx").default;
const { swimmingRoomsQuote } = loadTsModule("lib/booking/swimming-rooms.ts");
const start = "2030-06-01T08:00:00+08:00", end = "2030-06-01T16:00:00+08:00";
async function mount(privateSwimming, catalog, initial = [], sessionHours = 8, guestCount = 30) {
  const end = new Date(Date.parse(start)+sessionHours*3600000).toISOString();
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let selections;
  function Form() {
    const [value, onChange] = useState(initial); selections=value;
    let quote=null,error="";
    try { quote=swimmingRoomsQuote(catalog,value,start,end,privateSwimming,guestCount); } catch(e) { error=e.message; }
    return createElement(Selection, { state: { catalog, loading: false, error, quote, refresh() {} }, value, onChange, start, end, privateSwimming, guestCount });
  }
  await act(async () => root.render(createElement(Form)));
  return { host, get selections(){return selections;}, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const button=(host,text)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text);
const click = element => act(async () => { assert.ok(element); assert.equal(element.disabled, false); element.click(); });
const field=(h,n,name)=>h.host.querySelector(`[aria-label="Additional room ${n} ${name}"]`);

test('public and private room durations accept custom hours and use configured extension rates',async()=>{
 for(const privateSwimming of [false,true]){
  const h=await mount(privateSwimming,swimmingRoomCatalog,[],6.5,5);
  try{
   await click(button(h.host,'Add room'));const duration=field(h,1,'duration');
   assert.equal(duration.tagName,'INPUT');assert.equal(duration.type,'number');assert.equal(duration.max,'6');assert.equal(duration.step,'1');
   assert.equal(duration.min,'3');assert.equal(Number(duration.value),3);assert.match(h.host.textContent,/Room total:.*300\.00/);
   await change(duration,4.5);assert.equal(Number(duration.value),3);
   await change(duration,5);assert.equal(h.selections[0].durationHours,5);
   assert.match(h.host.textContent,/Base accommodation \(3 hours\):.*300\.00/);
   assert.match(h.host.textContent,/Room extension \(2 billed hours at.*100\.00.*200\.00/);
   assert.match(h.host.textContent,/Room total:.*500\.00/);
   await change(duration,9);assert.equal(Number(duration.value),6);
   await change(duration,3);await click(h.host.querySelector('[aria-label="Use maximum room hours for additional room 1"]'));
   assert.equal(h.selections[0].durationHours,6);
   await change(duration,2);assert.match(h.host.querySelector('[role="alert"]').textContent,/minimum 3/);assert.equal(duration.validity.rangeUnderflow,true);assert.equal(button(h.host,'Add room').disabled,true);
   await change(duration,5);assert.equal(h.host.querySelector('[role="alert"]'),null);assert.match(h.host.textContent,/Room total:.*500\.00/);
  }finally{await h.close();}
 }
});

async function change(element,value) {
  await act(async()=>{
    const proto=element.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(element,String(value));
    element.dispatchEvent(new dom.window.Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));
  });
}
test('public and private swimming add independent room stays and configured extra guests',async()=>{
  for(const privateSwimming of [false,true]) {
    const h=await mount(privateSwimming,swimmingRoomCatalog);
    try {
      const capacity=()=>h.host.querySelector('[aria-label="Total room capacity"]');
      if(privateSwimming)assert.match(capacity().textContent,/up to 6 guests.*4 guests included/);else assert.equal(capacity(),null);
      await click(button(h.host,'Add room'));
      assert.match(capacity().textContent,new RegExp(`up to ${privateSwimming?9:3} guests.*${privateSwimming?6:2} guests included`));
      assert.equal(field(h,1,'duration').value,'3');assert.equal(field(h,1,'guests').max,'3');
      await change(field(h,1,'duration'),3);await change(field(h,1,'guests'),3);
      assert.match(h.host.textContent,/Extra guests \(1\):.*100\.00/);assert.match(h.host.textContent,/Room total:.*400\.00/);
      await click(button(h.host,'Add room'));
      await change(field(h,2,'type'),familyId);await change(field(h,2,'duration'),8);await change(field(h,2,'guests'),6);
      assert.equal(field(h,2,'guests').max,'6');assert.match(h.host.textContent,/Extra guests \(2\):.*300\.00/);
      assert.deepEqual(h.selections.map(r=>r.durationHours),[3,8]);
      assert.match(capacity().textContent,new RegExp(`up to ${privateSwimming?15:9} guests.*${privateSwimming?10:6} guests included`));
      await click(h.host.querySelector('[aria-label="Remove additional room 1"]'));
      assert.match(capacity().textContent,new RegExp(`up to ${privateSwimming?12:6} guests.*${privateSwimming?8:4} guests included`));
      assert.equal(field(h,1,'type').value,familyId);assert.equal(field(h,1,'guests').value,'6');
      if(privateSwimming)assert.match(h.host.textContent,/Two Standard rooms are included/);
    } finally {await h.close();}
  }
});

test('a five-guest booking caps a Family room at five and shares guest places across additional rooms',async()=>{
 for(const privateSwimming of [false,true]){
  const h=await mount(privateSwimming,swimmingRoomCatalog,[],8,5);
  try{
   await click(button(h.host,'Add room'));await change(field(h,1,'type'),familyId);
   assert.equal(field(h,1,'guests').max,'5');await change(field(h,1,'guests'),6);
   assert.equal(field(h,1,'guests').value,'5');assert.equal(h.selections[0].occupants,5);
   assert.equal(button(h.host,'Add room').disabled,true);
   await change(field(h,1,'guests'),4);await click(button(h.host,'Add room'));
   assert.equal(field(h,2,'guests').max,'1');await change(field(h,2,'guests'),2);assert.equal(field(h,2,'guests').value,'1');
   assert.equal(button(h.host,'Add room').disabled,true);
   await click(h.host.querySelector('[aria-label="Remove additional room 2"]'));assert.equal(field(h,1,'guests').max,'5');
  }finally{await h.close();}
 }
});

test('a saved draft exceeding booking guests is flagged until room counts are corrected',async()=>{
 const h=await mount(false,swimmingRoomCatalog,[{classificationId:familyId,quantity:1,pricingVersion:1,occupants:6,durationHours:8}],8,5);
 try{
  assert.match(h.host.querySelector('[role="alert"]').textContent,/cannot exceed/);assert.equal(field(h,1,'guests').max,'5');
  await change(field(h,1,'guests'),5);assert.equal(h.host.querySelector('[role="alert"]'),null);
 }finally{await h.close();}
});
test('additional room controls stop at available general inventory and release removed rooms',async()=>{
  const catalog={...swimmingRoomCatalog,classifications:swimmingRoomCatalog.classifications.slice(0,1),rooms:swimmingRoomCatalog.rooms.filter(r=>r.classification_id===standardId).slice(0,4)};
  const h=await mount(true,catalog);
  try {await click(button(h.host,'Add room'));await click(button(h.host,'Add room'));assert.equal(button(h.host,'Add room').disabled,true);
    await click(h.host.querySelector('[aria-label="Remove additional room 1"]'));assert.equal(button(h.host,'Add room').disabled,false);
  } finally {await h.close();}
});
test('legacy grouped room drafts become individual entries and retain the 20-room limit',async()=>{
  const rooms=Array.from({length:25},(_,n)=>({room_id:`room-${n}`,classification_id:standardId,unavailable:false,blocks:[]}));
  const h=await mount(false,{...swimmingRoomCatalog,rooms},[{classificationId:standardId,quantity:20,pricingVersion:1}]);
  try {assert.equal(h.selections.length,20);assert.ok(h.selections.every(r=>r.quantity===1&&r.durationHours===3));assert.equal(button(h.host,'Add room').disabled,true);
    await click(h.host.querySelector('[aria-label="Remove additional room 1"]'));assert.equal(button(h.host,'Add room').disabled,false);
  } finally {await h.close();}
});

test('room duration fields and full-stay shortcuts follow configured public and private stay limits',async()=>{
 for(const privateSwimming of [false,true]) for(const sessionHours of [2,3,5,6.5,8,12,22]) {
  const h=await mount(privateSwimming,swimmingRoomCatalog,[],sessionHours);
  try {
   if(sessionHours<3){assert.equal(button(h.host,'Add room').disabled,true);assert.match(h.host.textContent,/at least 3 hours/);continue;}
   await click(button(h.host,'Add room'));
   const duration=field(h,1,'duration');assert.equal(Number(duration.value),3);assert.equal(duration.min,'3');
   assert.equal(Number(duration.max),Math.floor(sessionHours));
   await click(h.host.querySelector('[aria-label="Use maximum room hours for additional room 1"]'));assert.equal(h.selections[0].durationHours,Math.floor(sessionHours));
   assert.match(h.host.textContent,/extensions must end by swimming checkout/);
  }finally{await h.close();}
 }
});
