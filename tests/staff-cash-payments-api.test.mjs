
import test from"node:test";import assert from"node:assert/strict";import{loadTsModule}from"./helpers/load-ts-module.mjs";
function harness({allowed=true,permission=true,error=null,replayed=false,deliveryFails=false}={}){
 const calls=[],emails=[],notifications=[];
 const data={payment:{payment_id:"payment",amount:2400},reservation:{guest_id:"guest",reference_number:"MV-CASH"},receipt:{receipt_number:"RCPT-CASH"},remainingBalance:0,overpaidAmount:0,alreadyRecorded:replayed};
 const {POST}=loadTsModule("app/api/admin/payments/manual-entry/route.ts",{
 "@/lib/server/admin-audit":{requireActiveStaff:async()=>allowed?{staffUser:{id:"admin",role:"admin"},supabase:{rpc:async(name,args)=>{calls.push({name,args});return{data,error};}}}:null},
 "@/lib/server/role-permissions":{staffHasPermission:async()=>permission},
 "@/lib/server/billing-email":{emailBillingDocuments:async(...args)=>{emails.push(args);if(deliveryFails)throw Error("SMTP unavailable");return{receiptSent:true,invoiceSent:true};}},
 "@/lib/notifications":{createNotifications:async args=>{notifications.push(args);if(deliveryFails)throw Error("Notifications unavailable");return{error:null};}},
 });
 return{calls,emails,notifications,post:body=>POST(new Request("http://localhost",{method:"POST",body:JSON.stringify({reservationId:"reservation",amount:2400,paymentMethod:"cash",paymentReference:"CASH-TEST123456",expectedBalance:2400,cashReceived:true,...body})}))};
}
test("staff cash entry is permission-gated and requires acknowledgement and valid money",async()=>{
 assert.equal((await harness({allowed:false}).post()).status,401);assert.equal((await harness({permission:false}).post()).status,403);
 const h=harness();for(const body of[{cashReceived:false},{amount:0},{amount:1.001},{expectedBalance:undefined}])assert.equal((await h.post(body)).status,400);
 assert.equal(h.calls.length,0);
});
test("staff non-cash entry rejects sender digits and emoji before processing a payment",async()=>{
 for(const accountName of ["Guest123", "Guest 😀", "Guest 1️⃣", "---"]){
  const h=harness();const r=await h.post({paymentMethod:"e_wallet",accountName,accountNumber:"09171234567",proofPath:"proof.png"});
  assert.equal(r.status,400);assert.match((await r.json()).message,/sender name/);
  assert.equal(h.calls.length,0);assert.equal(h.emails.length,0);assert.equal(h.notifications.length,0);
 }
});
test("cash recording uses the atomic RPC, returns the issued receipt and avoids duplicate delivery on retries",async()=>{
 const h=harness();const r=await h.post();assert.equal(r.status,201);const data=await r.json();assert.equal(data.receipt.receipt_number,"RCPT-CASH");assert.equal(data.remainingBalance,0);
 assert.equal(h.calls[0].name,"record_staff_cash_payment");assert.equal(h.calls[0].args.p_received,true);assert.equal(h.emails.length,1);assert.equal(h.notifications.length,1);
 const retry=harness({replayed:true});assert.equal((await retry.post()).status,200);assert.equal(retry.emails.length,0);assert.equal(retry.notifications.length,0);
});
test("a saved cash payment remains successful if email or notification delivery fails",async()=>{
 const warn=console.warn;console.warn=()=>{};
 try{const h=harness({deliveryFails:true});const r=await h.post();assert.equal(r.status,201);assert.equal((await r.json()).success,true);}finally{console.warn=warn;}
});
test("cash conflicts and missing migrations return actionable errors without sending emails",async()=>{
 for(const [code,status]of[["42501",403],["40001",409],["23505",409],["22023",400],["P0002",404],["PGRST202",503]]){
 const h=harness({error:{code,message:"Cash blocked"}});assert.equal((await h.post()).status,status);assert.equal(h.emails.length,0);
 }
});

test("cash errors distinguish a stale API function cache from a missing dependency and preserve database diagnostics",async()=>{
 const original=console.error,logged=[];console.error=(...args)=>logged.push(args);
 try{
   for(const [code,message]of[["PGRST202","Could not find public.record_staff_cash_payment"],["42883","function public.record_staff_cash_payment does not exist"]]){
     const r=await harness({error:{code,message}}).post();const body=await r.json();
     assert.equal(r.status,503);assert.equal(body.errorCode,code);assert.match(body.message,/NOTIFY pgrst, 'reload schema'/);
   }
   const r=await harness({error:{code:"42703",message:'column "billed_to_name" does not exist',details:"trigger create_receipt_on_payment",hint:"Apply billing migration"}}).post();
   const body=await r.json();assert.equal(body.errorCode,"42703");assert.match(body.message,/required table, column or function is missing/);assert.doesNotMatch(body.message,/NOTIFY/);
   assert.equal(logged.at(-1)[1].message,'column "billed_to_name" does not exist');assert.equal(logged.at(-1)[1].details,"trigger create_receipt_on_payment");
   const receipt=await harness({error:{code:"55000",message:"Receipt creation is not configured. Cash was not recorded"}}).post();
   assert.match((await receipt.json()).message,/Receipt creation is not configured/);
   const constraint=await harness({error:{code:"23514",message:'violates check constraint "payments_payment_type_check"'}}).post();
   assert.equal(constraint.status,400);assert.match((await constraint.json()).message,/payments_payment_type_check/);
   const failed=await harness({error:{code:"XX000",message:"Unexpected trigger failure"}}).post();
   assert.match((await failed.json()).message,/same cash reference/);assert.doesNotMatch((await harness({error:{code:"XX000",message:"Unexpected trigger failure"}}).post()).status.toString(),/^2/);
 }finally{console.error=original;}
});
