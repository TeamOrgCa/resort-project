import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const id="11111111-1111-4111-8111-111111111111";

test("advance window uses Philippine calendar dates, includes midnight and handles leap days",async()=>{
 const {maximumBookingDate,advanceBookingIssue}=loadTsModule("lib/booking/advance-window.ts");
 assert.equal(maximumBookingDate(0,Date.parse("2026-11-18T16:00:00Z")),"2026-11-19");
 assert.equal(maximumBookingDate(1,Date.parse("2028-02-28T01:00:00Z")),"2028-02-29");
 assert.equal(advanceBookingIssue("2028-02-29","2028-02-29"),null);
 assert.match(advanceBookingIssue("2028-03-01","2028-02-29"),/only through/);
 const {loadAdvanceBookingWindow}=loadTsModule("lib/server/advance-booking.ts",{"@/lib/supabase/admin":{createAdminClient:()=>{throw Error("Unexpected client");}}});
 function client(value,error=null){const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{setting_value:value},error})};return{from:()=>q};}
 assert.deepEqual(await loadAdvanceBookingWindow(client(2),Date.parse("2026-11-18T16:00:00Z")),{maximumAdvanceBookingDays:2,maxBookingDate:"2026-11-21"});
 await assert.rejects(()=>loadAdvanceBookingWindow(client(null,{message:"Offline"})),/Unable to load/);
});

test("review moderation API requires Analytics and moderation access, validates snapshots and preserves concurrency errors",async()=>{
 const calls=[];let active=true,analytics=true,moderation=true,error=null;
 const {POST}=loadTsModule("app/api/admin/analytics/feedback/moderate/route.ts",{
  "@/lib/server/admin-audit":{requireActiveStaff:async()=>active?{staffUser:{role:"staff"},supabase:{rpc:async(name,args)=>{calls.push({name,args});return{data:{review_id:id},error};}}}:null},
  "@/lib/server/role-permissions":{staffHasPermission:async(_db,_role,permission)=>permission==="analytics"?analytics:moderation},
 });
 const body={reviewId:id,approve:true,reason:"Photo and text reviewed",expectedUpdatedAt:"2026-11-18T01:00:00Z"};
 const post=overrides=>POST(new Request("http://localhost",{method:"POST",body:JSON.stringify({...body,...overrides})}));
 active=false;assert.equal((await post({})).status,403);active=true;
 analytics=false;assert.equal((await post({})).status,403);analytics=true;
 moderation=false;assert.equal((await post({})).status,403);moderation=true;assert.equal(calls.length,0);
 for(const invalid of[{approve:"true"},{reason:" "},{expectedUpdatedAt:null},{reviewId:"bad"}])assert.equal((await post(invalid)).status,400);
 assert.equal((await post({})).status,200);assert.equal(calls[0].name,"moderate_guest_review");assert.equal(calls[0].args.p_approve,true);
 for(const [code,status]of[["40001",409],["42501",403],["P0002",404],["PGRST202",503]]){error={code,message:"Review changed"};assert.equal((await post({approve:false})).status,status);}
 const {isAdminReadOnlyRequest,apiPermission}=loadTsModule("lib/auth/role-access.ts");
 assert.equal(isAdminReadOnlyRequest("admin","/api/admin/analytics/feedback/moderate","POST"),false);
 assert.equal(apiPermission("/api/admin/analytics/feedback/moderate","POST"),"feedback_moderation");
 assert.equal(isAdminReadOnlyRequest("admin","/api/admin/reservations/id","PATCH"),true);
});

test("configuration accepts only whole advance-day limits from zero through 3650",async()=>{
 const saved=[];
 const {PATCH}=loadTsModule("app/api/admin/settings/route.ts",{
  "@/lib/server/admin-audit":{requireAdminStaff:async()=>({supabase:{}}),createAuditLog:async()=>{}},
  "@/lib/settings/settingsService":{updateSettings:async(_client,updates)=>{saved.push(updates);return{};}},
 });
 const patch=value=>PATCH(new Request("http://localhost",{method:"PATCH",body:JSON.stringify({updates:[{key:"reservation.maximum_advance_booking_days",value}]})}));
 for(const value of[-1,0.5,3651,"30",false])assert.equal((await patch(value)).status,400);
 assert.equal(saved.length,0);for(const value of[0,30,3650])assert.equal((await patch(value)).status,200);
 assert.equal(saved.length,3);
});
