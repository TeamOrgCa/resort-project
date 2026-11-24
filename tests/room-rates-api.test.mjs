import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
function harness(admin=true,error=null){
  const calls=[];
  const route=loadTsModule("app/api/admin/catalog/room-rates/route.ts",{
    "@/lib/server/admin-audit":{requireAdminStaff:async()=>admin?{staffUser:{id:"validated-admin"}}:null},
    "@/lib/supabase/admin":{createAdminClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return{data:args.p_rates,error};}})},
  });
  return{...route,calls};
}
const body={classificationId:"11111111-1111-4111-8111-111111111111",expectedVersion:1,rates:{rate_3_hours:300,rate_12_hours:900,extension_hourly_rate:150,additional_guest_rate:100}};
const request=b=>new Request("http://localhost/api/admin/catalog/room-rates",{method:"POST",body:JSON.stringify(b)});
test("room catalog rates require an admin and validate positive cent-denominated rates",async()=>{
  const denied=harness(false);assert.equal((await denied.POST(request(body))).status,403);assert.equal(denied.calls.length,0);
  const h=harness();for(const bad of [{...body,expectedVersion:0},{...body,rates:{...body.rates,rate_3_hours:0}},{...body,rates:{...body.rates,extension_hourly_rate:1.001}}])assert.equal((await h.POST(request(bad))).status,400);
  assert.equal(h.calls.length,0);assert.equal((await h.POST(request({...body,staffId:"forged"}))).status,200);
  assert.equal(h.calls[0].args.p_staff,"validated-admin");assert.equal(h.calls[0].args.p_version,1);
});
test("room rate publication exposes stale-version conflicts",async()=>{
  const h=harness(true,{code:"40001",message:"Room rates changed. Reload rates before saving"});
  const response=await h.POST(request(body));assert.equal(response.status,409);assert.match((await response.json()).message,/Reload/);
});
