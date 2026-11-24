import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTsModule} from './helpers/load-ts-module.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const body={requestId:id(1),typeId:id(2),pricingVersion:1,firstName:'Maria',lastName:'Cruz',phone:'09171234567',address:'Street, City, Province, 1234',startDatetime:'2030-01-01T08:00:00+08:00',endDatetime:'2030-01-01T16:00:00+08:00',adultCount:2,childCount:1,eligibleGuests:0,selectedServices:[],expectedTotal:420,bookingPolicyVersion:1,acceptedPoliciesVersion:'current'};
function harness({customer=true,error=null}={}){
 const calls=[];
 const route=loadTsModule('app/api/reservations/public-swimming/route.ts',{
  '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:id(100)}}})}})},
  '@/lib/auth/customer-access':{customerAccountUser:async()=>customer},
  '@/lib/supabase/admin':{createAdminClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return{data:{id:id(3),referenceNumber:'PS-SAVED',totalAmount:420},error};}})},
  '@/lib/server/legal-policies':{LegalPolicyError:class extends Error{},requireCurrentLegalPolicies:async()=>({terms:{policy_id:id(4)},privacy:{policy_id:id(5)}})},
 });return{calls,post:b=>route.POST(new Request('http://localhost/api/reservations/public-swimming',{method:'POST',body:JSON.stringify(b)}))};
}
test('public booking uses the authenticated customer, validated legal IDs and normalized contact data',async()=>{
 const h=harness();assert.equal((await h.post({...body,guestId:id(999),staff:true})).status,201);
 assert.equal(h.calls[0].name,'public_reserve');assert.equal(h.calls[0].args.p_actor,id(100));assert.equal(h.calls[0].args.p_staff,false);assert.equal(h.calls[0].args.p_input.phone,'+639171234567');assert.equal(h.calls[0].args.p_input.termsPolicyId,id(4));
 assert.equal((await harness({customer:false}).post(body)).status,401);
});
test('invalid public guest counts and service quantities are rejected before saving, while atomic conflicts return 409',async()=>{
 const h=harness();for(const patch of [{adultCount:0},{childCount:-1},{adultCount:1.5},{eligibleGuests:4},{selectedServices:[{serviceId:id(90),quantity:0}]},{expectedTotal:'420'}])assert.equal((await h.post({...body,...patch})).status,400);
 assert.equal(h.calls.length,0);assert.equal((await harness({error:{code:'40001',message:'Public session is full'}}).post(body)).status,409);
});
test('public manual reservations use the existing creation permission in middleware',()=>{
 const {apiPermission}=loadTsModule('lib/auth/role-access.ts');assert.equal(apiPermission('/api/admin/reservations/public-swimming','POST'),'create_reservation');
});
test('reschedule availability exclusions require the booking owner or authorized staff and are never publicly cached',async()=>{
 for(const access of ['anonymous','other','owner','manager']){
  const calls=[],q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:access==='owner'?{reservation_id:id(1)}:null,error:null})};
  const route=loadTsModule('app/api/booking/public-swimming/route.ts',{
   '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:access==='anonymous'?null:{id:id(100)}}})},from:()=>q})},
   '@/lib/server/admin-audit':{requireActiveStaff:async()=>access==='manager'?{supabase:{},staffUser:{role:'staff'}}:null},
   '@/lib/server/role-permissions':{staffHasPermission:async()=>true},
   '@/lib/server/public-swimming':{loadPublicSwimmingCatalog:async excluded=>{calls.push(excluded);return{types:[],slots:[],dates:[],services:[]};}},
  });
  const response=await route.GET(new Request('http://localhost/api/booking/public-swimming?excludeReservationId='+id(1)));
  assert.equal(response.status,access==='anonymous'?401:access==='other'?403:200);
  if(response.status===200){assert.deepEqual(calls,[id(1)]);assert.equal(response.headers.get('cache-control'),'private, no-store');}else assert.equal(calls.length,0);
 }
});
