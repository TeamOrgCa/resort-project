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
  await db.exec("alter table package_rate_versions add column created_by uuid;create sequence package_test_version start 2;alter table package_rate_versions alter column version set default nextval('package_test_version');create or replace function auth.uid() returns uuid language sql as $$ select nullif(current_setting('app.test_actor',true),'')::uuid $$");
  for(const [file,names] of [['docs/package-rates-migration.sql',['valid_package_rates']],['docs/package-times-migration.sql',['valid_package_times','publish_package_rates']]]) {
    const sql=readFileSync(file,'utf8');for(const name of names){const a=sql.indexOf('create or replace function public.'+name+'(');await db.exec(sql.slice(a,sql.indexOf('$$;',a)+3));}
  }
  const rate={day:{baseRate:7500,addOnPerHead:125},night:{baseRate:9500,addOnPerHead:175},whole_day:{baseRate:14500,addOnPerHead:225}};
  await db.query('update package_rate_versions set rates=$1',[JSON.stringify({weekday:rate,weekend:rate})]);
  await db.exec(readFileSync('docs/swimming-session-management-migration.sql','utf8'));
  await db.exec(readFileSync('docs/swimming-session-management-migration.sql','utf8'));
});
after(async()=>{ await db?.close(); });
beforeEach(async()=>{
  await db.exec("delete from reservations;delete from maintenance_blocks;delete from staff_users;delete from audit_logs");
  await db.exec("update business_settings set setting_value='{\"version\":1,\"defaultMode\":\"flexible\",\"flexibleDays\":3,\"publicOnlyDays\":30,\"minimumAdvanceMinutes\":60,\"bufferMinutes\":0,\"sameDay\":true,\"active\":{\"day\":true,\"night\":true},\"weekly\":{},\"overrides\":[]}' where setting_key='swimming.sessions'");
  await db.exec("update public_swimming_types set max_guests=10,is_active=true");
  await db.query("select set_config('app.test_actor','',false)");
});
const setPolicy=async patch=>{
  const {p}=await one("select swimming_policy() p");
  return db.query("update business_settings set setting_value=$1 where setting_key='swimming.sessions'",[JSON.stringify({...p,...patch})]);
};
async function reserve(date,kind='private_swimming',adults=2,mode='day',status='confirmed',deadline=null){
  const t=await one("select * from public_swimming_types where mode=$1",[mode]);
  return one(`insert into reservations(reference_number,commercial_type,booking_mode,start_datetime,end_datetime,adult_count,child_count,status,payment_deadline_at,public_type_id,public_pricing_snapshot)
    values(gen_random_uuid()::text,$1,'custom',($2::date+$3::time) at time zone 'Asia/Manila',($2::date+$4::time) at time zone 'Asia/Manila', $5,0,$6,$7,$8,$9) returning *`,
    [kind,date,t.start_time,t.end_time,adults,status,deadline,kind==='public_swimming'?t.type_id:null,kind==='public_swimming'?JSON.stringify(t):null]);
}
const tomorrow=async(n=1)=>addDays(await today(),n);

