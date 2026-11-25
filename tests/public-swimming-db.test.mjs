import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRoomDatabase } from "./helpers/room-database.mjs";
let db;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const denied=code=>e=>e.code===code;
const addDays=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const today=async()=>String((await one("select (clock_timestamp() at time zone 'Asia/Manila')::date::text d")).d);
async function calendar(from,to=from,now=null) {
  return (await db.query("select c.*,t.mode from public_swimming_calendar($1::date,$2::date,null,coalesce($3::timestamptz,clock_timestamp())) c join public_swimming_types t using(type_id) order by booking_date,mode",[from,to,now])).rows;
}
before(async()=>{
  db=await createRoomDatabase();
  // Include the deployed private-package trigger. Without it this fixture
  // cannot reproduce the public-night/private-overnight schedule conflict.
  const packageTimes=readFileSync('docs/package-times-migration.sql','utf8');
  await db.exec(`alter table package_rate_versions add column times jsonb;
    insert into package_rate_versions(version,rates,times) values(1,'{}',
      '{"day":{"start":"08:00","end":"16:00","endDayOffset":0},"night":{"start":"18:00","end":"06:00","endDayOffset":1},"whole_day":{"day_to_night":{"start":"08:00","end":"06:00","endDayOffset":1},"night_to_day":{"start":"18:00","end":"16:00","endDayOffset":1}}}');`);
  for(const name of ['matches_package_slot','set_reservation_package_rate_version']) {
    const start=packageTimes.indexOf('create or replace function public.'+name+'(');
    await db.exec(packageTimes.slice(start,packageTimes.indexOf('$$;',start)+3));
  }
  await db.exec('create trigger reservation_package_rate_version before insert or update of package_rate_version on reservations for each row execute function public.set_reservation_package_rate_version()');
  await db.exec("alter table reservations add column updated_at timestamptz default now();alter table reservation_reschedules add column reschedule_id uuid default gen_random_uuid(),add column requested_by uuid,add column old_start timestamptz,add column old_end timestamptz,add column new_start timestamptz,add column new_end timestamptz,add column reschedule_fee numeric,add column rate_adjustment numeric,add column approved_by uuid,add column approved_at timestamptz,add column created_at timestamptz,add column reason text;");
  const policy=readFileSync("docs/reschedule-policy-migration.sql","utf8"),start=policy.indexOf("create or replace function public.reschedule_policy_snapshot(");
  await db.exec(policy.slice(start,policy.indexOf("$$;",start)+3));
  await db.exec("create table reservation_reschedule_adjustments(reservation_id uuid,old_start timestamptz,old_end timestamptz,new_start timestamptz,new_end timestamptz,notice_fee numeric,rate_adjustment numeric,policy_snapshot jsonb,late_exception boolean,reason text,staff_id uuid)");
  const discounts=readFileSync("docs/guest-discounts-promos-refund-details-migration.sql","utf8"),discountStart=discounts.indexOf("create or replace function public.assert_booking_discount_snapshot(");
  await db.exec(discounts.slice(discountStart,discounts.indexOf("$$;",discountStart)+3));
  await db.exec(readFileSync("docs/public-swimming-booking-migration.sql","utf8"));
  await db.exec(readFileSync("docs/public-swimming-booking-migration.sql","utf8"));
  await db.exec("create table business_settings(setting_key text primary key,setting_value jsonb);insert into business_settings values('reservation.maximum_advance_booking_days','365')");
  await db.exec(readFileSync('docs/advance-booking-window-migration.sql','utf8'));
  await db.exec(readFileSync("docs/public-swimming-calendar-migration.sql","utf8"));
  await db.exec(readFileSync("docs/public-swimming-calendar-migration.sql","utf8"));
  await db.exec(readFileSync('docs/public-swimming-package-validation-migration.sql','utf8'));
  await db.exec(readFileSync('docs/public-swimming-package-validation-migration.sql','utf8'));
  await db.exec(readFileSync('docs/swimming-room-addons-migration.sql','utf8'));
  await db.exec(readFileSync('docs/swimming-room-addons-migration.sql','utf8'));
  // Upgrade with a real upcoming room-only hold. Dedication must select other
  // Standard rooms, keeping the existing guest's room and booking untouched.
  const heldDate=addDays(await today(),4);
  const existing=await one("insert into reservations(reference_number,commercial_type,room_pricing,booking_mode,status,start_datetime,end_datetime,adult_count,child_count) values('EXISTING-ROOM-HOLD','room_accommodation',true,'custom','confirmed',$1,$2,2,0) returning *",[heldDate+'T08:00:00+08:00',heldDate+'T20:00:00+08:00']);
  const heldRoom=await one("select room_id from physical_rooms where room_number='S01'");
  const heldAssignment=await one('insert into room_assignments(room_id,reservation_id,occupants,starts_at,expected_checkout) values($1,$2,2,$3,$4) returning *',[heldRoom.room_id,existing.reservation_id,existing.start_datetime,existing.end_datetime]);
  await db.exec(readFileSync('docs/private-swimming-room-reserve-migration.sql','utf8'));
  await db.exec(readFileSync('docs/private-swimming-room-reserve-migration.sql','utf8'));
  assert.deepEqual(await one('select * from reservations where reservation_id=$1',[existing.reservation_id]),existing);
  assert.deepEqual(await one('select * from room_assignments where assignment_id=$1',[heldAssignment.assignment_id]),heldAssignment);
  assert.equal((await one('select private_swimming_only from physical_rooms where room_id=$1',[heldRoom.room_id])).private_swimming_only,false);
  assert.equal((await one('select count(*)::int n from physical_rooms where private_swimming_only')).n,2);
  // Simulate the already-deployed allocator, then apply the formatting fix twice.
  const allocator=(await one("select pg_get_functiondef('public.swimming_allocate_rooms(uuid,uuid,jsonb,boolean)'::regprocedure) body")).body;
  await db.exec(allocator.replace('trim_scale(hours)::text','hours'));
  await db.exec(readFileSync('docs/room-duration-formatting-migration.sql','utf8'));
  await db.exec(readFileSync('docs/room-duration-formatting-migration.sql','utf8'));
  const lifecycle=readFileSync('docs/reservation-lifecycle-migration.sql','utf8');
  for(const name of ['accept_payment_submission','expire_unpaid_reservations']) {
    const start=lifecycle.indexOf('create or replace function public.'+name+'(');
    await db.exec(lifecycle.slice(start,lifecycle.indexOf('$$;',start)+3));
  }
  await db.exec('create trigger accept_payment_submission_trigger after insert on payments for each row execute function public.accept_payment_submission()');
});
after(async()=>db?.close());
beforeEach(async()=>{
  await db.exec("update business_settings set setting_value='365'");
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
  assert.deepEqual(types.map(t=>[t.mode,t.start_time,t.end_time,Number(t.adult_rate),Number(t.child_rate),t.max_guests]),[['day','08:00:00','16:00:00',150,120,null],['night','18:00:00','23:00:00',200,180,null]]);
});

