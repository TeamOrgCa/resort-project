import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
function harness({active=true,allowed=true,racing=false}={}){
 const writes=[],notifications=[];
 const client={from:table=>{
  const q={update:data=>{writes.push(data);return q;},eq:()=>q,select:()=>q,maybeSingle:async()=>({error:null,data:table==="payments"?(racing?null:{payment_id:"payment",reservation_id:"reservation"}):{guest_id:"guest",reference_number:"MV-TEST",status:"rejected"}})};return q;}};
 const {POST}=loadTsModule("app/api/admin/payments/reject/route.ts",{
  "@/lib/server/admin-audit":{requireActiveStaff:async()=>active?{supabase:client,staffUser:{id:"manager",role:"staff"}}:null},
  "@/lib/server/role-permissions":{staffHasPermission:async()=>allowed},
  "@/lib/notifications":{createNotifications:async input=>{notifications.push(input);return{error:null};}},
 });return{writes,notifications,post:reason=>POST(new Request("http://localhost",{method:"POST",body:JSON.stringify({paymentId:"payment",rejectionReason:reason})}))};
}
test("payment rejection requires a meaningful reason before writing and includes it in the guest notification",async()=>{
 for(const reason of [undefined,null," ","bad","x".repeat(2001)]){const h=harness();assert.equal((await h.post(reason)).status,400);assert.equal(h.writes.length,0);}
 const h=harness();assert.equal((await h.post("  Incorrect receiving account  ")).status,200);
 assert.deepEqual(h.writes,[{status:"rejected",rejection_reason:"Incorrect receiving account"}]);assert.match(h.notifications[0].message,/Incorrect receiving account/);
});
test("payment rejection preserves permission checks and concurrent review protection",async()=>{
 for(const [options,status] of [[{active:false},401],[{allowed:false},403],[{racing:true},409]]){const h=harness(options);assert.equal((await h.post("Receipt does not match")).status,status);assert.equal(h.notifications.length,0);}
});
