import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTsModule } from './helpers/load-ts-module.mjs';
import { swimmingRoomCatalog, standardId } from './helpers/swimming-rooms.mjs';
const { swimmingRoomPrice, swimmingRoomsQuote, parseSwimmingRooms }=loadTsModule('lib/booking/swimming-rooms.ts');
const c=swimmingRoomCatalog.classifications[0],start='2030-06-01T08:00:00+08:00',end=hours=>new Date(Date.parse(start)+hours*3600000).toISOString();

test('custom duration quotes honor edited hourly rates and reject unconfigured base or extension prices',()=>{
 const {swimmingRoomStayPrice}=loadTsModule('lib/booking/swimming-rooms.ts');
 const rates={...c,rate_3_hours:300,rate_8_hours:900,rate_12_hours:1200,extension_hourly_rate:150};
 for(const [hours,baseHours,extensionHours,total] of [[1,3,0,300],[3,3,0,300],[4,3,1,450],[5,3,2,600],[7,3,4,900],[8,8,0,900],[10,8,2,1200],[12,12,0,1200],[14,12,2,1500]]){
  const quote=swimmingRoomStayPrice(rates,hours);assert.equal(quote.baseHours,baseHours);assert.equal(quote.extensionHours,extensionHours);assert.equal(quote.accommodation,total);
 }
 assert.equal(swimmingRoomStayPrice({...rates,extension_hourly_rate:175},5).accommodation,650);
 assert.throws(()=>swimmingRoomStayPrice({...rates,extension_hourly_rate:0},5),/extension rate is not configured/);
 assert.throws(()=>swimmingRoomStayPrice({...rates,rate_8_hours:null},9),/8-hour room rate/);
 assert.equal(swimmingRoomStayPrice({...rates,rate_8_hours:null},5).accommodation,600);
 for(const hours of [0.5,4.5,6.25])assert.throws(()=>swimmingRoomStayPrice(rates,hours),/whole room hours/);
});

test('custom room sessions follow configured bases, extensions and exact checkout including minutes',()=>{
 const {swimmingRoomEnd,swimmingRoomDurationLabel}=loadTsModule('lib/booking/swimming-rooms.ts');
 for(const [hours,price] of [[2,300],[4,400],[6,600],[7,700],[10,600],[14,800],[22,1600]]){
  const room={classificationId:standardId,quantity:1,pricingVersion:1,occupants:2,durationHours:hours};
  const quote=swimmingRoomsQuote(swimmingRoomCatalog,[room],start,end(hours),false,2);
  assert.equal(quote.total,price);assert.equal(swimmingRoomEnd(start,end(hours),room),end(hours));
  assert.equal(swimmingRoomsQuote(swimmingRoomCatalog,[room],start,end(hours+1),false,2).total,price);
  assert.equal(swimmingRoomsQuote(swimmingRoomCatalog,[room],start,end(hours+1),true,2).total,price);
 }
 assert.equal(swimmingRoomDurationLabel(6.5),'6 hours 30 minutes');assert.equal(swimmingRoomDurationLabel(6+1/3),'6 hours 20 minutes');
});

test('five-hour room choices use a three-hour base plus two configured extension hours',()=>{
 const row={classificationId:standardId,quantity:1,pricingVersion:1,occupants:3,durationHours:5};
 const quote=swimmingRoomsQuote(swimmingRoomCatalog,[row],start,end(5),false,3);
 assert.equal(quote.total,600);assert.equal(quote.selections[0].accommodation,500);assert.equal(quote.selections[0].extensionCharge,200);assert.equal(quote.selections[0].additionalGuestCharge,100);
 assert.throws(()=>swimmingRoomsQuote(swimmingRoomCatalog,[row],start,end(5),false,2),/cannot exceed/);
 assert.equal(swimmingRoomsQuote(swimmingRoomCatalog,[row],start,end(8),false,3).total,600);
 assert.equal(swimmingRoomsQuote(swimmingRoomCatalog,[row],start,end(8),true,3).total,600);
});

