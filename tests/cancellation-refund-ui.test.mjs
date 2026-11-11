import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost",pretendToBeVisual:true});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import("react-dom/client");after(()=>dom.window.close());
const button=(c,label)=>[...c.querySelectorAll("button")].find(b=>b.textContent.trim()===label);
const click=async el=>{assert.ok(el);assert.equal(el.disabled,false);await act(async()=>el.click());};
async function value(el,next){await act(async()=>{const proto=el.tagName==="SELECT"?dom.window.HTMLSelectElement.prototype:el.tagName==="TEXTAREA"?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,"value").set.call(el,next);el.dispatchEvent(new dom.window.Event(el.tagName==="SELECT"?"change":"input",{bubbles:true}));});}
const preview={reservationId:"reservation",reference:"MV-TEST",verifiedPaid:3000,previousRefunds:0,netPaid:3000,depositBase:3000,depositAmount:600,deduction:600,refundableAmount:2400,quote:"a".repeat(32),allowed:true,outcome:"pending_refund",rule:"Initial 20% deposit retained."};
async function mount(filename,props,fetcher){const saved=globalThis.fetch;globalThis.fetch=fetcher;const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
  const Component=loadTsModule(filename,{"@/lib/supabase/client":{createClient:()=>({storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:"http://localhost/proof"},error:null})})}})}}).default;
  await act(async()=>root.render(createElement(Component,props)));return {c,close:async()=>{await act(async()=>root.unmount());c.remove();globalThis.fetch=saved;}};}
test("guest cancellation shows calculated deduction, requires acknowledgement, sends the quote and can reload conflicts",async()=>{
  const calls=[];let fail=true,completed=null;
  const h=await mount("components/CancellationDialog.tsx",{reservationId:"reservation",onClose:()=>{},onCancelled:r=>completed=r},async(url,options)=>{
    calls.push({url,options});return options?.method==="POST"?(fail?Response.json({message:"Bill changed"},{status:409}):Response.json({...preview,success:true})):Response.json({preview});});
  try{
    assert.match(h.c.textContent,/Retained deposit/);assert.match(h.c.textContent,/2,400/);assert.equal(button(h.c,"Confirm cancellation").disabled,true);
    await click(h.c.querySelector('input[type="checkbox"]'));
    assert.equal(button(h.c,"Confirm cancellation").disabled,true);
    await value(h.c.querySelector('[name="cancellationReason"]'),"    "); assert.equal(button(h.c,"Confirm cancellation").disabled,true);
    await value(h.c.querySelector('[name="cancellationReason"]'),"  Family plans changed  ");
    await click(button(h.c,"Confirm cancellation"));assert.match(h.c.textContent,/Bill changed/);
    assert.equal(button(h.c,"Confirm cancellation").disabled,true);fail=false;
    await click(button(h.c,"Reload preview"));await click(h.c.querySelector('input[type="checkbox"]'));await click(button(h.c,"Confirm cancellation"));
    assert.equal(completed.refundableAmount,2400);assert.equal(JSON.parse(calls.find(r=>r.options?.method==="POST").options.body).quote,preview.quote);
    assert.equal(JSON.parse(calls.find(r=>r.options?.method==="POST").options.body).cancellationReason,"Family plans changed");
  }finally{await h.close();}
});
test("cancellation displays retained reschedule fees separately from the deposit and total",async()=>{
  const h=await mount("components/CancellationDialog.tsx",{reservationId:"reservation",onClose:()=>{},onCancelled:()=>{}},async()=>Response.json({preview:{...preview,retainedDeposit:600,retainedRescheduleFees:500,deduction:1100,refundableAmount:1900}}));
  try {
    const amounts=Object.fromEntries([...h.c.querySelectorAll('dt')].map(dt=>[dt.textContent,dt.nextElementSibling.textContent]));
    assert.match(amounts['Retained deposit'],/600/);
    assert.match(amounts['Non-refundable reschedule fees'],/500/);
    assert.match(amounts['Total non-refundable deduction'],/1,100/);
    assert.match(amounts['Refundable amount'],/1,900/);
  } finally {await h.close();}
});

