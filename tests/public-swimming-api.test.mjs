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

test('public booking identifies the invalid field and accepts bookings without services or discounts',async()=>{
 const h=harness();
 for(const [patch,field,message] of [
  [{firstName:''},'firstName',/first and last name/],
  [{phone:''},'phone',/Philippine mobile/],
  [{address:'Incomplete'},'address',/street address|province/],
  [{requestId:undefined},'requestId',/booking draft/],
  [{typeId:undefined},'typeId',/Day or Night/],
  [{pricingVersion:undefined},'pricingVersion',/Session rates/],
  [{eligibleGuests:4},'eligibleGuests',/PWD \/ senior count/],
  [{selectedServices:[{serviceId:id(90),quantity:0}]},'selectedServices',/Services are optional/],
  [{promoCode:123},'promoCode',/promo code is optional/],
 ]){
  const response=await h.post({...body,...patch}),error=await response.json();
  assert.equal(response.status,400);assert.equal(error.field,field);assert.match(error.message,message);
 }
 assert.equal(h.calls.length,0);
 assert.equal((await h.post({...body,eligibleGuests:0,promoCode:null,selectedServices:[]})).status,201);
 assert.equal(h.calls[0].args.p_input.eligibleGuests,0);assert.equal(h.calls[0].args.p_input.promoCode,null);assert.deepEqual(h.calls[0].args.p_input.selectedServices,[]);
});
test('public manual reservations use the existing creation permission in middleware',()=>{
 const {apiPermission}=loadTsModule('lib/auth/role-access.ts');assert.equal(apiPermission('/api/admin/reservations/public-swimming','POST'),'create_reservation');
});
test('public room choices validate quantities and saved versions and discard submitted prices',async()=>{
 const h=harness(),choice={classificationId:id(40),quantity:2,pricingVersion:1};
 for(const swimmingRooms of [[{...choice,quantity:0}],[{...choice,quantity:1.5}],[{...choice,quantity:21}],[choice,choice],[{...choice,pricingVersion:0}],null]) {
  const response=await h.post({...body,swimmingRooms});assert.equal(response.status,400);assert.equal((await response.json()).field,'swimmingRooms');
 }
 assert.equal(h.calls.length,0);
 assert.equal((await h.post({...body,swimmingRooms:[{...choice,unitPrice:1,name:'Forged'}]})).status,201);
 assert.deepEqual(h.calls[0].args.p_input.swimmingRooms,[choice]);
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

test('public availability validates a browsable month and passes it independently of the booking window',async()=>{
 const calls=[],route=loadTsModule('app/api/booking/public-swimming/route.ts',{
  '@/lib/server/public-swimming':{loadPublicSwimmingCatalog:async(...args)=>{calls.push(args);return{types:[],slots:[],dates:['2030-11-25','2030-11-26','2030-11-27'],sessions:[]};}},
 });
 for(const month of ['2030-00','2030-13','2030-1','2030-11-01','invalid','0000-01','9999-01']){
  assert.equal((await route.GET(new Request('http://localhost/api/booking/public-swimming?month='+month))).status,400);
 }
 assert.equal(calls.length,0);
 const response=await route.GET(new Request('http://localhost/api/booking/public-swimming?month=2031-01'));
 assert.equal(response.status,200);assert.deepEqual(calls,[[undefined,'2031-01']]);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual((await response.json()).dates,['2030-11-25','2030-11-26','2030-11-27']);
});

test('catalog loading retains the actual booking window when no bookable slots exist',async()=>{
 const calls=[],row={booking_date:'2031-01-01',type_id:id(1),starts_at:'2031-01-01T08:00:00+08:00',ends_at:'2031-01-01T16:00:00+08:00',remaining_capacity:42,availability:'private',eligibility:'not_open',opens_at:'2030-12-30T00:00:00+08:00',evaluated_at:'2030-11-24T16:30:00Z'};
 const loader=loadTsModule('lib/server/public-swimming.ts',{
  '@/lib/supabase/admin':{createAdminClient:()=>({
    from:()=>{const q={select:()=>q,eq:()=>q,order:async()=>({data:[],error:null})};return q;},
    rpc:async(name,args)=>{calls.push({name,args});return{data:name==='public_swimming_calendar'?[row]:[],error:null};},
  })},
 });
 const catalog=await loader.loadPublicSwimmingCatalog(undefined,'2031-01');
 assert.deepEqual(catalog.dates,['2030-11-25','2030-11-26','2030-11-27']);assert.equal(catalog.today,'2030-11-25');assert.deepEqual(catalog.slots,[]);
 assert.equal(catalog.sessions[0].availability,'private');assert.equal(catalog.sessions[0].eligibility,'not_open');assert.equal(catalog.sessions[0].remainingCapacity,42);
 assert.deepEqual(calls.find(c=>c.name==='public_swimming_calendar').args,{p_from:'2031-01-01',p_to:'2031-01-31',p_exclude:null});
});
