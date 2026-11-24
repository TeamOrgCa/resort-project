import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const body={requestId:id(1),firstName:"Maria",lastName:"Cruz",phone:"09171234567",address:"Street, City, Province, 1234",
  startDatetime:"2030-01-01T00:00:00Z",endDatetime:"2030-01-01T03:00:00Z",durationHours:3,
  rooms:[{classificationId:id(2),occupants:2,pricingVersion:1}],eligibleGuests:1,promoCode:null,selectedServices:[],expectedTotal:270,
  bookingPolicyVersion:1,acceptedPoliciesVersion:"current"};
function harness({authenticated=true,customer=true,rpcError=null}={}){
  const calls=[],policies=[];
  const route=loadTsModule("app/api/reservations/rooms/route.ts",{
    "@/lib/supabase/server":{createClient:async()=>({auth:{getUser:async()=>({data:{user:authenticated?{id:id(100)}:null}})}})},
    "@/lib/auth/customer-access":{customerAccountUser:async(_db,user)=>customer?user:null},
    "@/lib/supabase/admin":{createAdminClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return{data:{id:id(3),referenceNumber:"RM-SAVED",totalAmount:270},error:rpcError};}})},
    "@/lib/server/advance-booking":{checkAdvanceBooking:async()=>null},
    "@/lib/server/legal-policies":{LegalPolicyError:class extends Error{},requireCurrentLegalPolicies:async(_db,version)=>{policies.push(version);return{terms:{policy_id:id(4)},privacy:{policy_id:id(5)}};}},
  });
  return{calls,policies,post:b=>route.POST(new Request("http://localhost/api/reservations/rooms",{method:"POST",body:JSON.stringify(b)}))};
}
test("customer room creation requires a customer session and never accepts a client guest identity",async()=>{
  for(const options of [{authenticated:false},{customer:false}]){const h=harness(options);assert.equal((await h.post(body)).status,401);assert.equal(h.calls.length,0);}
  const h=harness();assert.equal((await h.post({...body,guestId:id(999)})).status,201);
  assert.equal(h.calls[0].name,"room_guest_reserve");assert.equal(h.calls[0].args.p_guest,id(100));assert.equal(h.calls[0].args.p_request,id(1));
  assert.equal(h.calls[0].args.p_input.phone,"+639171234567");assert.equal(h.calls[0].args.p_input.termsPolicyId,id(4));assert.deepEqual(h.policies,["current"]);
});
test("room booking input validation rejects missing selections, fractional occupants and malformed totals before mutation",async()=>{
  const h=harness();for(const patch of [{rooms:[]},{durationHours:8},{eligibleGuests:-1},{rooms:[{...body.rooms[0],occupants:1.5}]},{expectedTotal:"270"},{selectedServices:[{serviceId:id(6),quantity:0}]}])assert.equal((await h.post({...body,...patch})).status,400);
  assert.equal(h.calls.length,0);
});
test("atomic room booking conflicts return a reviewable error without claiming a saved booking",async()=>{
  const h=harness({rpcError:{code:"40001",message:"Not enough rooms are available"}}),response=await h.post(body);
  assert.equal(response.status,409);const result=await response.json();assert.equal(result.success,false);assert.equal(result.code,"ROOM_QUOTE_CHANGED");
});
