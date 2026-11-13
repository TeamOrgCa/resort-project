import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { catalogDatabase, uuid } from "./helpers/catalog-database.mjs";
import { legalPoliciesFixture } from "./helpers/legal-policies.mjs";

const fixture=legalPoliciesFixture();
const rows=[fixture.terms,fixture.privacy];
function publicRoute({user={id:uuid(1)},bookings=[],rpcError=null}={}){
  const calls=[],client=catalogDatabase({reservations:bookings});
  client.auth={getUser:async()=>({data:{user}})};
  client.rpc=async(name,args)=>{calls.push({name,args});return {data:rows,error:rpcError};};
  const GET=loadTsModule("app/api/legal-policies/route.ts",{"@/lib/supabase/server":{createClient:async()=>client}}).GET;
  return {calls,get:(id)=>GET(new Request("http://localhost/api/legal-policies"+(id?"?reservationId="+id:"")))};
}
test("public policy reader loads current documents without caching and fails closed if migration is missing",async()=>{
  const h=publicRoute({user:null}),response=await h.get();
  assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");
  assert.equal((await response.json()).policies.version,fixture.version);
  assert.deepEqual(h.calls[0].args,{p_terms_id:null,p_privacy_id:null});
  const failed=await publicRoute({rpcError:{code:"PGRST202"}}).get();
  assert.equal(failed.status,503);assert.equal((await failed.json()).policies,undefined);
});
test("booking policy lookup authenticates ownership and requests the saved legal IDs",async()=>{
  const reservation={reservation_id:uuid(2),guest_id:uuid(1),terms_policy_id:fixture.terms.policy_id,privacy_policy_id:fixture.privacy.policy_id};
  assert.equal((await publicRoute({user:null,bookings:[reservation]}).get(uuid(2))).status,401);
  assert.equal((await publicRoute({user:{id:uuid(3)},bookings:[reservation]}).get(uuid(2))).status,404);
  const h=publicRoute({bookings:[reservation]}),response=await h.get(uuid(2));
  assert.equal(response.status,200);assert.equal((await response.json()).policies.legacy,false);
  assert.deepEqual(h.calls[0].args,{p_terms_id:fixture.terms.policy_id,p_privacy_id:fixture.privacy.policy_id});
});
test("legacy bookings request original baseline documents without claiming recorded acceptance",async()=>{
  const h=publicRoute({bookings:[{reservation_id:uuid(2),guest_id:uuid(1)}]});
  const response=await h.get(uuid(2));assert.equal(response.status,200);
  assert.equal((await response.json()).policies.legacy,true);
  assert.equal(h.calls[0].name,"get_baseline_legal_policies");
  assert.equal(h.calls[1].args.p_terms_id,fixture.terms.policy_id);
});
function adminRoute({allowed=true,error=null}={}){
  const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:{...fixture.terms,version:2},error};}};
  const {POST}=loadTsModule("app/api/admin/legal-policies/route.ts",{"@/lib/server/admin-audit":{requireAdminStaff:async()=>allowed?{supabase:client}:null}});
  return {calls,post:body=>POST(new Request("http://localhost/api/admin/legal-policies",{method:"POST",body:JSON.stringify(body)}))};
}
const draft={documentType:"terms",title:"Terms and Conditions",content:"# Revised\n\nUpdated legal document for new bookings.",changeNote:"Clarify payment guidance",expectedVersion:1};
test("publishing requires administrator access and a complete revision before calling the database",async()=>{
  const denied=adminRoute({allowed:false});assert.equal((await denied.post(draft)).status,403);assert.equal(denied.calls.length,0);
  const h=adminRoute();
  for(const change of [{documentType:"general"},{changeNote:" "},{expectedVersion:0},{content:"short"}])assert.equal((await h.post({...draft,...change})).status,400);
  assert.equal(h.calls.length,0);
  const response=await h.post(draft);assert.equal(response.status,200);assert.equal((await response.json()).policy.version,2);
  assert.deepEqual(h.calls[0],{name:"publish_legal_policy",args:{p_document_type:"terms",p_title:draft.title,p_content:draft.content,p_change_note:draft.changeNote,p_expected_version:1}});
});
test("publisher exposes stale-version conflicts and database authorization failures as actionable status codes",async()=>{
  for(const [code,status] of [["40001",409],["42501",403],["22023",400],["PGRST202",503]]){
    const response=await adminRoute({error:{code,message:"Rejected publication"}}).post(draft);
    assert.equal(response.status,status);assert.notEqual((await response.json()).success,true);
  }
});
