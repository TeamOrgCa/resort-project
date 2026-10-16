
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/admin/users",pretendToBeVisual:true});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import("react-dom/client");after(()=>dom.window.close());
const button=(c,text)=>[...c.querySelectorAll("button")].find(el=>el.textContent.trim()===text);
async function click(el){assert.ok(el);assert.equal(el.disabled,false);await act(async()=>el.click());}
async function value(el,next){const proto=el.tagName==="SELECT"?window.HTMLSelectElement.prototype:el.tagName==="TEXTAREA"?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;await act(async()=>{Object.getOwnPropertyDescriptor(proto,"value").set.call(el,next);el.dispatchEvent(new window.Event(el.tagName==="SELECT"?"change":"input",{bubbles:true}));});}
async function mount(fetcher){
  const saved=globalThis.fetch;globalThis.fetch=fetcher;const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
  const Component=loadTsModule("components/admin/users/GuestAccountsPanel.tsx").default;
  await act(async()=>root.render(createElement(Component)));
  return{container,close:async()=>{await act(async()=>root.unmount());container.remove();globalThis.fetch=saved;}};
}
const guest={id:"22222222-2222-4222-8222-222222222222",first_name:"Guest",last_name:"Tester",middle_name:null,email:"guest@example.com",phone_number:"09123456789",created_at:"2026-10-15T01:00:00Z",email_confirmed:true,is_active:true};
test("guest status changes require confirmation, show errors, audit the supplied reason and refresh the displayed status",async()=>{
  let active=true,fail=true;const writes=[];
  const h=await mount(async(_url,options)=>{
    if(options?.method==="PATCH"){const body=JSON.parse(options.body);writes.push(body);if(fail)return Response.json({success:false,message:"Status could not be saved"},{status:503});active=body.isActive;return Response.json({success:true,message:active?"Guest reactivated":"Guest deactivated"});}
    return Response.json({success:true,rows:[{...guest,is_active:active}],total:1});
  });
  try{
    await click(button(h.container,"Deactivate"));assert.equal(writes.length,0);assert.match(h.container.querySelector('[role="dialog"]').textContent,/reservations, payments and refunds remain recorded/);
    await click(button(h.container,"Cancel"));assert.equal(writes.length,0);
    await click(button(h.container,"Deactivate"));await value(h.container.querySelector("textarea"),"Repeated misuse of booking access");await click(button(h.container,"Confirm deactivation"));
    assert.match(h.container.querySelector('[role="alert"]').textContent,/could not be saved/);assert.ok(h.container.querySelector('[role="dialog"]'));fail=false;
    await click(button(h.container,"Confirm deactivation"));assert.deepEqual(writes[1],{isActive:false,expectedActive:true,reason:"Repeated misuse of booking access"});
    assert.equal(h.container.querySelector('[role="dialog"]'),null);assert.ok(button(h.container,"Reactivate"));assert.match(h.container.querySelector('[role="status"]').textContent,/deactivated/);
    await click(button(h.container,"Reactivate"));await click(button(h.container,"Confirm reactivation"));assert.ok(button(h.container,"Deactivate"));assert.equal(writes[2].isActive,true);
  }finally{await h.close();}
});
test("guest search filters as you type, debounces requests and resets pagination",async()=>{
  const calls=[];const h=await mount(async url=>{calls.push(url);return Response.json({success:true,rows:[guest],total:21});});
  try{
    assert.equal(button(h.container,"Search"),undefined);
    await click(button(h.container,"Next"));assert.match(calls.at(-1),/page=1/);
    const beforeSearch=calls.length;
    await value(h.container.querySelector('input[type="search"]'),"Guest");
    await value(h.container.querySelector('input[type="search"]'),"Guest Tester");
    assert.equal(calls.length,beforeSearch);
    await act(async()=>{await new Promise(resolve=>window.setTimeout(resolve,300));});
    assert.equal(calls.length,beforeSearch+1);assert.match(calls.at(-1),/search=Guest\+Tester/);assert.match(calls.at(-1),/page=0/);
    await value(h.container.querySelector("select"),"inactive");assert.match(calls.at(-1),/status=inactive/);
    await click(button(h.container,"Next"));assert.match(calls.at(-1),/page=1/);await click(button(h.container,"Previous"));assert.match(calls.at(-1),/page=0/);
    const count=calls.length;await click(button(h.container,"Refresh guests"));assert.equal(calls.length,count+1);
    await value(h.container.querySelector('input[type="search"]'),"");
    await act(async()=>{await new Promise(resolve=>window.setTimeout(resolve,300));});
    assert.equal(new URL(calls.at(-1),"http://localhost").searchParams.get("search"),"");
  }finally{await h.close();}
});
test("guest account loading failures can be retried and empty results are explained",async()=>{
  let fail=true;const h=await mount(async()=>fail?Response.json({success:false,message:"Guest list unavailable"},{status:503}):Response.json({success:true,rows:[],total:0}));
  try{assert.match(h.container.querySelector('[role="alert"]').textContent,/unavailable/);fail=false;await click(button(h.container,"Refresh guests"));assert.match(h.container.textContent,/No guest accounts match/);}
  finally{await h.close();}
});


test("an account status request stays in its dialog and cannot be submitted or dismissed twice while saving", async () => {
  let release, writes=0;
  const h=await mount(async(_url,options)=>{
    if(options?.method==="PATCH"){writes++;return new Promise(resolve=>{release=()=>resolve(Response.json({success:true,message:"Guest deactivated"}));});}
    return Response.json({success:true,rows:[guest],total:1});
  });
  try{
    await click(button(h.container,"Deactivate"));await click(button(h.container,"Confirm deactivation"));
    assert.equal(button(h.container,"Saving...").disabled,true);assert.equal(button(h.container,"Cancel").disabled,true);
    await act(async()=>document.dispatchEvent(new window.KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
    assert.ok(h.container.querySelector('[role="dialog"]'));assert.ok(h.container.querySelector('[role="dialog"]').contains(document.activeElement));
    assert.equal(writes,1);await act(async()=>release());assert.equal(h.container.querySelector('[role="dialog"]'),null);
  }finally{await h.close();}
});
