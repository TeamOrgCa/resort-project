
import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const guestId="22222222-2222-4222-8222-222222222222", sessionId="44444444-4444-4444-8444-444444444444";
function api({allowed=true,error=null}={}) {
  const calls=[];
  const mocks={"@/lib/server/admin-audit":{requireAdminStaff:async()=>allowed?{supabase:{rpc:async(name,args)=>{calls.push({name,args});return {data:name==="admin_guest_accounts"?{rows:[],total:0}:{id:guestId,is_active:args.p_is_active},error};}}}:null}};
  const list=loadTsModule("app/api/admin/users/guests/route.ts",mocks).GET;
  const patch=loadTsModule("app/api/admin/users/guests/[guestId]/route.ts",mocks).PATCH;
  return {calls,list:(query="")=>list(new Request("http://localhost/api/admin/users/guests"+query)),patch:(body,id=guestId)=>patch(new Request("http://localhost",{method:"PATCH",body:JSON.stringify(body)}),{params:Promise.resolve({guestId:id})})};
}
test("guest account endpoints deny non-admins before reading or changing account data",async()=>{
  const h=api({allowed:false});assert.equal((await h.list()).status,403);assert.equal((await h.patch({isActive:false,expectedActive:true})).status,403);assert.equal(h.calls.length,0);
});
test("guest account listing validates filters and passes bounded pagination through the administrator RPC",async()=>{
  const h=api();
  for(const query of ["?status=unknown","?page=-1","?page=1.5","?page=1000001","?search="+"x".repeat(201)])assert.equal((await h.list(query)).status,400);
  assert.equal(h.calls.length,0);const result=await h.list("?search=Guest&status=inactive&page=2");assert.equal(result.status,200);assert.equal(result.headers.get("cache-control"),"no-store");
  assert.deepEqual(h.calls[0],{name:"admin_guest_accounts",args:{p_search:"Guest",p_status:"inactive",p_page:2,p_page_size:10}});
});
test("status changes reject malformed values and preserve SQL authorization/conflict errors",async()=>{
  const h=api();for(const body of [{},{isActive:"false",expectedActive:true},{isActive:false},{isActive:false,expectedActive:true,reason:"x".repeat(1001)}])assert.equal((await h.patch(body)).status,400);
  assert.equal((await h.patch({isActive:false,expectedActive:true},"staff")).status,400);assert.equal(h.calls.length,0);
  const response=await h.patch({isActive:false,expectedActive:true,reason:" Access review "});assert.equal(response.status,200);assert.equal(h.calls[0].args.p_reason,"Access review");
  for(const [code,status]of [["42501",403],["P0002",404],["40001",409],["22023",400],["XX000",503]]){
    const r=await api({error:{code,message:"Rejected"}}).patch({isActive:false,expectedActive:true});assert.equal(r.status,status);
  }
});
function sessions({active=true,guest=true,profileError=null}={}) {
  let cookieOptions;const signouts=[];
  const token="header."+Buffer.from(JSON.stringify({session_id:sessionId})).toString("base64url")+".signature";
  const client={auth:{getUser:async()=>({data:{user:{id:guestId}}}),getSession:async()=>({data:{session:{access_token:token}}}),signOut:async({scope})=>{signouts.push(scope);cookieOptions?.cookies.setAll([{name:"guest-auth",value:"",options:{maxAge:0,path:"/"}}]);return {error:null};}},
    from:table=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==="staff_users"?null:guest?{is_active:active,active_session_id:sessionId}:null,error:profileError})};return q;}};
  const middleware=loadTsModule("lib/supabase/middleware.ts",{"@supabase/ssr":{createServerClient:(_url,_key,options)=>{cookieOptions=options;return client;}}}).updateSession;
  const status=loadTsModule("app/api/auth/session-status/route.ts",{"@/lib/supabase/server":{createClient:async()=>client}}).GET;
  return {signouts,status,middleware:path=>middleware(new NextRequest("http://localhost"+path))};
}
test("inactive guests are blocked on protected APIs and pages with their auth cookies cleared",async()=>{
  const h=sessions({active:false});
  const result=await h.middleware("/api/reservations/create");assert.equal(result.status,403);assert.equal((await result.json()).code,"ACCOUNT_DEACTIVATED");assert.match(result.headers.get("set-cookie"),/guest-auth=;/);
  for(const path of ["/manage","/profile","/booking/payment"]){const r=await h.middleware(path);assert.equal(r.status,307);assert.match(r.headers.get("location"),/reason=account-deactivated/);}
  assert.equal(h.signouts.length,4);
});
test("session status distinguishes inactive guests from replaced sessions while active guests retain access",async()=>{
  const inactive=await sessions({active:false}).status();assert.equal(inactive.status,401);assert.equal((await inactive.json()).status,"inactive");
  const h=sessions();const active=await h.status();assert.equal(active.status,200);assert.equal((await active.json()).status,"active");assert.equal((await h.middleware("/manage")).status,200);assert.equal(h.signouts.length,0);
});