test("resort cancellation requires admin selection, a documented reason and a fresh confirmation",async()=>{
  let posted=null;const h=await mount("components/CancellationDialog.tsx",{reservationId:"reservation",staff:true,canCancelForResort:true,onClose:()=>{},onCancelled:()=>{}},async(url,options)=>{
    if(options?.method==="POST"){posted=JSON.parse(options.body);return Response.json({success:true});}
    const resort=url.includes("initiator=resort");return Response.json({preview:{...preview,initiator:resort?"resort":"guest",deduction:resort?0:600,refundableAmount:resort?3000:2400}});});
  try{await value(h.c.querySelector("select"),"resort");assert.match(h.c.textContent,/3,000/);await click(h.c.querySelector('input[type="checkbox"]'));
    assert.equal(button(h.c,"Confirm cancellation").disabled,true);await value(h.c.querySelector("textarea"),"Pool repairs require closure");await click(button(h.c,"Confirm cancellation"));assert.equal(posted.initiator,"resort");assert.equal(posted.cancellationReason,"Pool repairs require closure");}
  finally{await h.close();}
});

test("guest cancellation explains unpaid/deposit-only outcomes and blocks requests disallowed by policy", async () => {
  for (const [paid, allowed, reason] of [[0, true, null], [600, true, null], [3000, false, "The cancellation notice window has passed. Contact the resort."],
    [3000, false, "Resolve pending payment review before cancellation."]]) {
    let posts = 0;
    const h = await mount("components/CancellationDialog.tsx", { reservationId: "reservation", onClose: () => {}, onCancelled: () => {} }, async (_url, options) => {
      if (options?.method) posts++;
      return Response.json({ preview: { ...preview, verifiedPaid: paid, netPaid: paid, deduction: Math.min(paid, 600), refundableAmount: Math.max(0, paid - 600), allowed, blockedReason: reason } });
    });
    try {
      assert.equal(button(h.c, "Confirm cancellation").disabled, true);
      if (allowed) {
        assert.match(h.c.textContent, /No Refund: no request will be generated/);
        await value(h.c.querySelector('[name="cancellationReason"]'), "Family plans changed");
        await click(h.c.querySelector('[type="checkbox"]')); assert.equal(button(h.c, "Confirm cancellation").disabled, false);
      } else { assert.match(h.c.querySelector('[role="alert"]').textContent, /Contact the resort|pending payment/); assert.equal(h.c.querySelector('[type="checkbox"]'), null); }
      assert.equal(posts, 0);
    } finally { await h.close(); }
  }
});

