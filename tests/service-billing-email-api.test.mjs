import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const reservationId="11111111-1111-4111-8111-111111111111",serviceId="22222222-2222-4222-8222-222222222222";
function harness({authenticated=true,rpcError=null,addedCharge=500,notifyFails=false,emailSent=true}={}){
  const emails=[],writes=[];
  const {POST}=loadTsModule("app/api/reservations/services/route.ts",{
    "@/lib/supabase/server":{createClient:async()=>({auth:{getUser:async()=>({data:{user:authenticated?{id:"guest"}:null},error:null})},
      rpc:async(name,args)=>{writes.push({name,args});return {data:{totalAmount:10500,paidAmount:10000,remainingBalance:500,status:"partial",addedCharge},error:rpcError};}})},
    "@/lib/notifications":{NOTIFICATION_AUDIENCES:{reservation:[]},createNotifications:async()=>{if(notifyFails)throw Error("Unavailable");return {error:null};}},
    "@/lib/server/billing-email":{emailUpdatedBillingStatement:async(...args)=>{emails.push(args);return {sent:emailSent,...(emailSent?{}:{error:"Email unavailable."})};}},
  });
  return {emails,writes,save:()=>POST(new Request("http://localhost/api/reservations/services",{method:"POST",body:JSON.stringify({reservationId,services:[{serviceId,quantity:2}]})}))};
}

test("service additions email the committed bill and unchanged submissions do not resend it",async()=>{
  const h=harness();const response=await h.save();assert.equal(response.status,200);assert.deepEqual(h.emails,[[reservationId,10500]]);assert.match((await response.json()).message,/statement emailed/);
  const unchanged=harness({addedCharge:0});await unchanged.save();assert.equal(unchanged.emails.length,0);
});

test("service authorization and database failures never send a billing email",async()=>{
  const unauthorized=harness({authenticated:false});assert.equal((await unauthorized.save()).status,401);assert.equal(unauthorized.writes.length,0);assert.equal(unauthorized.emails.length,0);
  const denied=harness({rpcError:{code:"42501",message:"Not your booking"}});assert.equal((await denied.save()).status,403);assert.equal(denied.emails.length,0);
});

test("notification and email failures do not turn a committed service charge into a failed save",async()=>{
  const h=harness({notifyFails:true,emailSent:false});const response=await h.save();assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.success,true);assert.equal(body.billingEmail.sent,false);assert.match(body.message,/not emailed/);assert.equal(h.writes.length,1);
});