test('Flexible retains three calendar days while Public Only opens a separate 30-day window',async()=>{
 const future=await tomorrow(20);
 assert.equal((await calendar(future))[0].eligibility,'not_open');
 await setPolicy({defaultMode:'public_only'});
 assert.equal((await calendar(future))[0].eligibility,'eligible');
 await reserve(future,'public_swimming');
 await assert.rejects(()=>reserve(future),denied('40001'));
 assert.equal((await calendar(await tomorrow(30)))[0].eligibility,'eligible');
 assert.equal((await calendar(await tomorrow(31)))[0].eligibility,'not_open');
});
test('weekly periods are independent and date range overrides take precedence',async()=>{
 const date=await tomorrow(8),dow=new Date(date+'T00:00Z').getUTCDay();
 await setPolicy({weekly:{[dow]:{day:'public_only',night:'private_only'}}});
 let sessions=await calendar(date);
 assert.equal(sessions[0].access_mode,'public_only');assert.equal(sessions[1].availability,'private_only');
 await setPolicy({weekly:{[dow]:{day:'public_only',night:'private_only'}},overrides:[{from:date,to:addDays(date,1),period:'day',mode:'private_only'}]});
 sessions=await calendar(date); assert.equal(sessions[0].access_mode,'private_only');
 await assert.rejects(()=>reserve(date,'public_swimming'),denied('40001'));
 await reserve(date);
});
test('public capacity is shared, exclusive private holds block it, and expired holds release it',async()=>{
 const date=await tomorrow();
 await reserve(date,'public_swimming',6);
 await reserve(date,'public_swimming',4);
 assert.equal((await calendar(date))[0].remaining_capacity,0);
 await assert.rejects(()=>reserve(date,'public_swimming',1),denied('40001'));
 await assert.rejects(()=>reserve(date),denied('40001'));
 await db.exec('delete from reservations');
 const r=await reserve(date,'private_swimming',2,'day','pending',new Date(Date.now()+600000).toISOString());
 await assert.rejects(()=>reserve(date,'public_swimming'),denied('40001'));
 await db.query("update reservations set payment_deadline_at=clock_timestamp()-interval '1 second' where reservation_id=$1",[r.reservation_id]);
 await reserve(date,'public_swimming');
});
test('configuration rejects invalidation and returns affected reservation details',async()=>{
 const date=await tomorrow(),r=await reserve(date);
 await assert.rejects(()=>setPolicy({defaultMode:'public_only'}),e=>e.code==='40001'&&JSON.parse(e.detail).some(c=>c.reservationId===r.reservation_id));
 assert.equal((await one('select swimming_policy() p')).p.defaultMode,'flexible');
 await assert.rejects(()=>setPolicy({active:{day:false,night:true}}),denied('40001'));
 await setPolicy({flexibleDays:1,minimumAdvanceMinutes:120}); // Existing allocations are grandfathered for cutoff/horizon changes.
});
test('public capacity and operating-hour edits protect active allocations through catalog writes',async()=>{
 const date=await tomorrow();await reserve(date,'public_swimming',6);
 await assert.rejects(()=>db.exec("update public_swimming_types set max_guests=5 where mode='day'"),denied('40001'));
 await assert.rejects(()=>db.exec("update public_swimming_types set end_time='15:00' where mode='day'"),denied('40001'));
});
test('whole-day private claims validate every public-only session they touch',async()=>{
 const date=await tomorrow(8);await setPolicy({overrides:[{from:date,to:date,period:'night',mode:'public_only'}]});
 await assert.rejects(()=>db.query("insert into reservations(reference_number,commercial_type,booking_mode,start_datetime,end_datetime,adult_count,child_count,status) values('WHOLE','private_swimming','custom',$1::date+time '08:00' at time zone 'Asia/Manila',($1::date+1)+time '06:00' at time zone 'Asia/Manila',2,0,'confirmed')",[date]),denied('40001'));
});
test('calendar returns every session even outside booking windows and resolves Manila midnight openings',async()=>{
 const sessions=await calendar('2030-11-01','2030-11-30','2030-11-01T00:00:00+08:00');assert.equal(sessions.length,60);
 const day=(await calendar('2030-11-25','2030-11-25','2030-11-22T23:59:59+08:00'))[0];assert.equal(day.eligibility,'not_open');
 assert.equal(Date.parse(day.opens_at),Date.parse('2030-11-23T00:00:00+08:00'));
});
test('malformed policies and overlapping overrides are rejected in the database',async()=>{
 await assert.rejects(()=>setPolicy({flexibleDays:0}),denied('22023'));
 const date=await tomorrow();await assert.rejects(()=>setPolicy({overrides:[{from:date,to:date,period:'day',mode:'public_only'},{from:date,to:date,period:'day',mode:'private_only'}]}),denied('22023'));
});

