import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTsModule } from './helpers/load-ts-module.mjs';
import { swimmingRoomCatalog, standardId } from './helpers/swimming-rooms.mjs';
const { swimmingRoomPrice, swimmingRoomsQuote, parseSwimmingRooms }=loadTsModule('lib/booking/swimming-rooms.ts');
const c=swimmingRoomCatalog.classifications[0],start='2030-06-01T08:00:00+08:00',end=hours=>new Date(Date.parse(start)+hours*3600000).toISOString();
test('swimming room quotes use existing rates for the full session, including rounded-up extension hours',()=>{
 for(const [hours,amount] of [[1,300],[3,300],[5,600],[8,600],[12,600],[12.5,700],[22,1600],[24,1800]]) assert.equal(swimmingRoomPrice(c,start,end(hours)),amount);
 for(const hours of [0,-1,25])assert.throws(()=>swimmingRoomPrice(c,start,end(hours)));
});
test('private packages use their dedicated pair while all paid room choices exclude the protected rooms',()=>{
 const choice={classificationId:standardId,quantity:8,pricingVersion:1};
 assert.equal(swimmingRoomsQuote(swimmingRoomCatalog,[choice],start,end(8),true).total,4800);
 assert.throws(()=>swimmingRoomsQuote(swimmingRoomCatalog,[{...choice,quantity:9}],start,end(8),true),/Not enough/);
 assert.throws(()=>swimmingRoomsQuote(swimmingRoomCatalog,[{...choice,quantity:9}],start,end(8),false),/Not enough/);
 assert.equal(swimmingRoomsQuote(swimmingRoomCatalog,[choice],start,end(8),false).total,4800);
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
 assert.equal((await helpers.quoteSwimmingRooms([choice],start,end(8))).total,600);
 await helpers.finalizeSwimmingRooms('booking','owner',[choice],'PROMO',8100,8100);
 assert.deepEqual(calls.map(c=>c.name),['room_guest_catalog','swimming_finalize_booking']);
 assert.deepEqual(calls[1].args,{p_reservation:'booking',p_actor:'owner',p_rooms:[choice],p_code:'PROMO',p_expected_gross:8100,p_expected_net:8100});
 const failed=loadTsModule('lib/server/swimming-rooms.ts',{'@/lib/supabase/admin':{createAdminClient:()=>({rpc:async()=>({error:{code:'40001',message:'Room rates changed'}})})}});
 await assert.rejects(()=>failed.finalizeSwimmingRooms('booking','owner',[choice],null,8100,8100),e=>e instanceof failed.SwimmingRoomsError&&e.status===409);
});