test('room quotes reject guests exceeding booking admissions, including totals spread across rooms',()=>{
 const family=swimmingRoomCatalog.classifications[1];
 const row={classificationId:family.classification_id,quantity:1,pricingVersion:1,occupants:6,durationHours:8};
 for(const privateSwimming of [false,true]){
  assert.throws(()=>swimmingRoomsQuote(swimmingRoomCatalog,[row],start,end(8),privateSwimming,5),/cannot exceed/);
  assert.throws(()=>swimmingRoomsQuote(swimmingRoomCatalog,[{...row,occupants:4},{...row,occupants:2}],start,end(8),privateSwimming,5),/cannot exceed/);
  assert.equal(swimmingRoomsQuote(swimmingRoomCatalog,[{...row,occupants:4},{...row,occupants:1}],start,end(8),privateSwimming,5).selections.length,2);
 }
});
test('individual room requests retain guests and duration while rejecting incomplete or grouped entries',()=>{
 const row={classificationId:standardId,quantity:1,pricingVersion:1,occupants:3,durationHours:3};
 assert.deepEqual(parseSwimmingRooms([{...row,unitPrice:1,additionalGuestCharge:0},{...row,durationHours:12}]),[row,{...row,durationHours:12}]);
 for(const patch of [{quantity:2},{occupants:0},{occupants:2.5},{durationHours:0},{durationHours:4.5},{durationHours:25},{durationHours:"6"},{occupants:undefined},{durationHours:undefined}]) assert.equal(parseSwimmingRooms([{...row,...patch}]),null);
 assert.deepEqual(parseSwimmingRooms([{...row,durationHours:5}]),[{...row,durationHours:5}]);
 const legacy={classificationId:standardId,quantity:1,pricingVersion:1};
 assert.equal(parseSwimmingRooms([legacy,legacy]),null);assert.equal(parseSwimmingRooms([row,legacy]),null);
});
test('each room charges its selected duration and configured extras within the room capacity',()=>{
 const row={classificationId:standardId,quantity:1,pricingVersion:1,occupants:3,durationHours:3};
 const quote=swimmingRoomsQuote(swimmingRoomCatalog,[row,{...row,durationHours:8},{...row,durationHours:12}],start,end(12),false);
 assert.equal(quote.total,1600);assert.deepEqual(quote.selections.map(r=>r.unitPrice),[400,500,700]);
 assert.ok(quote.selections.every(r=>r.extraGuests===1&&r.additionalGuestCharge===100));
 assert.throws(()=>swimmingRoomsQuote(swimmingRoomCatalog,[{...row,occupants:4}],start,end(8),false),/valid guests/);
 const family=swimmingRoomCatalog.classifications[1];
 assert.equal(swimmingRoomsQuote(swimmingRoomCatalog,[{...row,classificationId:family.classification_id,occupants:6,durationHours:12}],start,end(12),false).total,1200);
 const freeExtras={...swimmingRoomCatalog,classifications:swimmingRoomCatalog.classifications.map(c=>({...c,additional_guest_rate:0}))};
 assert.equal(swimmingRoomsQuote(freeExtras,[row],start,end(8),false).total,300);
});
test('mixed durations reserve long stays first within the pool interval',()=>{
 const row={classificationId:standardId,quantity:1,pricingVersion:1,occupants:1,durationHours:3};
 const catalog={...swimmingRoomCatalog,rooms:[
  {room_id:'short',classification_id:standardId,unavailable:false,blocks:[{start_datetime:end(9),end_datetime:end(15)}]},
  {room_id:'long',classification_id:standardId,unavailable:false,blocks:[]},
 ]};
 assert.equal(swimmingRoomsQuote(catalog,[row,{...row,durationHours:12}],start,end(12),false).total,900);
 assert.throws(()=>swimmingRoomsQuote(catalog,[{...row,durationHours:12},{...row,durationHours:12}],start,end(12),false),/Not enough/);
});
test('swimming room quotes use existing rates for the full session, including rounded-up extension hours',()=>{
 for(const [hours,amount] of [[1,300],[3,300],[3.01,400],[5,400],[8,400],[8.01,600],[12,600],[12.5,700],[22,1600],[24,1800]]) assert.equal(swimmingRoomPrice(c,start,end(hours)),amount);
 for(const hours of [0,-1,25])assert.throws(()=>swimmingRoomPrice(c,start,end(hours)));
});
test('private packages use their dedicated pair while all paid room choices exclude the protected rooms',()=>{
 const choice={classificationId:standardId,quantity:8,pricingVersion:1};
 assert.equal(swimmingRoomsQuote(swimmingRoomCatalog,[choice],start,end(8),true).total,3200);
 assert.throws(()=>swimmingRoomsQuote(swimmingRoomCatalog,[{...choice,quantity:9}],start,end(8),true),/Not enough/);
 assert.throws(()=>swimmingRoomsQuote(swimmingRoomCatalog,[{...choice,quantity:9}],start,end(8),false),/Not enough/);
 assert.equal(swimmingRoomsQuote(swimmingRoomCatalog,[choice],start,end(8),false).total,3200);
 const onlyDedicated={...swimmingRoomCatalog,rooms:swimmingRoomCatalog.rooms.filter(r=>r.private_swimming_only)};
 assert.equal(swimmingRoomsQuote(onlyDedicated,[],start,end(8),true).total,0);
 assert.throws(()=>swimmingRoomsQuote(onlyDedicated,[{...choice,quantity:1}],start,end(8),false),/Not enough/);
 const shortage={...swimmingRoomCatalog,rooms:swimmingRoomCatalog.rooms.slice(0,1)};
 assert.throws(()=>swimmingRoomsQuote(shortage,[],start,end(8),true),/included Standard rooms are unavailable/);
 assert.equal(swimmingRoomsQuote(shortage,[],start,end(8),false).total,0);
 assert.throws(()=>swimmingRoomsQuote(swimmingRoomCatalog,[{...choice,pricingVersion:2}],start,end(8),false),/rates changed/);
 assert.deepEqual(parseSwimmingRooms([{...choice,unitPrice:1}]),[choice]);
});
test('server room finalization uses authoritative inventory and one atomic room/promo RPC',async()=>{
 const calls=[],choice={classificationId:standardId,quantity:1,pricingVersion:1};
 const helpers=loadTsModule('lib/server/swimming-rooms.ts',{'@/lib/supabase/admin':{createAdminClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return{data:name==='room_guest_catalog'?swimmingRoomCatalog:{totalAmount:8100},error:null};}})}});
 assert.equal((await helpers.quoteSwimmingRooms([choice],start,end(8),5)).total,400);
 await helpers.finalizeSwimmingRooms('booking','owner',[choice],'PROMO',8100,8100);
 assert.deepEqual(calls.map(c=>c.name),['room_guest_catalog','swimming_finalize_booking']);
 assert.deepEqual(calls[1].args,{p_reservation:'booking',p_actor:'owner',p_rooms:[choice],p_code:'PROMO',p_expected_gross:8100,p_expected_net:8100});
 const failed=loadTsModule('lib/server/swimming-rooms.ts',{'@/lib/supabase/admin':{createAdminClient:()=>({rpc:async()=>({error:{code:'40001',message:'Room rates changed'}})})}});
 await assert.rejects(()=>failed.finalizeSwimmingRooms('booking','owner',[choice],null,8100,8100),e=>e instanceof failed.SwimmingRoomsError&&e.status===409);
});


