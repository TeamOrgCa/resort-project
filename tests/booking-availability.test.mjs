import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const id="11111111-1111-4111-8111-111111111111";
const rows=[
 {reservation_id:id,start_datetime:"2027-06-14T08:00:00+08:00",end_datetime:"2027-06-14T16:00:00+08:00",status:"confirmed"},
 {reservation_id:"other",start_datetime:"2027-06-15T18:00:00+08:00",end_datetime:"2027-06-16T06:00:00+08:00",status:"confirmed"},
 {reservation_id:"expired",start_datetime:"2027-06-17T08:00:00+08:00",end_datetime:"2027-06-17T16:00:00+08:00",status:"pending",payment_deadline_at:"2020-01-01T00:00:00Z"},
 {reservation_id:"pending",start_datetime:"2027-06-18T08:00:00+08:00",end_datetime:"2027-06-18T16:00:00+08:00",status:"pending",payment_deadline_at:"2099-01-01T00:00:00Z"},
 {reservation_id:"cancelled",start_datetime:"2027-06-19T08:00:00+08:00",end_datetime:"2027-06-19T16:00:00+08:00",status:"cancelled"},
];
// Existing rows retain private resort exclusivity. Physical room reservations
// no longer block every private-booking date on the public calendar.
for (const row of rows) row.commercial_type = "private_swimming";
rows.push({ reservation_id: "room", commercial_type: "room_accommodation", start_datetime: "2027-06-14T09:00:00+08:00", end_datetime: "2027-06-14T12:00:00+08:00", status: "confirmed" });
function harness({staff=true,permission=true,sessions=[],bufferMinutes=0}={}){
 let reads=0,authChecks=0;const filters=[];
 const {GET}=loadTsModule("app/api/booking/availability/route.ts",{
  "@/lib/server/admin-audit":{requireActiveStaff:async()=>{authChecks++;return staff?{supabase:{},staffUser:{role:"staff"}}:null;}},
  "@/lib/server/role-permissions":{staffHasPermission:async()=>permission},
  "@/lib/supabase/admin":{createAdminClient:()=>({rpc:async(name)=>({error:null,data:name==='swimming_policy'?{bufferMinutes}:sessions}),from(table){
   reads++;const predicates=[];
   const q={select:()=>q,limit:()=>q,maybeSingle:async()=>({data:{setting_value:45},error:null}),
    in:(key,values)=>{predicates.push(row=>values.includes(row[key]));return q;},
    eq:(key,value)=>{predicates.push(row=>row[key]===value);return q;},
    neq:(key,value)=>{filters.push([key,value]);predicates.push(row=>row[key]!==value);return q;},
    lt:(key,value)=>{predicates.push(row=>Date.parse(row[key])<Date.parse(value));return q;},
    gt:(key,value)=>{predicates.push(row=>Date.parse(row[key])>Date.parse(value));return q;},
    gte:(key,value)=>{predicates.push(row=>Date.parse(row[key])>=Date.parse(value));return q;},
    then:(resolve,reject)=>Promise.resolve({error:null,data:(table==="reservations"?rows:[{start_date:"2027-07-01",end_date:"2027-07-01",status:"active"}]).filter(row=>predicates.every(test=>test(row)))}).then(resolve,reject)};
   return q;
  }})},
 });
 return{get:query=>GET(new Request("http://localhost/api/booking/availability?month=2027-06"+query)),filters,reads:()=>reads,authChecks:()=>authChecks};
}
test("public availability includes every active hold and booking, strips identifiers and includes next-month maintenance",async()=>{
 const h=harness({staff:false});const response=await h.get("");const data=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");assert.equal(h.authChecks(),0);
 assert.equal(data.maximumAdvanceBookingDays,45); assert.match(data.maxBookingDate,/^\d{4}-\d{2}-\d{2}$/);
 assert.equal(data.reservations.length,3);assert.equal(data.reservations[0].start_datetime,rows[0].start_datetime);
 assert.deepEqual(Object.keys(data.reservations[0]).sort(),["end_datetime","start_datetime"]);
 assert.equal(data.blockedDates[0].start_date,"2027-07-01");assert.equal(h.filters.length,0);
});

test('private previews include disabled policy windows and expand physical allocations by the configured buffer',async()=>{
 const session={booking_date:'2027-06-21',period:'day',starts_at:'2027-06-21T08:00:00+08:00',ends_at:'2027-06-21T16:00:00+08:00',access_mode:'public_only',reason:'Public Only'};
 const response=await harness({staff:false,sessions:[session],bufferMinutes:60}).get('');const data=await response.json();
 assert.equal(response.status,200);assert.deepEqual(data.swimmingSessions,[session]);
 assert.equal(data.reservations[0].start_datetime,'2027-06-13T23:00:00.000Z');
 assert.equal(data.reservations[0].end_datetime,'2027-06-14T09:00:00.000Z');
 assert.ok(data.reservations.some(s=>s.start_datetime===session.starts_at));assert.doesNotMatch(JSON.stringify(data),/reservation_id|reference_number/);
});

test('arrival-window restrictions do not become next-day resource claims for whole-day packages',async()=>{
 const session={booking_date:'2027-06-21',period:'day',starts_at:'2027-06-21T08:00:00+08:00',ends_at:'2027-06-21T16:00:00+08:00',access_mode:'flexible',reason:'Not Yet Open for Booking'};
 const data=await(await harness({sessions:[session]}).get('')).json();
 assert.equal(data.reservations.length,3);assert.equal(data.swimmingSessions[0].reason,'Not Yet Open for Booking');
});
test("authorized staff can exclude the edited reservation without removing other occupied slots",async()=>{
 const h=harness();const response=await h.get("&excludeReservationId="+id);const data=await response.json();
 assert.equal(response.status,200);assert.equal(data.reservations.length,2);
 assert.equal(data.reservations.some(row=>row.start_datetime===rows[0].start_datetime),false);
 assert.ok(data.reservations.some(row=>row.start_datetime===rows[1].start_datetime));
 assert.deepEqual(h.filters,[["reservation_id",id]]);
});
test("guests and staff without reservation access cannot exclude bookings from availability",async()=>{
 for(const [options,status]of[[{staff:false},401],[{permission:false},403]]){
  const h=harness(options);assert.equal((await h.get("&excludeReservationId="+id)).status,status);assert.equal(h.reads(),0);
 }
 const h=harness();assert.equal((await h.get("&excludeReservationId=invalid")).status,400);assert.equal(h.reads(),0);
});
