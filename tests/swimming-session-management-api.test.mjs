import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTsModule } from './helpers/load-ts-module.mjs';
const { DEFAULT_SWIMMING_POLICY, parseSwimmingPolicy } = loadTsModule('lib/booking/swimming-sessions.ts');
const { DEFAULT_PACKAGE_TIMES } = loadTsModule('lib/booking/package-times.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const body={policy:DEFAULT_SWIMMING_POLICY,expectedVersion:1,times:DEFAULT_PACKAGE_TIMES,packageVersion:1,privateDays:365,
 publicTypes:['day','night'].map((mode,i)=>({type_id:id(i+1),mode,pricing_version:1,start_time:mode==='day'?'08:00':'18:00',end_time:mode==='day'?'16:00':'23:00',end_day_offset:0,max_guests:100,is_active:true}))};
function harness(admin=true,error=null){
 const calls=[];
 const route=loadTsModule('app/api/admin/swimming-sessions/route.ts',{
  '@/lib/server/admin-audit':{requireAdminStaff:async()=>admin?{supabase:{rpc:async(name,args)=>{calls.push({name,args});return {data:{...body.policy,version:2},error};}}}:null},
  '@/lib/supabase/admin':{createAdminClient:()=>{throw new Error('Not used by POST');}},
 });return{calls,post:b=>route.POST(new Request('http://localhost/api/admin/swimming-sessions',{method:'POST',body:JSON.stringify(b)})),get:route.GET};
}
test('swimming configuration requires an active administrator for reads and writes',async()=>{
 const h=harness(false);assert.equal((await h.get()).status,403);assert.equal((await h.post(body)).status,403);assert.equal(h.calls.length,0);
 const {apiPermission}=loadTsModule('lib/auth/role-access.ts');assert.equal(apiPermission('/api/admin/swimming-sessions','POST'),'configuration');
});
test('session policies, shared catalog hours and private advance setting save in one authorized action',async()=>{
 const h=harness();const r=await h.post(body);assert.equal(r.status,200);assert.equal((await r.json()).policy.version,2);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'save_swimming_policy');assert.equal(h.calls[0].args.p_expected_version,1);assert.deepEqual(h.calls[0].args.p_times,DEFAULT_PACKAGE_TIMES);
});
test('malformed policies and overlapping ranges are rejected before database writes',async()=>{
 const h=harness();for(const patch of [{policy:{...body.policy,flexibleDays:0}},{policy:{...body.policy,minimumAdvanceMinutes:1}},{publicTypes:[body.publicTypes[0],body.publicTypes[0]]},{times:{}},{privateDays:-1}])assert.equal((await h.post({...body,...patch})).status,400);
 const policy={...body.policy,overrides:[{from:'2030-01-01',to:'2030-01-03',period:'day',mode:'public_only'},{from:'2030-01-03',to:'2030-01-04',period:'day',mode:'private_only'}]};
 assert.equal(parseSwimmingPolicy(policy),null);assert.equal((await h.post({...body,policy})).status,400);assert.equal(h.calls.length,0);
});
test('configuration conflicts expose the affected reservations while stale saves return 409',async()=>{
 const conflicts=[{referenceNumber:'PS-123',reservationId:id(20),reason:'Private Only'}];
 const h=harness(true,{code:'40001',message:'Schedule conflicts with active reservations',details:JSON.stringify(conflicts)});
 const r=await h.post(body);assert.equal(r.status,409);assert.deepEqual((await r.json()).conflicts,conflicts);
});
