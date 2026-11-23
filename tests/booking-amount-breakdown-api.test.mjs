import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTsModule } from './helpers/load-ts-module.mjs';
const id='33333333-3333-4333-8333-333333333333';
function harness({ authenticated=true, owned=true, failure=false }={}) {
  let adminReads=0;const filters=[];
  const data={
    transactions:{total_amount:4100,paid_amount:1000,balance:3100},
    reservation_services:[{quantity:2,price_at_time:100,services:{name:'Extra table'}}],
    reservation_reschedules:[{reschedule_fee:500,rate_adjustment:200}],
    reservation_reschedule_adjustments:[{notice_fee:100,rate_adjustment:100}],
  };
  const route=loadTsModule('app/api/reservations/billing-breakdown/route.ts',{
    '@/lib/supabase/server':{createClient:async()=>({
      auth:{getUser:async()=>({data:{user:authenticated?{id:'guest'}:null},error:null})},
      from:()=>{const q={select:()=>q,eq:(...args)=>{filters.push(args);return q;},maybeSingle:async()=>({error:null,data:owned?{booking_mode:'day',start_datetime:'2027-01-01T08:00:00+08:00',end_datetime:'2027-01-01T16:00:00+08:00',adult_count:3,child_count:1}:null})};return q;},
    })},
    '@/lib/supabase/admin':{createAdminClient:()=>{adminReads++;return {from:table=>{const q={select:()=>q,eq:(...args)=>{filters.push([table,...args]);return q;},maybeSingle:()=>q,then:resolve=>resolve({data:data[table],error:failure?{message:'Unavailable'}:null})};return q;}};}},
  });
  return { data,get:()=>route.GET(new Request('http://localhost/api/reservations/billing-breakdown?reservationId='+id)),filters,reads:()=>adminReads };
}
test('amount breakdown requires ownership before reading private reschedule history',async()=>{
  for(const [options,status] of [[{authenticated:false},401],[{owned:false},403]]) {
    const h=harness(options);assert.equal((await h.get()).status,status);assert.equal(h.reads(),0);
  }
});
test('bill separately reconciles package, services, guest/staff fees and rate changes to the stored total',async()=>{
  const h=harness();const response=await h.get();assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  const result=await response.json();
  assert.deepEqual(result.breakdown.lines.map(line=>line.amount),[3000,200,600,300]);
  assert.equal(result.breakdown.lines.reduce((sum,line)=>sum+line.amount,0),4100);
  assert.ok(h.filters.some(f=>f[0]==='guest_id'&&f[1]==='guest'));
  assert.ok(h.filters.some(f=>f[0]==='reservation_reschedules'&&f[1]==='status'&&f[2]==='approved'));
  assert.equal(JSON.stringify(result).includes('staff_id'),false);
});
test('failed charge queries show an error instead of silently treating fees as zero',async()=>{
  const response=await harness({failure:true}).get();assert.equal(response.status,503);
  assert.equal((await response.json()).breakdown,undefined);
});

test('customer bills disclose the applied promo code or eligible PWD guest count and reconcile savings',async()=>{
  for(const kind of ['promo','pwd_senior']) {
    const h=harness();Object.assign(h.data.transactions,{total_amount:3900,discount_amount:200,discount_kind:kind,
      discount_promo_code:'SAVE10',discount_promo_type:'percent',discount_promo_value:10,discount_eligible_guests:2,discount_package_price:2000});
    const response=await h.get();assert.equal(response.status,200);
    const {breakdown}=await response.json(),line=breakdown.lines.find(line=>line.kind==='discount');
    assert.equal(line.amount,-200);assert.equal(breakdown.lines.reduce((sum,line)=>sum+line.amount,0),3900);
    if(kind==='promo')assert.match(line.description,/SAVE10/);
    else {assert.match(line.detail,/2 of 4 guests eligible/);assert.doesNotMatch(line.description+line.detail,/SAVE10/);}
  }
});