async function configurationInput(){
 return {policy:(await one('select swimming_policy() p')).p,types:(await db.query('select * from public_swimming_types order by mode')).rows,package:await one('select * from package_rate_versions order by version desc limit 1')};
}
async function configure(input){
 return one('select save_swimming_policy($1,$2,$3,$4,$5,365) p',[JSON.stringify(input.policy),input.policy.version,JSON.stringify(input.types),JSON.stringify(input.package.times),input.package.version]);
}
test('configuration publication is authorized, optimistic, atomic and audited with both old and new values',async()=>{
 const input=await configurationInput();
 await assert.rejects(()=>configure(input),denied('42501'));
 await db.query("insert into staff_users values($1,'Admin','admin',true)",[id(10)]);
 await db.query("select set_config('app.test_actor',$1,false)",[id(10)]);
 input.policy.defaultMode='public_only';input.package.times.day.start='09:00';
 const saved=await configure(input);assert.equal(saved.p.version,2);
 assert.equal((await one('select times from package_rate_versions order by version desc limit 1')).times.day.start,'09:00');
 const audit=await one("select details from audit_logs where action='Updated swimming session configuration'");assert.equal(audit.details.before.defaultMode,'flexible');assert.equal(audit.details.after.defaultMode,'public_only');
 await assert.rejects(()=>configure(input),denied('40001'));
});
test('a rejected complete configuration rolls back catalog changes and leaves no success audit',async()=>{
 const date=await tomorrow();await reserve(date);const input=await configurationInput();
 await db.query("insert into staff_users values($1,'Admin','admin',true)",[id(10)]);await db.query("select set_config('app.test_actor',$1,false)",[id(10)]);
 input.policy.defaultMode='public_only';input.types[0].max_guests=99;
 await assert.rejects(()=>configure(input),denied('40001'));
 assert.equal((await one("select max_guests from public_swimming_types where mode='day'")).max_guests,10);
 assert.equal((await one('select count(*)::int n from audit_logs')).n,0);
});
test('buffer conflicts are symmetric and cannot be introduced around existing allocations',async()=>{
 const date=await tomorrow();await reserve(date);
 await setPolicy({bufferMinutes:120});
 // Day ends at 16:00; a 120-minute buffer allows the 18:00 session exactly.
 await reserve(date,'public_swimming',2,'night');
 await assert.rejects(()=>setPolicy({bufferMinutes:121}),denied('40001'));
 await assert.rejects(()=>db.query("insert into maintenance_blocks(start_datetime,end_datetime,status) values($1::date+time '17:00' at time zone 'Asia/Manila',$1::date+time '17:30' at time zone 'Asia/Manila','active')",[date]),denied('40001'));
});
test('same-day and private advance policies are enforced server-side and remain visible in private calendars',async()=>{
 await setPolicy({sameDay:false});
 const sessions=(await db.query('select * from private_swimming_calendar($1::date,$1::date,null)',[await today()])).rows;
 assert.equal(sessions.length,2);assert.ok(sessions.every(s=>s.reason));
 await db.exec("update business_settings set setting_value='2' where setting_key='reservation.maximum_advance_booking_days'");
 const date=await tomorrow(3);await assert.rejects(()=>reserve(date),e=>['40001','22023'].includes(e.code));
 const future=(await db.query('select * from private_swimming_calendar($1::date,$1::date,null)',[date])).rows;
 assert.ok(future.every(s=>s.reason==='Not Yet Open for Booking'));
 await db.exec("update business_settings set setting_value='365' where setting_key='reservation.maximum_advance_booking_days'");
});

test('whole-day arrivals on the last private booking date can occupy the next day while respecting its access mode',async()=>{
 await db.exec("update business_settings set setting_value='2' where setting_key='reservation.maximum_advance_booking_days'");
 try {
  const date=await tomorrow(2),next=addDays(date,1);
  await setPolicy({overrides:[{from:next,to:next,period:'day',mode:'public_only'}]});
  const sessions=(await db.query('select * from private_swimming_calendar($1::date,$1::date,null)',[next])).rows;
  assert.equal(sessions.find(s=>s.period==='day').reason,'Public Only');
  const insert=()=>db.query("insert into reservations(reference_number,commercial_type,booking_mode,start_datetime,end_datetime,adult_count,child_count,status) values('LAST-DAY','private_swimming','custom',$1::date+time '18:00' at time zone 'Asia/Manila',($1::date+1)+time '16:00' at time zone 'Asia/Manila',2,0,'confirmed')",[date]);
  await assert.rejects(insert,denied('40001'));
  await setPolicy({overrides:[]});await insert();
 } finally { await db.exec("update business_settings set setting_value='365' where setting_key='reservation.maximum_advance_booking_days'"); }
});