test("public night bookings save their 6 PM to 11 PM session without private overnight validation",async()=>{
  const date=addDays(await today(),1),night=(await slots()).find(s=>s.booking_date===date&&new Date(s.starts_at).getUTCHours()===10);
  const c=await one('select * from public_swimming_types where type_id=$1',[night.type_id]);
  const body=await input({typeId:c.type_id,pricingVersion:Number(c.pricing_version),startDatetime:night.starts_at,endDatetime:night.ends_at,expectedTotal:Number(c.adult_rate)*2+Number(c.child_rate)});
  await assert.rejects(()=>save({...body,endDatetime:addDays(date,1)+'T06:00:00+08:00'}),denied('40001'));
  const created=await save(body),saved=await one('select * from reservations where reservation_id=$1',[created.id]);
  assert.equal(saved.commercial_type,'public_swimming');assert.equal(saved.package_rate_version,null);
  assert.equal(Date.parse(saved.end_datetime)-Date.parse(saved.start_datetime),5*3600000);
  assert.equal(saved.public_pricing_snapshot.mode,'night');assert.equal(saved.public_type_id,c.type_id);
});

test("public sessions use their own configuration while private slots and booked versions remain protected",async()=>{
  const date=addDays(await today(),1),privateDate=addDays(date,1);
  await db.exec(`update package_rate_versions set times=jsonb_set(times,'{day}','{"start":"09:00","end":"17:00","endDayOffset":0}') where version=1`);
  try {
    const day=(await slots()).find(s=>s.booking_date===date&&new Date(s.starts_at).getUTCHours()===0);
    const c=await one('select * from public_swimming_types where type_id=$1',[day.type_id]);
    const created=await save(await input({typeId:c.type_id,pricingVersion:Number(c.pricing_version),startDatetime:day.starts_at,endDatetime:day.ends_at,expectedTotal:Number(c.adult_rate)*2+Number(c.child_rate)}));
    assert.equal((await one('select package_rate_version from reservations where reservation_id=$1',[created.id])).package_rate_version,null);
    await assert.rejects(()=>db.query("insert into reservations(reference_number,commercial_type,booking_mode,start_datetime,end_datetime,adult_count,child_count,status) values('BAD-PRIVATE','private_swimming','day',$1,$2,2,0,'confirmed')",[privateDate+'T08:00:00+08:00',privateDate+'T16:00:00+08:00']),e=>e.code==='22023'&&/saved package time slot/.test(e.message));
    const correct=await one("insert into reservations(reference_number,commercial_type,booking_mode,start_datetime,end_datetime,adult_count,child_count,status) values('VALID-PRIVATE','private_swimming','day',$1,$2,2,0,'confirmed') returning reservation_id,package_rate_version",[privateDate+'T09:00:00+08:00',privateDate+'T17:00:00+08:00']);
    assert.equal(Number(correct.package_rate_version),1);
    await assert.rejects(()=>db.query('update reservations set package_rate_version=null where reservation_id=$1',[correct.reservation_id]),e=>e.code==='22023'&&/cannot be replaced/.test(e.message));
    await assert.rejects(()=>db.query('update reservations set package_rate_version=1 where reservation_id=$1',[created.id]),e=>e.code==='22023'&&/cannot be replaced/.test(e.message));
  } finally {
    await db.exec(`update package_rate_versions set times=jsonb_set(times,'{day}','{"start":"08:00","end":"16:00","endDayOffset":0}') where version=1`);
  }
});
test("public window spans three consecutive dates, retaining a blocked middle day rather than extending the window",async()=>{
  const first=await today(),second=addDays(first,1),third=addDays(first,2);
  await db.query("insert into maintenance_blocks(start_datetime,end_datetime,status) values($1::timestamptz,$1::timestamptz+interval '1 day','active')",[second+'T00:00:00+08:00']);
  const days=[...new Set((await slots()).map(s=>s.booking_date))];assert.ok(days.includes(third));assert.ok(!days.includes(second));assert.ok(days.every(d=>d>=first&&d<=third));
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

test("full monthly calendars expose both sessions and opening dates through month and year transitions",async()=>{
  const rows=await calendar('2030-12-01','2030-12-31','2030-12-30T06:00:00+08:00');
  assert.equal(rows.length,62);
  assert.deepEqual(rows.slice(0,2).map(s=>s.eligibility),['past','past']);
  assert.deepEqual(rows.slice(-2).map(s=>s.eligibility),['eligible','eligible']);
  const january=await calendar('2031-01-01','2031-01-02','2030-12-30T06:00:00+08:00');
  assert.deepEqual(january.map(s=>s.eligibility),['eligible','eligible','not_open','not_open']);
  assert.equal(Date.parse(january[2].opens_at),Date.parse('2030-12-31T00:00:00+08:00'));
  const nextDay=await calendar('2031-01-02','2031-01-02','2030-12-31T00:00:00+08:00');
  assert.ok(nextDay.every(s=>s.eligibility==='eligible'));
  await assert.rejects(()=>calendar('2030-01-01','2030-02-28'),denied('22023'));
});

test("same-day cutoffs are exactly 7 AM and 5 PM Manila time and affect only the applicable session",async()=>{
  for(const [now,expected] of [
    ['2030-11-25T06:59:59+08:00',['eligible','eligible']],
    ['2030-11-25T07:00:00+08:00',['eligible','eligible']],
    ['2030-11-25T07:00:01+08:00',['cutoff','eligible']],
    ['2030-11-25T17:00:00+08:00',['cutoff','eligible']],
    ['2030-11-25T17:00:01+08:00',['cutoff','cutoff']],
    ['2030-11-25T23:59:59+08:00',['cutoff','cutoff']],
  ]) assert.deepEqual((await calendar('2030-11-25','2030-11-25',now)).map(s=>s.eligibility),expected,now);
  // UTC November 24 is already November 25 in Manila.
  assert.ok((await calendar('2030-11-24','2030-11-24','2030-11-24T16:00:00Z')).every(s=>s.eligibility==='past'));
});

test("blocked today never shifts or extends the public booking window",async()=>{
  const date=await today();
  await db.query("insert into maintenance_blocks(start_datetime,end_datetime,status) values($1::timestamptz,$1::timestamptz+interval '1 day','active')",[date+'T00:00:00+08:00']);
  const open=await slots();assert.ok(open.length);assert.ok(open.every(s=>s.booking_date>date&&s.booking_date<=addDays(date,2)));
  const browse=await calendar(addDays(date,3));assert.ok(browse.every(s=>s.eligibility==='not_open'&&s.availability==='available'));
  const body=await input();const sameType=browse.find(s=>s.type_id===body.typeId);
  await assert.rejects(()=>save({...body,startDatetime:sameType.starts_at,endDatetime:sameType.ends_at}),denied('40001'));
});

test("private day and overnight sessions independently block public sessions, including next-day and whole-day overlaps",async()=>{
  const date=addDays(await today(),1);
  await db.query("insert into reservations(reference_number,commercial_type,start_datetime,end_datetime,adult_count,child_count,status) values('PRIVATE-DAY','private_swimming',$1,$2,2,0,'confirmed')",[date+'T08:00:00+08:00',date+'T16:00:00+08:00']);
  assert.deepEqual((await calendar(date)).map(s=>s.availability),['private','available']);
  await db.exec("delete from reservations");
  await db.query("insert into reservations(reference_number,commercial_type,start_datetime,end_datetime,adult_count,child_count,status) values('PRIVATE-NIGHT','private_swimming',$1,$2,2,0,'confirmed')",[date+'T18:00:00+08:00',addDays(date,1)+'T06:00:00+08:00']);
  assert.deepEqual((await calendar(date)).map(s=>s.availability),['available','private']);
  assert.ok((await calendar(addDays(date,1))).every(s=>s.availability==='available'));
  await db.exec("delete from reservations");
  await db.query("insert into reservations(reference_number,commercial_type,start_datetime,end_datetime,adult_count,child_count,status) values('PRIVATE-WHOLE','private_swimming',$1,$2,2,0,'confirmed')",[date+'T08:00:00+08:00',addDays(date,1)+'T08:00:00+08:00']);
  assert.ok((await calendar(date)).every(s=>s.availability==='private'));
});

test("maintenance blocks only overlapping sessions and public admissions prevent overlapping maintenance",async()=>{
  const date=addDays(await today(),1);
  await db.query("insert into maintenance_blocks(start_datetime,end_datetime,status) values($1,$2,'active')",[date+'T08:00:00+08:00',date+'T16:00:00+08:00']);
  assert.deepEqual((await calendar(date)).map(s=>s.availability),['maintenance','available']);
  const body=await input();await save(body);
  await assert.rejects(()=>db.query("insert into maintenance_blocks(start_datetime,end_datetime,status) values($1,$2,'active')",[body.startDatetime,body.endDatetime]),denied('40001'));
});

test("configured capacity is shared until full; expired holds release places while submitted proofs retain them",async()=>{
  const body=await input();await db.query("update public_swimming_types set max_guests=6 where type_id=$1",[body.typeId]);
  const fresh=await input(),first=await save(fresh),second=await save(fresh,id(151));
  assert.equal((await calendar(String((await one("select (start_datetime at time zone 'Asia/Manila')::date::text d from reservations where reservation_id=$1",[first.id])).d))).find(s=>s.type_id===body.typeId).availability,'full');
  await assert.rejects(()=>save(fresh,id(152)),denied('40001'));
  await db.query("update reservations set payment_deadline_at=clock_timestamp()-interval '1 second' where reservation_id=$1",[first.id]);
  assert.equal((await slots()).find(s=>s.type_id===body.typeId&&Date.parse(s.starts_at)===Date.parse(body.startDatetime)).remaining_capacity,3);
  const third=await save(fresh,id(152));
  await db.query("insert into payments(reservation_id,amount,status,payment_type) values($1,$2,'pending','full')",[second.id,fresh.expectedTotal]);
  assert.equal((await one('select status from reservations where reservation_id=$1',[second.id])).status,'payment_submitted');
  await db.query("update reservations set payment_deadline_at=clock_timestamp()-interval '1 second' where reservation_id=$1",[second.id]);
  await db.query('select expire_unpaid_reservations()');
  assert.equal((await one('select status from reservations where reservation_id=$1',[first.id])).status,'expired');
  assert.equal((await one('select status from reservations where reservation_id=$1',[second.id])).status,'payment_submitted');
  assert.ok(!(await slots()).some(s=>s.type_id===body.typeId&&Date.parse(s.starts_at)===Date.parse(body.startDatetime)));
  await db.query("update reservations set status='confirmed' where reservation_id=$1",[second.id]);
  await assert.rejects(()=>db.query("update reservations set adult_count=3 where reservation_id=$1",[third.id]),denied('40001'));
  await assert.rejects(()=>db.query("insert into reservations(reference_number,commercial_type,start_datetime,end_datetime,adult_count,child_count,status) values('PRIVATE-BLOCKED','private_swimming',$1,$2,2,0,'confirmed')",[body.startDatetime,body.endDatetime]),denied('40001'));
});

test("active private holds block public bookings and expired private holds release the overlapping session",async()=>{
  const body=await input();
  const privateBooking=await one("insert into reservations(reference_number,commercial_type,start_datetime,end_datetime,adult_count,child_count,status,payment_deadline_at) values('PRIVATE-HOLD','private_swimming',$1,$2,2,0,'pending',clock_timestamp()+interval '30 minutes') returning reservation_id",[body.startDatetime,body.endDatetime]);
  await assert.rejects(()=>save(body),denied('40001'));
  await db.query("update reservations set payment_deadline_at=clock_timestamp()-interval '1 second' where reservation_id=$1",[privateBooking.reservation_id]);
  await save(body);
  await assert.rejects(()=>db.query("update reservations set status='confirmed' where reservation_id=$1",[privateBooking.reservation_id]),denied('40001'));
});

test("browsing RPC is restricted to service role and returns no private reservation data",async()=>{
  const date=await today();
  await db.exec('set role anon');await assert.rejects(()=>calendar(date),denied('42501'));await db.exec('reset role');
  const row=(await calendar(date))[0];assert.deepEqual(Object.keys(row).sort(),['availability','booking_date','eligibility','ends_at','evaluated_at','mode','opens_at','remaining_capacity','starts_at','type_id'].sort());
});

test("disabled configured sessions stay visible with a reason while enabled sessions remain bookable",async()=>{
  const date=addDays(await today(),1);
  await db.exec("update public_swimming_types set is_active=false where mode='day'");
  const rows=await calendar(date);assert.equal(rows.length,2);
  assert.deepEqual(rows.map(s=>s.availability),['inactive','available']);assert.equal(rows[0].remaining_capacity,0);
  assert.ok(!(await slots()).some(s=>s.type_id===rows[0].type_id));
  assert.ok((await slots()).some(s=>s.type_id===rows[1].type_id));
});

test("the public three-day window is independent of the generic private and room advance limit",async()=>{
  const date=addDays(await today(),2),day=(await slots()).find(s=>s.booking_date===date);
  const c=await one('select * from public_swimming_types where type_id=$1',[day.type_id]);
  await db.exec("update business_settings set setting_value='0'");
  await save(await input({typeId:c.type_id,pricingVersion:Number(c.pricing_version),startDatetime:day.starts_at,endDatetime:day.ends_at,expectedTotal:Number(c.adult_rate)*2+Number(c.child_rate)}));
  await assert.rejects(()=>db.query("insert into reservations(reference_number,commercial_type,start_datetime,end_datetime,adult_count,child_count,status) values('PRIVATE-LIMIT','private_swimming',$1,$2,2,0,'confirmed')",[day.starts_at,day.ends_at]),denied('22023'));
});

test("migration retains custom operating hours and existing booked night timestamps",async()=>{
  const tomorrow=addDays(await today(),1),night=(await slots()).find(s=>s.booking_date===tomorrow&&(new Date(s.starts_at).getUTCHours()===10));
  const c=await one('select * from public_swimming_types where type_id=$1',[night.type_id]);
  const created=await save(await input({typeId:c.type_id,pricingVersion:Number(c.pricing_version),startDatetime:night.starts_at,endDatetime:night.ends_at,expectedTotal:Number(c.adult_rate)*2+Number(c.child_rate)}));
  await db.exec("update public_swimming_types set start_time='19:00' where mode='night'");
  await db.exec(readFileSync('docs/public-swimming-calendar-migration.sql','utf8'));
  assert.equal((await one("select start_time::text t from public_swimming_types where mode='night'")).t,'19:00:00');
  const booking=await one('select start_datetime,public_pricing_snapshot from reservations where reservation_id=$1',[created.id]);
  assert.equal(Date.parse(booking.start_datetime),Date.parse(night.starts_at));assert.equal(booking.public_pricing_snapshot.start_time,'18:00:00');
  await db.exec("update public_swimming_types set start_time='18:00' where mode='night'");
});

const roomClass=async(code='standard')=>one('select * from room_classifications where code=$1',[code]);
const roomChoice=c=>({classificationId:c.classification_id,quantity:1,pricingVersion:Number(c.pricing_version)});
test('public room add-ons allocate physical inventory, preserve admission-only discounts and retry without duplicate charges',async()=>{
  const c=await roomClass(),body=await input({promoCode:'POOL20'});
  await db.exec("insert into promo_codes(code,discount_type,discount_value) values('POOL20','percent',20)");
  body.swimmingRooms=[{...roomChoice(c),quantity:2,unitPrice:1}];
  body.expectedTotal=Math.round(body.expectedTotal*.8*100)/100+2*Number(c.rate_12_hours);
  const created=await save(body),retry=await save(body);
  assert.equal(created.id,retry.id);assert.equal(Number(created.totalAmount),body.expectedTotal);
  const assignments=(await db.query('select * from room_assignments where reservation_id=$1',[created.id])).rows;
  assert.equal(assignments.length,2);assert.equal(new Set(assignments.map(r=>r.room_id)).size,2);
  assert.ok(assignments.every(r=>r.pricing_snapshot.included===false && Date.parse(r.starts_at)===Date.parse(body.startDatetime) && Date.parse(r.expected_checkout)===Date.parse(body.endDatetime)));
  assert.equal((await one('select count(*)::int n,sum(amount) total from room_charges where reservation_id=$1',[created.id])).n,2);
  assert.equal(Number((await one('select discount_amount from transactions where reservation_id=$1',[created.id])).discount_amount),Number((await input()).expectedTotal)*.2);
  await assert.rejects(()=>save({...body,swimmingRooms:[]}),denied('40001'));
});

test('a five-hour night session saves readable room charge and notification descriptions',async()=>{
  const date=addDays(await today(),1),night=(await slots()).find(s=>s.booking_date===date&&new Date(s.starts_at).getUTCHours()===10);
  const type=await one('select * from public_swimming_types where type_id=$1',[night.type_id]),c=await roomClass();
  await db.exec("insert into role_permissions(role,permissions) values('cashier',array['transactions','payment_entry']) on conflict(role) do update set permissions=excluded.permissions");
  const created=await save(await input({typeId:type.type_id,pricingVersion:Number(type.pricing_version),startDatetime:night.starts_at,endDatetime:night.ends_at,
    swimmingRooms:[roomChoice(c)],expectedTotal:Number(type.adult_rate)*2+Number(type.child_rate)+Number(c.rate_12_hours)}));
  const charge=await one('select description,amount from room_charges where reservation_id=$1',[created.id]);
  assert.match(charge.description,/\(5 hours\)/);assert.doesNotMatch(charge.description,/5\.0/);assert.equal(Number(charge.amount),Number(c.rate_12_hours));
  const notice=await one("select message from notifications where entity_id=$1 and title='Room charge requires collection'",[created.id]);
  assert.ok(notice);assert.match(notice.message,/\(5 hours\)/);assert.doesNotMatch(notice.message,/5\.0/);
});

test('public admission without rooms allocates no rooms; stale or excessive room choices roll back the whole public save',async()=>{
  const c=await roomClass(),body=await input(),created=await save(body);
  assert.equal((await one('select count(*)::int n from room_assignments where reservation_id=$1',[created.id])).n,0);
  for(const choice of [{...roomChoice(c),pricingVersion:Number(c.pricing_version)+1},{...roomChoice(c),quantity:11}]) {
    await assert.rejects(()=>save({...body,swimmingRooms:[choice],expectedTotal:body.expectedTotal+choice.quantity*Number(c.rate_12_hours)},id(151)),denied('40001'));
  }
  assert.equal((await one('select count(*)::int n from reservations')).n,1);
  assert.equal((await one('select count(*)::int n from room_charges')).n,0);
});

test('shared room inventory enforces capacity and releases expired holds without allowing late confirmation to double book',async()=>{
  const c=await roomClass(),body=await input();body.swimmingRooms=[{...roomChoice(c),quantity:8}];body.expectedTotal+=8*Number(c.rate_12_hours);
  const first=await save(body);
  const next={...body,swimmingRooms:[roomChoice(c)],expectedTotal:body.expectedTotal-7*Number(c.rate_12_hours)};
  await assert.rejects(()=>save(next,id(151)),denied('40001'));
  await db.query("update reservations set payment_deadline_at=clock_timestamp()-interval '1 second' where reservation_id=$1",[first.id]);
  const second=await save(next,id(151));assert.ok(second.id);
  await assert.rejects(()=>db.query("update reservations set status='confirmed' where reservation_id=$1",[first.id]),denied('40001'));
  await db.query("update reservations set status='cancelled' where reservation_id=$1",[second.id]);
  assert.equal((await one("select count(*)::int n from room_assignments where reservation_id=$1 and state='cancelled'",[second.id])).n,1);
  await save(next,id(152));
});

async function privateWithRooms(mode='day') {
  const date=addDays(await today(),4),endDate=mode==='day'?date:addDays(date,1);
  const r=await one("insert into reservations(reference_number,guest_id,commercial_type,booking_mode,start_datetime,end_datetime,adult_count,child_count,status,payment_deadline_at) values('PRIVATE-ROOMS',$1,'private_swimming',$2,$3,$4,20,0,'pending',clock_timestamp()+interval '30 minutes') returning *",[id(100),mode,date+(mode==='night'?'T18:00:00+08:00':'T08:00:00+08:00'),endDate+(mode==='day'?'T16:00:00+08:00':'T06:00:00+08:00')]);
  await db.query("insert into transactions(reservation_id,total_amount,status) values($1,10000,'unpaid')",[r.reservation_id]);
  return r;
}
test('new private swimming automatically includes two Standard rooms at zero extra charge, and failed extra-room finalization rolls back charges',async()=>{
  const r=await privateWithRooms(),c=await roomClass(),rid=r.reservation_id;
  const included=(await db.query('select a.*,c.code from room_assignments a join physical_rooms p using(room_id) join room_classifications c using(classification_id) where reservation_id=$1',[rid])).rows;
  assert.equal(included.length,2);assert.ok(included.every(a=>a.code==='standard'&&a.pricing_snapshot.included===true&&a.pricing_snapshot.accommodation===0));
  assert.equal((await one('select count(*)::int n from room_charges where reservation_id=$1',[rid])).n,0);
  const choices=JSON.stringify([roomChoice(c)]),gross=10000+Number(c.rate_12_hours);
  await assert.rejects(()=>db.query('select swimming_finalize_booking($1,$2,$3::jsonb,null,$4,$4)',[rid,id(100),JSON.stringify([{...roomChoice(c),quantity:9}]),10000+9*Number(c.rate_12_hours)]),denied('40001'));
  await assert.rejects(()=>db.query('select swimming_finalize_booking($1,$2,$3::jsonb,null,$4,1)',[rid,id(100),choices,gross]),denied('40001'));
  await assert.rejects(()=>db.query("select swimming_finalize_booking($1,$2,$3::jsonb,'MISSING',$4,$4)",[rid,id(100),choices,gross]),denied('22023'));
  assert.equal((await one('select count(*)::int n from room_assignments where reservation_id=$1',[rid])).n,2);
  assert.equal((await one('select count(*)::int n from room_charges where reservation_id=$1',[rid])).n,0);
  assert.equal(Number((await one('select total_amount from transactions where reservation_id=$1',[rid])).total_amount),10000);
  const saved=await one('select swimming_finalize_booking($1,$2,$3::jsonb,null,$4,$4) r',[rid,id(100),choices,gross]);
  assert.equal(Number(saved.r.totalAmount),gross);
  await db.query('select swimming_finalize_booking($1,$2,$3::jsonb,null,$4,$4)',[rid,id(100),choices,gross]);
  assert.equal((await one('select count(*)::int n from room_assignments where reservation_id=$1',[rid])).n,3);
  assert.equal((await one('select count(*)::int n from room_charges where reservation_id=$1',[rid])).n,1);
  await db.query("update reservations set status='cancelled' where reservation_id=$1",[rid]);
  assert.equal((await one("select count(*)::int n from room_assignments where reservation_id=$1 and state='cancelled'",[rid])).n,3);
});

test('a fully discounted private pool package still collects paid room extras and retains its pending hold',async()=>{
  const previous=(await one('select rates from package_rate_versions where version=1')).rates;
  const rates=Object.fromEntries(['weekday','weekend'].map(tier=>[tier,Object.fromEntries(['day','night','whole_day'].map(mode=>[mode,{baseRate:10000,addOnPerHead:100}]))]));
  await db.query('update package_rate_versions set rates=$1::jsonb where version=1',[JSON.stringify(rates)]);
  try {
    const r=await privateWithRooms(),c=await roomClass(),extra=Number(c.rate_12_hours);
    await db.exec("insert into promo_codes(code,discount_type,discount_value) values('FREEPOOL','percent',100)");
    const result=await one("select swimming_finalize_booking($1,$2,$3::jsonb,'FREEPOOL',$4,$5) r",[r.reservation_id,id(100),JSON.stringify([roomChoice(c)]),10000+extra,extra]);
    assert.equal(Number(result.r.totalAmount),extra);
    const bill=await one('select * from transactions where reservation_id=$1',[r.reservation_id]);assert.equal(Number(bill.discount_amount),10000);
    const saved=await one('select status,payment_deadline_at from reservations where reservation_id=$1',[r.reservation_id]);assert.equal(saved.status,'pending');assert.ok(saved.payment_deadline_at);
  } finally { await db.query('update package_rate_versions set rates=$1::jsonb where version=1',[JSON.stringify(previous)]); }
});

test('whole-day extra rooms use existing 12-hour rates plus extensions and reserve the full swimming interval',async()=>{
  const r=await privateWithRooms('whole_day'),c=await roomClass('family'),rooms=JSON.stringify([roomChoice(c)]);
  const amount=Number(c.rate_12_hours)+10*Number(c.extension_hourly_rate),total=10000+amount;
  await db.query('select swimming_finalize_booking($1,$2,$3::jsonb,null,$4,$4)',[r.reservation_id,id(100),rooms,total]);
  const charge=await one('select amount from room_charges where reservation_id=$1',[r.reservation_id]);assert.equal(Number(charge.amount),amount);
  const assignment=await one("select * from room_assignments where reservation_id=$1 and pricing_snapshot->>'included'='false'",[r.reservation_id]);
  assert.equal(Date.parse(assignment.expected_checkout)-Date.parse(assignment.starts_at),22*3600000);
  assert.equal(assignment.pricing_snapshot.duration_hours,22);
});

test('staff can finalize private walk-in room add-ons with promos using their billing permission',async()=>{
  const r=await privateWithRooms(),c=await roomClass();
  await db.query('update reservations set guest_id=null where reservation_id=$1',[r.reservation_id]);
  await db.exec("insert into promo_codes(code,discount_type,discount_value) values('STAFF100','fixed',100)");
  const previous=(await one('select rates from package_rate_versions where version=1')).rates;
  const rates={weekday:{day:{baseRate:10000}},weekend:{day:{baseRate:10000}}};
  await db.query('update package_rate_versions set rates=$1::jsonb where version=1',[JSON.stringify(rates)]);
  try{
    const gross=10000+Number(c.rate_12_hours);
    await db.query("select swimming_finalize_booking($1,$2,$3::jsonb,'STAFF100',$4,$5)",[r.reservation_id,id(1),JSON.stringify([roomChoice(c)]),gross,gross-100]);
    assert.equal((await one('select count(*)::int n from room_charges where reservation_id=$1',[r.reservation_id])).n,1);
    assert.equal(Number((await one('select discount_amount from transactions where reservation_id=$1',[r.reservation_id])).discount_amount),100);
  }finally{await db.query('update package_rate_versions set rates=$1::jsonb where version=1',[JSON.stringify(previous)]);}
});

test('private bookings cannot consume unavailable included Standard rooms and room finalization is service-role only',async()=>{
  const c=await roomClass();
  await db.query("update physical_rooms set status='maintenance' where classification_id=$1",[c.classification_id]);
  try { await assert.rejects(()=>privateWithRooms(),denied('40001'));assert.equal((await one('select count(*)::int n from reservations')).n,0); }
  finally { await db.query("update physical_rooms set status='vacant' where classification_id=$1",[c.classification_id]); }
  await db.exec('set role authenticated');
  try { await assert.rejects(()=>db.query("select swimming_finalize_booking($1,$2,'[]'::jsonb,null,1,1)",[id(500),id(100)]),denied('42501')); }
  finally { await db.exec('reset role'); }
});

test('room accommodation can sell all eight general Standard rooms while the dedicated pair stays available for a private package',async()=>{
  const c=await roomClass(),date=addDays(await today(),4),start=date+'T08:00:00+08:00',finish=date+'T20:00:00+08:00';
  const body={startDatetime:start,endDatetime:finish,durationHours:12,
    firstName:'Customer',lastName:'Guest',phone:'+639171234567',address:'Street, City, Province, 1234',
    rooms:Array.from({length:8},()=>({classificationId:c.classification_id,occupants:2,pricingVersion:Number(c.pricing_version)})),
    eligibleGuests:0,promoCode:null,selectedServices:[],expectedTotal:8*Number(c.rate_12_hours),bookingPolicyVersion:1,termsPolicyId:id(200),privacyPolicyId:id(201)};
  const created=(await one('select room_guest_reserve($1,$2,$3::jsonb) r',[id(100),id(501),JSON.stringify(body)])).r;
  const general=(await db.query('select p.* from room_assignments a join physical_rooms p using(room_id) where reservation_id=$1',[created.id])).rows;
  assert.equal(general.length,8);assert.ok(general.every(r=>!r.private_swimming_only));
  await assert.rejects(()=>one('select room_guest_reserve($1,$2,$3::jsonb)',[id(100),id(502),JSON.stringify({...body,rooms:body.rooms.slice(0,1),expectedTotal:Number(c.rate_12_hours)})]),denied('40001'));
  const privateBooking=await privateWithRooms();
  const included=(await db.query('select p.* from room_assignments a join physical_rooms p using(room_id) where reservation_id=$1',[privateBooking.reservation_id])).rows;
  assert.equal(included.length,2);assert.ok(included.every(r=>r.private_swimming_only));
  const catalog=(await one('select room_guest_catalog($1,$2) c',[start,finish])).c;
  assert.equal(catalog.rooms.filter(r=>r.private_swimming_only).length,2);
  assert.equal(catalog.rooms.filter(r=>r.classification_id===c.classification_id&&!r.private_swimming_only).length,8);
});

test('public swimming and staff room-only assignments cannot use, transfer into or relabel the dedicated pair',async()=>{
  const dedicated=await one('select * from physical_rooms where private_swimming_only order by room_number limit 1');
  const c=await roomClass(),body=await input({swimmingRooms:[{...roomChoice(c),quantity:8}]});body.expectedTotal+=8*Number(c.rate_12_hours);
  const publicBooking=await save(body);
  assert.equal((await one('select count(*)::int n from room_assignments a join physical_rooms p using(room_id) where reservation_id=$1 and p.private_swimming_only',[publicBooking.id])).n,0);
  const date=addDays(await today(),4),start=date+'T08:00:00+08:00',finish=date+'T20:00:00+08:00';
  await db.query("insert into reservations(reservation_id,reference_number,commercial_type,room_pricing,booking_mode,status,start_datetime,end_datetime,adult_count,child_count) values($1,'ROOM-ONLY-PROTECTION','room_accommodation',true,'custom','confirmed',$2,$3,2,0)",[id(503),start,finish]);
  for(const type of ['room_accommodation','public_swimming','private_swimming']) {
    await db.query('update reservations set commercial_type=$1 where reservation_id=$2',[type,id(503)]);
    await assert.rejects(()=>db.query('insert into room_assignments(room_id,reservation_id,occupants,starts_at,expected_checkout) values($1,$2,2,$3,$4)',[dedicated.room_id,id(503),start,finish]),e=>e.code==='40001'&&/reserved for the included private swimming package/.test(e.message));
  }
  await db.query("update reservations set commercial_type='room_accommodation' where reservation_id=$1",[id(503)]);
  const normal=await one('select * from physical_rooms where not private_swimming_only and classification_id=$1 order by room_number limit 1',[c.classification_id]);
  const assignment=await one('insert into room_assignments(room_id,reservation_id,occupants,starts_at,expected_checkout) values($1,$2,2,$3,$4) returning *',[normal.room_id,id(503),start,finish]);
  await assert.rejects(()=>db.query('update room_assignments set room_id=$1 where assignment_id=$2',[dedicated.room_id,assignment.assignment_id]),denied('40001'));
  assert.equal((await one('select room_id from room_assignments where assignment_id=$1',[assignment.assignment_id])).room_id,normal.room_id);
  const privateBooking=await privateWithRooms();
  await assert.rejects(()=>db.query('update reservations set room_pricing=true where reservation_id=$1',[privateBooking.reservation_id]),denied('40001'));
  await assert.rejects(()=>db.query('update physical_rooms set private_swimming_only=false where room_id=$1',[dedicated.room_id]),denied('40001'));
  await assert.rejects(()=>db.query('update physical_rooms set is_active=false where room_id=$1',[dedicated.room_id]),denied('40001'));
});
