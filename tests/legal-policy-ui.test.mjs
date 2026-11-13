import test,{after} from "node:test";
import assert from "node:assert/strict";
import {JSDOM} from "jsdom";
import {act,createElement} from "react";
import {loadTsModule} from "./helpers/load-ts-module.mjs";
import {legalPoliciesFixture} from "./helpers/legal-policies.mjs";

const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost"});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import("react-dom/client");
after(()=>dom.window.close());
const button=(scope,text)=>[...scope.querySelectorAll("button")].find(el=>el.textContent===text);
async function mount(file,fetcher,props={},mocks={}){
  const original=globalThis.fetch;globalThis.fetch=fetcher;
  const Component=loadTsModule(file,mocks).default;
  const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
  await act(async()=>root.render(createElement(Component,props)));
  return {container,close:async()=>{await act(async()=>root.unmount());container.remove();globalThis.fetch=original;}};
}
async function edit(container,name,value){
  const el=container.querySelector(`[name="${name}"]`);
  await act(async()=>{
    const proto=el.tagName==="TEXTAREA"?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,"value").set.call(el,value);
    el.dispatchEvent(new window.Event("input",{bubbles:true}));
  });
}
const submit=container=>act(async()=>container.querySelector("form").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true})));

test("admin policy editor confirms publication, sends expected version and displays preserved history",async()=>{
  let policies=legalPoliciesFixture(),history=[policies.terms,policies.privacy];const posts=[];
  const h=await mount("components/admin/catalog/LegalPoliciesEditor.tsx",async(_url,options)=>{
    if(options?.method==="POST"){
      posts.push(JSON.parse(options.body));const old=policies.terms;
      policies=legalPoliciesFixture({termsVersion:2});policies.terms.content=posts[0].content;
      history=[{...policies.terms,is_active:true},{...old,is_active:false},policies.privacy];
      return Response.json({success:true,policy:policies.terms});
    }
    return Response.json({policies,history});
  });
  try{
    await edit(h.container,"content","# Updated rules\n\nNew published text for guests.");await edit(h.container,"changeNote","Clarify payment instructions");
    await submit(h.container);assert.equal(posts.length,0);
    assert.match(document.querySelector('[role="alertdialog"]').textContent,/version 2/);
    await act(async()=>button(document.querySelector('[role="alertdialog"]'),"Keep editing").click());
    assert.equal(posts.length,0);assert.match(h.container.querySelector('[name="content"]').value,/New published/);
    await submit(h.container);await act(async()=>button(document.querySelector('[role="alertdialog"]'),"Publish new version").click());
    assert.equal(posts[0].expectedVersion,1);assert.equal(posts[0].documentType,"terms");
    assert.equal(posts[0].changeNote,"Clarify payment instructions");
    assert.match(h.container.textContent,/Version 2 published/);assert.match(h.container.textContent,/Version 1/);
    await act(async()=>button(h.container,"Privacy Policy").click());
    assert.equal(h.container.querySelector('[name="title"]').value,"Privacy Policy");
    assert.match(h.container.textContent,/Current version 1/);
  }finally{await h.close();}
});
test("stale publication keeps the draft visible, blocks another publish and reloads the current version",async()=>{
  let gets=0;
  const h=await mount("components/admin/catalog/LegalPoliciesEditor.tsx",async(_url,options)=>{
    if(options?.method==="POST")return Response.json({message:"This policy changed. Reload the current version."},{status:409});
    const policies=legalPoliciesFixture({termsVersion:++gets});return Response.json({policies,history:[policies.terms,policies.privacy]});
  });
  try{
    await edit(h.container,"content","# Draft\n\nUnpublished changes should remain visible.");await edit(h.container,"changeNote","Update rules");
    await submit(h.container);await act(async()=>button(document.querySelector('[role="alertdialog"]'),"Publish new version").click());
    assert.match(h.container.querySelector('[name="content"]').value,/Unpublished changes/);
    assert.equal(h.container.querySelector("fieldset").disabled,true);
    await act(async()=>button(h.container,"Reload current policies").click());
    assert.equal(h.container.querySelector("fieldset").disabled,false);assert.match(h.container.textContent,/Current version 2/);
  }finally{await h.close();}
});
test("public pages show published text safely and keep paragraph/list order",async()=>{
  for(const documentType of ["terms","privacy"]){
    const policies=legalPoliciesFixture({termsVersion:3,privacyVersion:2});
    policies[documentType].content="# Edited heading\n\nBefore list\n\n- First item\n\nAfter list <script>window.injected=true</script>";
    const h=await mount("components/legal/PublishedLegalPage.tsx",async()=>Response.json({policies}),{documentType},{"./CurrentBookingPolicy":()=>null});
    try{
      assert.match(h.container.textContent,new RegExp(`Version ${policies[documentType].version}`));
      assert.match(h.container.textContent,/Edited heading/);assert.equal(h.container.querySelector("script"),null);
      assert.ok(h.container.textContent.indexOf("Before list")<h.container.textContent.indexOf("First item"));
      assert.ok(h.container.textContent.indexOf("First item")<h.container.textContent.indexOf("After list"));
    }finally{await h.close();}
  }
});