test('private eligibility is sent only to the new atomic discount RPC signature', async () => {
  const calls = [];
  const helpers = loadTsModule('lib/server/swimming-rooms.ts', { '@/lib/supabase/admin': { createAdminClient: () => ({ rpc: async (name,args) => { calls.push({name,args}); return {data:{totalAmount:7600},error:null}; } }) } });
  await helpers.finalizeSwimmingRooms('booking','owner',[],null,8100,7600,5);
  assert.equal(calls[0].args.p_eligible,5);
  const failed = loadTsModule('lib/server/swimming-rooms.ts', { '@/lib/supabase/admin': { createAdminClient: () => ({ rpc: async () => ({error:{code:'PGRST202'}}) }) } });
  await assert.rejects(() => failed.finalizeSwimmingRooms('booking','owner',[],null,8100,7600,5), /private-swimming-discounts-migration/);
});

 test('additional rooms cannot exceed public or private swimming duration',()=>{
  for(const privateSwimming of [false,true]) for(const hours of [3,5,8,12,22]) {
   const row={classificationId:standardId,quantity:1,pricingVersion:1,occupants:2};
   for(const durationHours of [3,8,12]) {
    const quote=()=>swimmingRoomsQuote(swimmingRoomCatalog,[{...row,durationHours}],start,end(hours),privateSwimming);
    if(durationHours>hours)assert.throws(quote,/must end within the swimming session/);else assert.ok(quote().total>0);
   }
  }
 });