test("cancellation keeps focus in its dialog and prevents duplicate submissions or closing while saving", async () => {
  let finish, posts = 0, closed = 0, completed = 0;
  const h = await mount("components/CancellationDialog.tsx", { reservationId: "reservation", onClose: () => closed++, onCancelled: () => completed++ }, async (_url, options) => {
    if (!options?.method) return Response.json({ preview });
    posts++; return new Promise(resolve => { finish = () => resolve(Response.json({ ...preview, success: true })); });
  });
  try {
    assert.equal(document.body.style.overflow, "hidden"); assert.equal(document.activeElement, h.c.querySelector('[role="dialog"]'));
    await value(h.c.querySelector('[name="cancellationReason"]'), "Family plans changed");
    await click(h.c.querySelector('[type="checkbox"]'));
    const submit = button(h.c, "Confirm cancellation"); submit.focus();
    await act(async () => submit.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    assert.ok(document.activeElement === h.c.querySelector('[aria-label="Close cancellation dialog"]'));
    await act(async () => { submit.click(); submit.click(); }); assert.equal(posts, 1);
    assert.equal(h.c.querySelector('[role="dialog"]').getAttribute("aria-busy"), "true");
    await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(closed, 0); await act(async () => finish()); assert.equal(completed, 1);
  } finally { await h.close(); }
  assert.equal(document.body.style.overflow, "");
});
test("cashiers can inspect pending refunds without an initial review or approval action",async()=>{
  let posts=0;
  const h=await mount("components/admin/transactions/RefundRequestsPanel.tsx",{},async(_url,options)=>{
    if(options?.method==="POST")posts++;
    return Response.json({refunds:[{refund_id:"refund",reservation_id:"reservation",amount:2400,status:"pending",request_kind:"cancellation",workflow_version:2,requested_at:"2026-10-14T01:00:00Z",policy_snapshot:"Retain initial 20%",calculation_snapshot:preview}],payments:[{payment_id:"payment",reservation_id:"reservation",amount:3000,status:"verified",payment_type:"full",reference_number:"1234567890123"}],permissions:{canApprove:false,canPay:true,canVerify:false,staffId:"cashier"}});});
  try{await click(button(h.c,"View / process"));assert.match(h.c.textContent,/1234567890123/);assert.match(h.c.textContent,/Awaiting manager approval/);
    for(const label of ["Approve refund","Reject with reason","Submit payment review","Submit transfer for verification","Verify transfer and complete refund"])assert.equal(button(h.c,label),undefined);
    assert.equal(posts,0);
  }finally{await h.close();}
});

test("refund requests show guest names and combine name searches with status filters", async () => {
  const h = await mount("components/admin/transactions/RefundRequestsPanel.tsx", {}, async () => Response.json({
    refunds: [
      { refund_id: "one", reservation_id: "r1", amount: 100, status: "pending", requested_at: "2026-11-01T00:00:00Z" },
      { refund_id: "two", reservation_id: "r2", amount: 200, status: "approved", requested_at: "2026-11-01T00:00:00Z" },
    ],
    reservations: [{ reservation_id: "r1", reference_number: "MV-ONE" }, { reservation_id: "r2", reference_number: "MV-TWO" }],
    guestNames: { r1: "Ana Santos", r2: "Juan Cruz" },
  }));
  try {
    assert.match(h.c.querySelector("thead").textContent, /Guest name/);
    await value(h.c.querySelector('input[type="search"]'), "sAnToS");
    assert.equal(h.c.querySelectorAll("tbody tr").length, 1);
    assert.match(h.c.querySelector("tbody").textContent, /Ana Santos/);
    await value(h.c.querySelector("select"), "approved");
    assert.equal(h.c.querySelectorAll("tbody tr").length, 0);
    await value(h.c.querySelector('input[type="search"]'), "MV-TWO");
    assert.equal(h.c.querySelectorAll("tbody tr").length, 1);
    assert.match(h.c.querySelector("tbody").textContent, /Juan Cruz/);
  } finally { await h.close(); }
});

test("view-only administrators can inspect refund records without processing controls", async () => {
  const h = await mount("components/admin/transactions/RefundRequestsPanel.tsx", {}, async () => Response.json({
    refunds: [{ refund_id: "refund", reservation_id: "reservation", amount: 2400, status: "reviewed", request_kind: "cancellation", workflow_version: 2, requested_at: "2026-10-14T01:00:00Z", policy_snapshot: "Retain 20%" }],
    permissions: { canReview: false, canApprove: false, canPay: false, canVerify: false, canVerifyOwnPayout: false, staffId: "admin" },
  }));
  try {
    await click(button(h.c, "View"));
    assert.match(h.c.textContent, /2,400/);
    assert.equal(h.c.querySelector('[role="dialog"]').querySelector("textarea,input,select"), null);
    for (const action of ["Approve refund", "Reject with reason", "Submit payment review", "Verify transfer and complete refund"]) assert.equal(button(h.c, action), undefined);
  } finally { await h.close(); }
});

test("authorized managers can approve pending refunds directly without cashier review", async () => {
  let submitted;
  const h = await mount("components/admin/transactions/RefundRequestsPanel.tsx", {}, async (_url, options) => {
    if (options?.method === "POST") { submitted = options.body; return Response.json({ success: true, message: "Manager approved", emailSent: true }); }
    return Response.json({ refunds: [{ refund_id: "refund", reservation_id: "reservation", amount: 2400, status: "pending", request_kind: "cancellation", workflow_version: 2, requested_at: "2026-10-14T01:00:00Z", policy_snapshot: "Retain 20%" }],
      permissions: { canApprove: true, canPay: false, canVerify: true, staffId: "manager" } });
  });
  try { await click(button(h.c, "View / process")); await click(button(h.c, "Approve refund")); assert.equal(submitted.get("action"), "approved"); }
  finally { await h.close(); }
});

 test("a payout submitter cannot verify their own transfer", async () => {
  const h = await mount("components/admin/transactions/RefundRequestsPanel.tsx", {}, async () => Response.json({
    refunds: [{ refund_id: "refund", reservation_id: "reservation", amount: 2400, status: "payout_submitted", payout_submitted_by: "manager", request_kind: "cancellation", workflow_version: 2, requested_at: "2026-10-14T01:00:00Z", policy_snapshot: "Retain 20%" }],
    permissions: { canReview: true, canApprove: true, canPay: true, canVerify: true, canVerifyOwnPayout: false, staffId: "manager" },
  }));
  try { await click(button(h.c, "View / process")); assert.match(h.c.textContent, /You cannot verify your own payout/); assert.equal(button(h.c, "Verify transfer and complete refund"), undefined); }
  finally { await h.close(); }
});

test("cashier records an approved transfer and manager completes it only after explicit verification", async () => {
  for (const role of ["cashier", "manager"]) {
    let submitted;
    const status = role === "cashier" ? "approved" : "payout_submitted";
    const h = await mount("components/admin/transactions/RefundRequestsPanel.tsx", {}, async (_url, options) => {
      if (options?.method === "POST") { submitted = options.body; return Response.json({ success: true, message: "Saved", emailSent: true }); }
      return Response.json({ refunds: [{ refund_id: "refund", reservation_id: "reservation", amount: 2400, status,
        payout_submitted_by: role === "manager" ? "cashier" : null, request_kind: "cancellation", workflow_version: 2,
        requested_at: "2026-10-14T01:00:00Z", policy_snapshot: "Retain 20%" }],
        paymentMethods: [{ payment_method_id: "gcash", name: "GCash" }],
        permissions: { canApprove: role === "manager", canPay: role === "cashier", canVerify: role === "manager", staffId: role } });
    });
    try {
      await click(button(h.c, "View / process"));
      assert.equal(button(h.c, "Submit payment review"), undefined);
      if (role === "cashier") {
        assert.equal(button(h.c, "Verify transfer and complete refund"), undefined);
        const submit = button(h.c, "Submit transfer for verification"); assert.equal(submit.disabled, true);
        await value(h.c.querySelector('input[maxlength="100"]'), "1234567890123");
        const fileInput = h.c.querySelector('input[type="file"]');
        Object.defineProperty(fileInput, "files", { value: [new File(["%PDF-1.7"], "proof.pdf", { type: "application/pdf" })] });
        await act(async () => fileInput.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
        await click(submit);
        assert.equal(submitted.get("action"), "payout_submitted"); assert.equal(submitted.get("reference"), "1234567890123");
        assert.ok(submitted.get("proof") instanceof File);
      } else {
        assert.equal(button(h.c, "Submit transfer for verification"), undefined);
        const submit = button(h.c, "Verify transfer and complete refund"); assert.equal(submit.disabled, true);
        await value(h.c.querySelector("textarea"), "Matched amount, recipient and transaction reference");
        assert.equal(submit.disabled, true);
        await click(h.c.querySelector('input[type="checkbox"]')); await click(submit);
        assert.equal(submitted.get("action"), "refunded"); assert.equal(submitted.get("verified"), "true");
      }
    } finally { await h.close(); }
  }
});
