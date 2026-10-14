import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const id="22222222-2222-4222-8222-222222222222", quote="a".repeat(32);
const preview={reservationId:id,reference:"MV-TEST",initiator:"guest",verifiedPaid:3000,previousRefunds:0,netPaid:3000,deduction:600,refundableAmount:2400,quote,allowed:true,outcome:"pending_refund"};
function cancellation({staff=false,role="admin",authorized=true,authenticated=true,rpcError=null,emailFails=false}={}) {
  const calls=[];
  const client={auth:{getUser:async()=>({data:{user:authenticated?{id:"guest"}:null},error:null})},
    rpc:async(name,args)=>{calls.push({name,args});return {data:name==="get_cancellation_preview"?preview:{...preview,refundId:id},error:rpcError};},
    from:table=>{const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:table==="reservations"?{guest_id:"guest",reference_number:"MV-TEST"}:{email:"fixture@example.com",first_name:"Test"},error:null})};return query;}};
  const route=loadTsModule(staff?"app/api/admin/reservations/cancel/route.ts":"app/api/reservations/cancel/route.ts",{
    "@/lib/supabase/server":{createClient:async()=>client},
    "@/lib/server/admin-audit":{requireActiveStaff:async()=>authenticated?{supabase:client,staffUser:{id:"admin",role}}:null},
    "@/lib/server/role-permissions":{staffHasPermission:async()=>authorized},
    "@/lib/email":{sendReservationCancelledEmail:async()=>{if(emailFails)throw Error("SMTP unavailable");return true;},sendRefundStatusEmail:async()=>true},
  });
  return {...route,calls,post:body=>route.POST(new Request("http://localhost",{method:"POST",body:JSON.stringify(body)})),get:()=>route.GET(new Request("http://localhost?reservationId="+id+"&initiator=guest"))};
}
test("guest preview is private; cancellation requires a reviewed quote and ignores forged amounts/initiator",async()=>{
  const h=cancellation();const get=await h.get();assert.equal(get.status,200);assert.equal(get.headers.get("cache-control"),"private, no-store");
  assert.equal((await h.post({reservationId:id})).status,400);
  const response=await h.post({reservationId:id,quote,initiator:"resort",refundableAmount:999999});assert.equal(response.status,200);
  const call=h.calls.at(-1);assert.equal(call.args.p_initiator,"guest");assert.equal(call.args.p_expected_quote,quote);assert.equal(call.args.p_reason,"Guest requested cancellation");
  assert.equal((await response.json()).refundableAmount,2400);
});
test("cancellation API handles ownership/conflict errors and SMTP failure without undoing committed success",async()=>{
  assert.equal((await cancellation({authenticated:false}).get()).status,401);
  for(const [code,status] of [["42501",403],["40001",409],["PGRST202",503]])assert.equal((await cancellation({rpcError:{code,message:"Denied"}}).post({reservationId:id,quote})).status,status);
  const result=await cancellation({emailFails:true}).post({reservationId:id,quote});assert.equal(result.status,200);assert.equal((await result.json()).emailSent,false);
});
test("staff cancellation requires permission, documented reason and admin role for resort-attributable cancellation",async()=>{
  const body={reservationId:id,quote,initiator:"resort",cancellationReason:"Pool repair requires closure"};
  assert.equal((await cancellation({staff:true,authorized:false}).post(body)).status,403);
  assert.equal((await cancellation({staff:true,role:"cashier"}).post(body)).status,403);
  assert.equal((await cancellation({staff:true}).post({...body,cancellationReason:""})).status,400);
  const h=cancellation({staff:true});assert.equal((await h.post(body)).status,200);assert.equal(h.calls[0].args.p_initiator,"resort");
});
function refund({role="cashier",authorized=true,status="approved",rpcError=null}={}){
  const calls=[],uploads=[],removed=[];
  const client={from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{status,reservation_id:id,amount:2400},error:null})};return q;},
    rpc:async(name,args)=>{calls.push({name,args});return {error:rpcError};}};
  const route=loadTsModule("app/api/admin/refunds/route.ts",{
    "@/lib/server/admin-audit":{requireActiveStaff:async()=>({supabase:client,staffUser:{id:"staff",role}})},
    "@/lib/server/role-permissions":{staffHasPermission:async()=>authorized},
    "@/lib/server/cancellation":{refundEmail:async()=>false,workflowErrorMessage:e=>e.message,workflowErrorStatus:c=>c==="42501"?403:c==="40001"?409:400},
    "@/lib/supabase/admin":{createAdminClient:()=>({storage:{from:()=>({upload:async(path)=>{uploads.push(path);return {error:null};},remove:async paths=>{removed.push(...paths);return {error:null};}})}})},
  });
  return {calls,uploads,removed,post:async(action,extra={})=>{const form=new FormData();form.set("refundId",id);form.set("action",action);for(const [k,v]of Object.entries(extra))form.set(k,v);
    return route.POST(new Request("http://localhost",{method:"POST",body:form}));}};
}
test("cashier cannot approve/reject and verification needs explicit acknowledgement and notes",async()=>{
  const h=refund();assert.equal((await h.post("approved")).status,403);assert.equal((await h.post("rejected",{reason:"Not eligible"})).status,403);
  assert.equal((await h.post("refunded")).status,400);assert.equal(h.calls.length,0);
  assert.equal((await h.post("refunded",{verified:"true",reason:"Matched GCash records"})).status,200);
  assert.equal(h.calls[0].args.p_verified,true);assert.equal(h.calls[0].args.p_action,"refunded");
});
test("payout evidence is submitted separately from completion, invalid file signatures cannot be uploaded",async()=>{
  const proof=new File(["%PDF-1.7 fixture"],"proof.pdf",{type:"application/pdf"});
  const h=refund();const response=await h.post("payout_submitted",{reference:"1234567890123",proof,amount:"999999"});assert.equal(response.status,200);
  assert.equal(h.uploads.length,1);assert.equal(h.calls[0].name,"transition_refund_workflow");assert.equal(h.calls[0].args.p_action,"payout_submitted");assert.equal(h.calls[0].args.p_verified,false);
  assert.ok(h.calls[0].args.p_proof.startsWith(id+"/"));assert.equal(h.calls[0].args.p_amount,undefined);
  const invalid=refund();assert.equal((await invalid.post("payout_submitted",{reference:"1234567890123",proof:new File(["invalid"],"proof.png",{type:"image/png"})})).status,400);assert.equal(invalid.uploads.length,0);
});
test("a rejected payout transition cleans only its new upload and does not alter the saved request",async()=>{
  const h=refund({rpcError:{code:"40001",message:"Changed state"}});const response=await h.post("payout_submitted",{reference:"1234567890123",proof:new File(["%PDF-1.7"],"proof.pdf",{type:"application/pdf"})});
  assert.equal(response.status,409);assert.deepEqual(h.removed,h.uploads);
});
