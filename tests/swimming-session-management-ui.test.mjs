import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {act,createElement} from 'react';
import {loadTsModule} from './helpers/load-ts-module.mjs';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/admin/configuration',pretendToBeVisual:true});
for(const key of ['window','document','HTMLElement','Node'])globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.self=dom.window;
const {createRoot}=await import('react-dom/client');after(()=>dom.window.close());
const button=(root,label)=>[...root.querySelectorAll('button')].find(el=>el.textContent.trim()===label);
const click=async el=>{assert.ok(el);await act(async()=>el.click());};
test('weekly editor and date overrides require confirmation and retain drafts when allocation conflicts are returned',async()=>{
 const {DEFAULT_SWIMMING_POLICY}=loadTsModule('lib/booking/swimming-sessions.ts'),{DEFAULT_PACKAGE_TIMES}=loadTsModule('lib/booking/package-times.ts');
 const oldFetch=globalThis.fetch,posts=[];
 globalThis.fetch=async(_url,options)=>{
  if(!options?.method)return Response.json({policy:DEFAULT_SWIMMING_POLICY,privateDays:365,schedule:{version:1,times:DEFAULT_PACKAGE_TIMES},publicTypes:[]});
  posts.push(JSON.parse(options.body));return Response.json({message:'Schedule changes conflict with existing reservations or active payment holds',conflicts:[{reservationId:'1',referenceNumber:'PS-PROTECTED',startDatetime:'2030-01-01T08:00:00+08:00',endDatetime:'2030-01-01T16:00:00+08:00',status:'confirmed',reason:'Private Only'}]},{status:409});
 };
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(createElement(loadTsModule('components/admin/SwimmingSessionsEditor.tsx').default)));
  assert.equal(host.querySelectorAll('select[aria-label$="access mode"]').length,16);
  assert.match(host.textContent,/Weekly swimming schedule/);assert.match(host.textContent,/Specific date overrides/);
  const weekly=host.querySelector('[aria-label="Saturday day access mode"]');
  await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set.call(weekly,'public_only');weekly.dispatchEvent(new window.Event('change',{bubbles:true}));});
  await click(button(host,'Add override'));assert.match(host.textContent,/Remove/);
  await click(button(host,'Save swimming configuration'));assert.equal(posts.length,0);
  await click(button(document.querySelector('[role="alertdialog"]'),'Keep editing'));assert.equal(weekly.value,'public_only');
  await click(button(host,'Save swimming configuration'));await click(button(document.querySelector('[role="alertdialog"]'),'Apply swimming configuration'));
  assert.equal(posts.length,1);assert.equal(posts[0].policy.weekly['6'].day,'public_only');assert.equal(posts[0].policy.overrides.length,1);
  assert.match(host.textContent,/PS-PROTECTED/);assert.match(host.textContent,/Affected reservations/);assert.equal(weekly.value,'public_only');
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=oldFetch;}
});
