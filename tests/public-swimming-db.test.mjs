import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRoomDatabase } from "./helpers/room-database.mjs";
let db;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const denied=code=>e=>e.code===code;
before(async()=>{
  db=await createRoomDatabase();
  await db.exec("alter table reservations add column updated_at timestamptz default now();alter table reservation_reschedules add column reschedule_id uuid default gen_random_uuid(),add column requested_by uuid,add column old_start timestamptz,add column old_end timestamptz,add column new_start timestamptz,add column new_end timestamptz,add column reschedule_fee numeric,add column rate_adjustment numeric,add column approved_by uuid,add column approved_at timestamptz,add column created_at timestamptz,add column reason text;");
  const policy=readFileSync("docs/reschedule-policy-migration.sql","utf8"),start=policy.indexOf("create or replace function public.reschedule_policy_snapshot(");
  await db.exec(policy.slice(start,policy.indexOf("$$;",start)+3));
  await db.exec("create table reservation_reschedule_adjustments(reservation_id uuid,old_start timestamptz,old_end timestamptz,new_start timestamptz,new_end timestamptz,notice_fee numeric,rate_adjustment numeric,policy_snapshot jsonb,late_exception boolean,reason text,staff_id uuid)");
  const discounts=readFileSync("docs/guest-discounts-promos-refund-details-migration.sql","utf8"),discountStart=discounts.indexOf("create or replace function public.assert_booking_discount_snapshot(");
  await db.exec(discounts.slice(discountStart,discounts.indexOf("$$;",discountStart)+3));
  await db.exec(readFileSync("docs/public-swimming-booking-migration.sql","utf8"));
  await db.exec(readFileSync("docs/public-swimming-booking-migration.sql","utf8"));
});
after(async()=>db?.close());
beforeEach(async()=>{
  await db.exec("reset role;truncate reservations,room_activity,room_charges,room_extensions,room_assignments,guests,staff_users,services,promo_codes,promo_redemptions,maintenance_blocks,transactions,payments,audit_logs,notifications,reservation_services,reservation_reschedules,refund_requests cascade;update public_swimming_types set is_active=true,max_guests=null,adult_rate=case mode when 'day' then 150 else 200 end,child_rate=case mode when 'day' then 120 else 180 end;");
  await db.query("insert into guests(id,first_name,last_name,is_active) values($1,'Customer','Guest',true)",[id(100)]);
  await db.query("insert into staff_users values($1,'Manager','staff',true),($2,'Cashier','cashier',true)",[id(1),id(2)]);
  await db.exec("insert into role_permissions(role,permissions) values('staff',array['rooms','reservations','create_reservation','edit_reservation']) on conflict(role) do update set permissions=excluded.permissions");
});
const slots=async()=> (await db.query("select * from public_booking_slots()")).rows.map(s=>({...s,booking_date:s.booking_date instanceof Date?s.booking_date.toISOString().slice(0,10):s.booking_date}));
async function input(patch={}) {
  const slot=(await slots())[0],type=await one("select * from public_swimming_types where type_id=$1",[slot.type_id]);
  return { typeId:type.type_id,pricingVersion:Number(type.pricing_version),startDatetime:slot.starts_at,endDatetime:slot.ends_at,
    adultCount:2,childCount:1,eligibleGuests:0,promoCode:null,selectedServices:[],expectedTotal:Number(type.adult_rate)*2+Number(type.child_rate),
    firstName:'Customer',lastName:'Guest',phone:'+639171234567',address:'Street, City, Province, 1234',bookingPolicyVersion:1,termsPolicyId:id(200),privacyPolicyId:id(201),...patch };
}
const save=async(body,request=id(150),actor=id(100),staff=false)=>(await one("select public_reserve($1,$2,$3::jsonb,$4) r",[actor,request,JSON.stringify(body),staff])).r;
test("public catalog seeds the image's Day/Night prices and sessions without inventing a capacity",async()=>{
  const types=(await db.query("select mode,start_time::text,end_time::text,adult_rate,child_rate,max_guests from public_swimming_types order by mode")).rows;
  assert.deepEqual(types.map(t=>[t.mode,t.start_time,t.end_time,Number(t.adult_rate),Number(t.child_rate),t.max_guests]),[['day','08:00:00','16:00:00',150,120,null],['night','16:00:00','23:00:00',200,180,null]]);
});
test("public window spans three consecutive dates, retaining a blocked middle day rather than extending the window",async()=>{
  const first=(await slots())[0].booking_date,second=new Date(Date.parse(first+'T00:00:00Z')+86400000).toISOString().slice(0,10),third=new Date(Date.parse(first+'T00:00:00Z')+2*86400000).toISOString().slice(0,10);
  await db.query("insert into maintenance_blocks(start_datetime,end_datetime,status) values($1::timestamptz,$1::timestamptz+interval '1 day','active')",[second+'T00:00:00+08:00']);
  const days=[...new Set((await slots()).map(s=>s.booking_date))];assert.deepEqual(days,[first,third]);
  const body=await input();body.startDatetime=new Date(Date.parse(body.startDatetime)+3*86400000).toISOString();body.endDatetime=new Date(Date.parse(body.endDatetime)+3*86400000).toISOString();
  await assert.rejects(()=>save(body),denied('40001'));
});
test("multiple public bookings share a session, while private exclusivity and physical room inventory remain separate",async()=>{
  const body=await input();await save(body);await save(body,id(151));
  assert.equal((await one("select count(*)::int n from reservations")).n,2);
  await assert.rejects(()=>db.query("insert into reservations(reference_number,commercial_type,start_datetime,end_datetime,adult_count,child_count,status) values('PRIVATE','private_swimming',$1,$2,2,0,'confirmed')",[body.startDatetime,body.endDatetime]),denied('40001'));
  await db.query("insert into reservations(reference_number,commercial_type,start_datetime,end_datetime,adult_count,child_count,status) values('ROOM','room_accommodation',$1,$2,2,0,'confirmed')",[body.startDatetime,body.endDatetime]);
});
test("booking rejects altered prices, stale sessions, capacity shortages and excess rental hours atomically",async()=>{
  const body=await input();
  await assert.rejects(()=>save({...body,expectedTotal:1}),denied('40001'));
  await assert.rejects(()=>save({...body,pricingVersion:body.pricingVersion-1}),denied('40001'));
  await db.query("insert into services(service_id,name,price,billing_type,max_quantity,is_active) values($1,'Videoke',100,'duration',24,true)",[id(90)]);
  await assert.rejects(()=>save({...body,selectedServices:[{serviceId:id(90),quantity:9}]}),denied('22023'));
  await db.query("update public_swimming_types set max_guests=2 where type_id=$1",[body.typeId]);
  const latest=await input();await assert.rejects(()=>save(latest),denied('40001'));
  assert.equal((await one("select count(*)::int n from reservations")).n,0);
});
test("PWD/senior and promo discounts never stack, and full balance payment is enforced",async()=>{
  await db.exec("insert into promo_codes(code,discount_type,discount_value) values('PUBLIC20','percent',20)");
  const body=await input({eligibleGuests:1,promoCode:'PUBLIC20'});body.expectedTotal=Math.round(body.expectedTotal*.8*100)/100;
  const result=await save(body),bill=await one("select * from transactions where reservation_id=$1",[result.id]);
  assert.equal(bill.discount_kind,'promo');assert.equal(Number(bill.total_amount),body.expectedTotal);
  await assert.rejects(()=>db.query("insert into payments(reservation_id,amount,status,payment_type) values($1,1,'pending','downpayment')",[result.id]),denied('22023'));
  await assert.rejects(()=>db.query("insert into payments(reservation_id,amount,status,payment_type) values($1,1,'pending','additional')",[result.id]),denied('22023'));
  await db.query("insert into payments(reservation_id,amount,status,payment_type) values($1,$2,'pending','full')",[result.id,body.expectedTotal]);
});
test("public save is idempotent and staff creation rejects cashiers",async()=>{
  const body=await input(),first=await save(body),retry=await save(body);assert.equal(first.id,retry.id);
  await assert.rejects(()=>save({...body,childCount:2}),denied('40001'));
  await assert.rejects(()=>save({...body,staffActor:id(2)},id(151),id(2),true),denied('42501'));
});
async function snapshot(reservation) {
  const r=await one("select * from reservations where reservation_id=$1",[reservation]),t=await one("select * from transactions where reservation_id=$1",[reservation]);
  return {updatedAt:r.updated_at,totalAmount:Number(t.total_amount),paidAmount:Number(t.paid_amount),discount:{amount:Number(t.discount_amount),eligible:Number(t.discount_eligible_guests),code:t.discount_promo_code,type:t.discount_promo_type,value:Number(t.discount_promo_value)}};
}
test("public guest edits reprice adults and children at booked prices and reject ownership or stale snapshots",async()=>{
  const body=await input(),created=await save(body),before=await snapshot(created.id),type=await one("select adult_rate from public_swimming_types where type_id=$1",[body.typeId]);
  const patch={adultCount:3,childCount:1,services:[],expectedTotal:body.expectedTotal+Number(type.adult_rate)};
  const changed=(await one("select public_edit_booking($1,$2,$3::jsonb,$4::jsonb) r",[created.id,id(100),JSON.stringify(before),JSON.stringify(patch)])).r;
  assert.equal(Number(changed.totalAmount),patch.expectedTotal);assert.equal(changed.adultCount,3);assert.equal(changed.childCount,1);
  await assert.rejects(()=>one("select public_edit_booking($1,$2,$3::jsonb,$4::jsonb)",[created.id,id(100),JSON.stringify(before),JSON.stringify(patch)]),denied('40001'));
  await assert.rejects(()=>one("select public_edit_booking($1,$2,$3::jsonb,$4::jsonb)",[created.id,id(101),JSON.stringify(before),JSON.stringify(patch)]),denied('42501'));
});
test("public reschedules preserve admission rates, apply only the existing notice fee and retain immutable history",async()=>{
  const body=await input(),created=await save(body);
  await db.query("update reservations set status='confirmed' where reservation_id=$1",[created.id]);
  const start=new Date(Date.parse(body.startDatetime)+86400000).toISOString(),end=new Date(Date.parse(body.endDatetime)+86400000).toISOString();
  const fee=Number((await one("select reschedule_policy_snapshot($1) p",[body.startDatetime])).p.noticeFee);
  const result=(await one("select public_reschedule_booking($1,$2,$3,$4,$5,$6,'Guest requested another public date') r",[created.id,id(100),start,end,body.startDatetime,fee])).r;
  assert.equal(Number(result.totalAmount),body.expectedTotal+fee);assert.equal(Number(result.rateAdjustment),0);
  assert.equal((await one("select count(*)::int n from reservation_reschedules where status='approved'")).n,1);
  assert.equal(Date.parse((await one("select start_datetime from reservations where reservation_id=$1",[created.id])).start_datetime),Date.parse(start));
});
test("authorized managers create public walk-ins and atomically edit their counts and schedule",async()=>{
  const body=await input({staffActor:id(1)}),created=await save(body,id(150),id(1),true);
  const booking=await one("select * from reservations where reservation_id=$1",[created.id]);assert.equal(booking.guest_id,null);assert.ok(booking.walk_in_guest_id);assert.equal(booking.booking_type,'walk_in');
  await db.query("update reservations set status='confirmed' where reservation_id=$1",[created.id]);
  const before=await snapshot(created.id),fee=Number((await one("select reschedule_policy_snapshot($1) p",[body.startDatetime])).p.noticeFee),type=await one("select * from public_swimming_types where type_id=$1",[body.typeId]);
  const patch={adultCount:3,childCount:1,services:[],bookingMode:type.mode,startDatetime:new Date(Date.parse(body.startDatetime)+86400000).toISOString(),endDatetime:new Date(Date.parse(body.endDatetime)+86400000).toISOString(),expectedTotal:body.expectedTotal+Number(type.adult_rate)+fee,reason:'Guest requested another public date',specialRequests:'Changed notes'};
  const result=(await one("select public_staff_edit_booking($1,$2,$3::jsonb,$4::jsonb) r",[created.id,id(1),JSON.stringify(before),JSON.stringify(patch)])).r;
  assert.equal(Number(result.totalAmount),patch.expectedTotal);assert.equal((await one("select count(*)::int n from reservation_reschedule_adjustments")).n,1);assert.equal((await one("select special_requests from reservations where reservation_id=$1",[created.id])).special_requests,'Changed notes');
});
test("expired public holds cannot be confirmed after their pool interval has been claimed privately",async()=>{
 const body=await input(),created=await save(body);
 await db.query("update reservations set payment_deadline_at=clock_timestamp()-interval '1 second' where reservation_id=$1",[created.id]);
 await db.query("insert into reservations(reference_number,commercial_type,start_datetime,end_datetime,adult_count,child_count,status) values('PRIVATE-RECLAIM','private_swimming',$1,$2,2,0,'confirmed')",[body.startDatetime,body.endDatetime]);
 await assert.rejects(()=>db.query("update reservations set status='confirmed' where reservation_id=$1",[created.id]),denied('40001'));
});
