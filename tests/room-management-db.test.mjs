import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRoomDatabase } from "./helpers/room-database.mjs";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db, room;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
function fn(path, name) { const sql = readFileSync(path, "utf8"), start = sql.indexOf(`create or replace function public.${name}(`); assert.ok(start >= 0); return sql.slice(start, sql.indexOf("$$;", start) + 3); }
const operate = async (action, input = {}, actor = id(1), roomId = room) => (await one("select room_operate($1,$2,$3,$4::jsonb) result", [actor, roomId, action, JSON.stringify(input)])).result;
const code = expected => e => e.code === expected;
before(async () => { db = await createRoomDatabase(); });
after(async () => db?.close());
beforeEach(async () => {
  await db.exec("drop trigger if exists fail_room_audit on audit_logs");
  await db.exec("reset role; truncate guests,promo_redemptions,promo_codes,room_rate_versions,room_extensions,room_charges,room_activity,room_assignments,room_maintenance,room_catalog_links,room_occupancy_alerts,units,services,reservation_units,reservation_services,reservations,walk_in_guests,transactions,payments,refund_requests,reservation_reschedules,invoices,audit_logs,notifications,maintenance_blocks,staff_users cascade;update physical_rooms set status='vacant',is_active=true;update room_classifications set pricing_version=1,rate_3_hours=300,rate_12_hours=1000,base_rate=1000,additional_guest_rate=200,extension_hourly_rate=100,cleaning_buffer_minutes=60;");
  await db.query("insert into staff_users values($1,'Admin','admin',true),($2,'Manager','staff',true),($3,'Cashier','cashier',true),($4,'Disabled','admin',false)", [id(1), id(2), id(3), id(4)]);
  await db.exec("update role_permissions set permissions=array['rooms','room_operations','edit_reservation','create_reservation','room_export'] where role='staff';update role_permissions set permissions=array['rooms','transactions','payment_entry'] where role='cashier'");
  await db.query("insert into guests(id,first_name,last_name,phone_number,address) values($1,'Customer','Guest','+639171234567','Example address')",[id(100)]);
  room = (await one("select room_id from physical_rooms where room_number='S01'")).room_id;
});
async function reserved(number = 10, roomId = room, startHours = 1, endHours = 3, type = "room_accommodation") {
  await db.query("insert into reservations(reservation_id,reference_number,commercial_type,status,start_datetime,end_datetime,adult_count,child_count,payment_deadline_at) values($1,$2,$3,'confirmed',clock_timestamp()+make_interval(hours=>$4),clock_timestamp()+make_interval(hours=>$5),2,0,clock_timestamp()+interval '30 minutes')", [id(number), `RM-${number}`, type, startHours, endHours]);
  await db.query("insert into transactions(reservation_id,total_amount,status) values($1,1000,'unpaid')", [id(number)]);
  return (await one("insert into room_assignments(room_id,reservation_id,occupants,starts_at,expected_checkout) select $1,reservation_id,2,start_datetime,end_datetime from reservations where reservation_id=$2 returning *", [roomId, id(number)]));
}
async function occupied(number = 10, roomId = room) {
  const a = await reserved(number, roomId, 0, 3);
  await operate("check_in", { assignment_id: a.assignment_id }, id(1), roomId);
  return await one("select * from room_assignments where assignment_id=$1", [a.assignment_id]);
}
test("migration seeds physical inventory once and preserves intended capacities", async () => {
  assert.equal((await one("select count(*)::int n from physical_rooms")).n, 20);
  const rows = (await db.query("select code,included_capacity,maximum_capacity from room_classifications order by code")).rows;
  assert.deepEqual(rows, [{ code: "family", included_capacity: 4, maximum_capacity: 6 }, { code: "standard", included_capacity: 2, maximum_capacity: 2 }]);
});
test("private booking exclusivity uses exact intervals and permits adjacent day and night stays", async () => {
  await db.exec(`insert into reservations(reservation_id,reference_number,commercial_type,status,start_datetime,end_datetime,adult_count,child_count) values
    ('${id(80)}','DAY','private_swimming','confirmed','2035-10-31T08:00:00+08:00','2035-10-31T16:00:00+08:00',2,0),
    ('${id(81)}','NIGHT','private_swimming','confirmed','2035-10-31T16:00:00+08:00','2035-11-01T06:00:00+08:00',2,0)`);
  await assert.rejects(() => db.exec(`insert into reservations(reservation_id,reference_number,commercial_type,status,start_datetime,end_datetime,adult_count,child_count)
    values('${id(82)}','OVERLAP','private_swimming','confirmed','2035-10-31T15:59:00+08:00','2035-10-31T18:00:00+08:00',2,0)`), code("23P01"));
  assert.equal((await one("select count(*)::int n from reservations")).n, 2);
});
test("room-only and public swimming reservations do not inherit the old resort-wide time constraint", async () => {
  for (const [number, type] of [[80, "private_swimming"], [81, "room_accommodation"], [82, "public_swimming"]]) {
    await db.query("insert into reservations(reservation_id,reference_number,commercial_type,status,start_datetime,end_datetime,adult_count,child_count) values($1,$2,$3,'confirmed','2035-10-31T08:00:00+08:00','2035-10-31T16:00:00+08:00',2,0)", [id(number),`SAME-TIME-${number}`,type]);
  }
  assert.equal((await one("select count(*)::int n from reservations")).n, 3);
  assert.equal((await one("select count(*)::int n from pg_constraint where conrelid='reservations'::regclass and conname='one_active_reservation_per_date'")).n,0);
});
test("atomic extension updates occupancy, existing bill, invoice, activity, and collection notifications", async () => {
  const a = await occupied();
  await db.query("insert into invoices(reservation_id,total_amount,status) values($1,1000,'issued')", [id(10)]);
  await operate("extend", { assignment_id: a.assignment_id, expected_checkout: a.expected_checkout, hours: 2, hourly_rate: 100 });
  assert.equal(Date.parse((await one("select expected_checkout from room_assignments")).expected_checkout) - Date.parse(a.expected_checkout), 7200000);
  assert.equal((await one("select total_amount from transactions")).total_amount, "1200.00");
  assert.equal((await one("select total_amount from invoices")).total_amount, "1200.00");
  assert.equal((await one("select count(*)::int n from room_extensions")).n, 1);
  assert.equal((await one("select status from physical_rooms where room_id=$1", [room])).status, "occupied");
  assert.equal((await one("select count(*)::int n from notifications")).n, 2);
  await assert.rejects(() => operate("extend", { assignment_id: a.assignment_id, expected_checkout: a.expected_checkout, hours: 2, hourly_rate: 100 }), code("40001"));
});
test("extensions reject subsequent bookings including cleaning buffers and leave no partial charges", async () => {
  const a = await occupied(); await reserved(11, room, 5, 7);
  await assert.rejects(() => operate("extend", { assignment_id: a.assignment_id, expected_checkout: a.expected_checkout, hours: 2, hourly_rate: 100 }), code("40001"));
  assert.equal((await one("select count(*)::int n from room_charges")).n, 0);
  assert.equal((await one("select total_amount from transactions where reservation_id=$1", [id(10)])).total_amount, "1000");
});
test("all commercial types share physical inventory and non-overlapping room intervals remain available", async () => {
  await reserved(10, room, 1, 3, "private_swimming");
  await assert.rejects(() => reserved(11, room, 2, 4, "public_swimming"), code("40001"));
  await reserved(12, room, 5, 7, "room_accommodation");
  assert.equal((await one("select count(*)::int n from room_assignments")).n, 2);
});
test("overdue guests stay occupied and block new room claims until staff completes checkout", async () => {
  const a = await occupied();
  await db.query("update room_assignments set starts_at=now()-interval '3 hours',expected_checkout=now()-interval '1 hour' where assignment_id=$1", [a.assignment_id]);
  await assert.rejects(() => reserved(11, room, 5, 7), code("40001"));
  assert.equal((await one("select status from physical_rooms where room_id=$1", [room])).status, "occupied");
  await assert.rejects(() => operate("ready"), code("40001"));
});
test("checkout requires verified full payment, then cleaning and explicit readiness confirmation", async () => {
  const a = await occupied();
  await assert.rejects(() => operate("check_out", { assignment_id: a.assignment_id }), code("40001"));
  await db.query("insert into payments(reservation_id,amount,status) values($1,1000,'verified')", [id(10)]);
  await operate("check_out", { assignment_id: a.assignment_id });
  assert.equal((await one("select status from physical_rooms where room_id=$1", [room])).status, "cleaning");
  assert.equal((await one("select status from reservations")).status, "completed");
  await operate("ready"); assert.equal((await one("select status from physical_rooms where room_id=$1", [room])).status, "vacant");
});
test("individual check-in and checkout do not prematurely complete other assigned rooms", async () => {
  const a = await reserved(10, room, 0, 3), other = (await one("select room_id from physical_rooms where room_number='S02'")).room_id;
  const b = await one("insert into room_assignments(room_id,reservation_id,occupants,starts_at,expected_checkout) select $1,reservation_id,2,start_datetime,end_datetime from reservations where reservation_id=$2 returning *", [other, id(10)]);
  await operate("check_in", { assignment_id: a.assignment_id });
  assert.equal((await one("select state from room_assignments where assignment_id=$1", [b.assignment_id])).state, "reserved");
  await db.query("insert into payments(reservation_id,amount,status) values($1,1000,'verified')", [id(10)]);
  await operate("check_out", { assignment_id: a.assignment_id });
  assert.equal((await one("select status from reservations")).status, "confirmed");
});
test("maintenance blocks extensions and only completion followed by housekeeping returns readiness", async () => {
  const a = await occupied();
  const times = await one("select (clock_timestamp()+interval '5 hours')::text s,(clock_timestamp()+interval '7 hours')::text e");
  await operate("maintenance", { starts_at: times.s, ends_at: times.e, reason: "Air conditioning service" });
  await assert.rejects(() => operate("extend", { assignment_id: a.assignment_id, expected_checkout: a.expected_checkout, hours: 2, hourly_rate: 100 }), code("40001"));
  await assert.rejects(() => operate("maintenance", { starts_at: a.starts_at, ends_at: a.expected_checkout, reason: "Conflict" }), code("40001"));
});
test("transfers atomically clean the original room and occupy the replacement", async () => {
  const a = await occupied(), other = (await one("select room_id from physical_rooms where room_number='S02'")).room_id;
  await operate("transfer", { assignment_id: a.assignment_id, target_room: other });
  assert.equal((await one("select status from physical_rooms where room_id=$1", [room])).status, "cleaning");
  assert.equal((await one("select status from physical_rooms where room_id=$1", [other])).status, "occupied");
  assert.equal((await one("select state from room_assignments where assignment_id=$1", [a.assignment_id])).state, "transferred");
});
test("cashier, inactive staff and direct browser SQL cannot mutate operations or immutable history", async () => {
  await assert.rejects(() => operate("cleaning", {}, id(3)), code("42501"));
  await assert.rejects(() => operate("cleaning", {}, id(4)), code("42501"));
  await operate("cleaning", {}, id(2));
  await assert.rejects(() => db.exec("delete from room_activity"), code("42501"));
  await db.exec("set role authenticated");
  try { await assert.rejects(() => operate("ready"), code("42501")); await assert.rejects(() => db.exec("update physical_rooms set status='vacant'"), code("42501")); }
  finally { await db.exec("reset role"); }
});
test("walk-in reservation uses configured rates, excess guest charges, existing bill and real guest records", async () => {
  const family = (await one("select room_id from physical_rooms where room_number='F01'")).room_id;
  const times = await one("select (clock_timestamp()+interval '10 minutes')::text s,(clock_timestamp()+interval '12 hours 10 minutes')::text e");
  const result = await operate("reserve", { first_name: "Example", last_name: "Guest", phone: "+639171234567", address: "Test address", occupants: 6, starts_at: times.s, ends_at: new Date(Date.parse(times.s)+12*3600000).toISOString(), duration_hours: 12, extension_hours: 0, pricing_version: 1, eligible_guests: 0, expected_total: 1400, commercial_type: "room_accommodation" }, id(1), family);
  assert.match(result.reference_number, /^RM-/);
  assert.equal((await one("select total_amount from transactions")).total_amount, "1400.00");
  assert.equal((await one("select status from reservations")).status, "pending");
  assert.equal((await one("select count(*)::int n from walk_in_guests")).n, 1);
});
test("deactivation preserves history and rejects assigned rooms", async () => {
  await reserved(); await assert.rejects(() => operate("deactivate"), code("40001"));
  await db.exec("update reservations set status='cancelled'");
  await operate("deactivate"); assert.equal((await one("select is_active from physical_rooms where room_id=$1", [room])).is_active, false);
  assert.ok((await one("select count(*)::int n from room_activity")).n > 0);
});
test("existing catalog selection consumes physical inventory atomically and rejects shortages", async () => {
  await db.query("insert into services(service_id,name,billing_type) values($1,'Standard room','quantity')", [id(90)]);
  const classification = (await one("select classification_id from room_classifications where code='standard'")).classification_id;
  await db.query("select room_set_catalog_link($1,$2,null,$3,false)", [id(1), classification, id(90)]);
  await db.query("insert into reservations(reservation_id,reference_number,commercial_type,status,start_datetime,end_datetime,adult_count,child_count) values($1,'CATALOG','public_swimming','confirmed',now()+interval '1 hour',now()+interval '3 hours',2,0)", [id(20)]);
  await db.query("insert into reservation_services values($1,$2,2)", [id(20), id(90)]);
  assert.equal((await one("select count(*)::int n from room_assignments where reservation_id=$1", [id(20)])).n, 2);
  await assert.rejects(() => db.query("update reservation_services set quantity=11 where reservation_id=$1", [id(20)]), code("40001"));
  assert.equal((await one("select count(*)::int n from room_assignments where reservation_id=$1", [id(20)])).n, 2);
  await assert.rejects(() => db.query("select room_set_catalog_link($1,$2,null,$3,true)", [id(1), classification, id(90)]), code("40001"));
  await db.query("delete from reservation_services where reservation_id=$1", [id(20)]);
  assert.equal((await one("select count(*)::int n from room_assignments where state='reserved'")).n, 0);
});
test("occupancy notifications are deduplicated by checkout timestamp and indicator", async () => {
  const a = await occupied();
  await db.query("update room_assignments set expected_checkout=now()+interval '20 minutes' where assignment_id=$1", [a.assignment_id]);
  await db.exec("select room_emit_alerts();select room_emit_alerts()");
  assert.equal((await one("select count(*)::int n from room_occupancy_alerts")).n, 1);
  assert.equal((await one("select count(*)::int n from notifications")).n, 3);
  await db.query("update room_assignments set starts_at=now()-interval '2 hours',expected_checkout=now()-interval '1 minute' where assignment_id=$1", [a.assignment_id]);
  await db.exec("select room_emit_alerts();select room_emit_alerts()");
  assert.equal((await one("select count(*)::int n from room_occupancy_alerts")).n, 2);
});
test("failed auditing rolls back an extension, its billing change, and its occupancy timestamp", async () => {
  const a = await occupied();
  await db.exec("create or replace function fail_room_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable';end$$;create trigger fail_room_audit before insert on audit_logs for each row execute function fail_room_audit()");
  await assert.rejects(() => operate("extend", { assignment_id: a.assignment_id, expected_checkout: a.expected_checkout, hours: 1, hourly_rate: 100 }), /audit unavailable/);
  assert.equal(Date.parse((await one("select expected_checkout from room_assignments")).expected_checkout), Date.parse(a.expected_checkout));
  assert.equal((await one("select total_amount from transactions")).total_amount, "1000");
  assert.equal((await one("select count(*)::int n from room_extensions")).n, 0);
});
test("resort-wide maintenance cannot bypass the expected checkout of an extended room", async () => {
  const a = await occupied();
  await operate("extend", { assignment_id: a.assignment_id, expected_checkout: a.expected_checkout, hours: 3, hourly_rate: 100 });
  await assert.rejects(() => db.exec("insert into maintenance_blocks(start_datetime,end_datetime,status) values(now()+interval '5 hours',now()+interval '8 hours','active')"), code("40001"));
});
test("maintenance completion requires housekeeping and cannot return directly to vacant", async () => {
  const times = await one("select clock_timestamp()::text s,(clock_timestamp()+interval '2 hours')::text e");
  await operate("maintenance", { starts_at: times.s, ends_at: times.e, reason: "Fixture repair" });
  const record = await one("select maintenance_id from room_maintenance");
  await assert.rejects(() => operate("ready"), code("40001"));
  await operate("complete_maintenance", { maintenance_id: record.maintenance_id });
  assert.equal((await one("select status from physical_rooms where room_id=$1", [room])).status, "cleaning");
  await operate("ready");
  assert.equal((await one("select status from physical_rooms where room_id=$1", [room])).status, "vacant");
});
test("legacy editors cannot overwrite recorded room charges, while verified payments still refresh the bill", async () => {
  const a = await occupied();
  await operate("extend", { assignment_id: a.assignment_id, expected_checkout: a.expected_checkout, hours: 1, hourly_rate: 100 });
  await assert.rejects(() => db.exec("update transactions set total_amount=700"), code("40001"));
  await db.query("insert into payments(reservation_id,amount,status) values($1,1100,'verified')", [id(10)]);
  await db.query("select refresh_reservation_payment_totals($1)", [id(10)]);
  assert.equal((await one("select status from transactions")).status, "paid");
});
test("existing checked-in reservations can be reconciled to their actual physical room", async () => {
  await db.query("insert into reservations(reservation_id,reference_number,commercial_type,status,start_datetime,end_datetime,adult_count,child_count,checked_in_at,checked_in_by) values($1,'LEGACY-STAY','private_swimming','confirmed',now()-interval '1 hour',now()+interval '2 hours',2,0,now()-interval '1 hour',$2)", [id(30),id(1)]);
  await db.query("insert into transactions(reservation_id,total_amount,status) values($1,1000,'unpaid')", [id(30)]);
  await operate("assign", { reference: "LEGACY-STAY", occupants: 2, charge_accommodation: false });
  assert.equal((await one("select state from room_assignments")).state,"occupied");
  assert.equal((await one("select status from physical_rooms where room_id=$1",[room])).status,"occupied");
});
test("failed legacy booking cleanup releases catalog room claims without deleting historical activity", async () => {
  await db.query("insert into services(service_id,name,billing_type) values($1,'Room add-on','quantity')", [id(90)]);
  const classification=(await one("select classification_id from room_classifications where code='standard'")).classification_id;
  await db.query("select room_set_catalog_link($1,$2,null,$3,false)",[id(1),classification,id(90)]);
  await db.query("insert into reservations(reservation_id,reference_number,status,start_datetime,end_datetime,adult_count,child_count) values($1,'FAILED-BOOKING','pending',now()+interval '1 hour',now()+interval '3 hours',2,0)",[id(31)]);
  await db.query("insert into reservation_services values($1,$2,1)",[id(31),id(90)]);
  await db.query("delete from reservations where reservation_id=$1",[id(31)]);
  assert.equal((await one("select count(*)::int n from room_assignments")).n,0);
  assert.equal((await one("select count(*)::int n from room_activity where activity_type='reservation_released'")).n,1);
});
test("guest cancellations release assigned rooms without requiring a staff foreign key for the guest actor", async () => {
  await reserved();
  await db.query("update reservations set status='cancelled',cancelled_by=$1",[id(99)]);
  const activity=await one("select staff_id,staff_name from room_activity where activity_type='reservation_released'");
  assert.equal(activity.staff_id,null); assert.equal(activity.staff_name,"Guest");
  assert.equal((await one("select state from room_assignments")).state,"cancelled");
});

async function pricedInput(overrides = {}) {
  await db.exec("update room_classifications set rate_12_hours=900,base_rate=900,extension_hourly_rate=150");
  const start = new Date(Date.now() + 600000).toISOString();
  const input = { first_name: "Real", last_name: "Guest", phone: "+639171234567", address: "Guest address", occupants: 2,
    commercial_type: "room_accommodation", starts_at: start, duration_hours: 3, extension_hours: 0,
    pricing_version: 1, eligible_guests: 0, expected_total: 300, ...overrides };
  input.ends_at = new Date(Date.parse(input.starts_at) + (input.duration_hours + input.extension_hours) * 3600000).toISOString();
  return input;
}
test("3-hour and 12-hour walk-ins charge the selected rate and retain their pricing snapshot", async () => {
  for (const [number, duration, total] of [["S01",3,300],["S02",12,900]]) {
    const selected = (await one("select room_id from physical_rooms where room_number=$1",[number])).room_id;
    const result = await operate("reserve", await pricedInput({duration_hours:duration,expected_total:total}),id(2),selected);
    const bill = await one("select total_amount from transactions where reservation_id=$1",[result.reservation_id]);
    assert.equal(Number(bill.total_amount),total);
    assert.equal((await one("select pricing_snapshot from room_assignments where reservation_id=$1",[result.reservation_id])).pricing_snapshot.duration_hours,duration);
  }
});
test("initial extensions add PHP 150 per hour to the bill and authoritative checkout", async () => {
  const input = await pricedInput({extension_hours:2,expected_total:600});
  const result = await operate("reserve",input);
  const a=await one("select * from room_assignments where reservation_id=$1",[result.reservation_id]);
  assert.equal(Date.parse(a.expected_checkout)-Date.parse(a.starts_at),5*3600000);
  assert.equal(Number((await one("select amount from room_charges where kind='extension'")).amount),300);
  assert.equal(Number((await one("select hourly_rate from room_extensions")).hourly_rate),150);
});
test("PWD and senior eligibility is proportional; promo discounts never stack or reduce extension charges", async () => {
  await db.exec("insert into promo_codes(code,discount_type,discount_value) values('ROOM20','percent',20)");
  const result=await operate("reserve",await pricedInput({eligible_guests:1,promo_code:"ROOM20",discount_reason:"Verified senior eligibility",extension_hours:1,expected_total:390}));
  const bill=await one("select * from transactions where reservation_id=$1",[result.reservation_id]);
  assert.equal(Number(bill.discount_package_price),300); assert.equal(Number(bill.discount_amount),60);
  assert.equal(bill.discount_kind,"promo"); assert.equal(Number(bill.total_amount),390);
  assert.equal((await one("select state from promo_redemptions")).state,"held");
});
test("when PWD/senior wins, the smaller promo consumes no use and extra guest fees remain billed", async () => {
  const family=(await one("select room_id from physical_rooms where room_number='F01'")).room_id;
  await db.exec("insert into promo_codes(code,discount_type,discount_value,max_uses) values('SMALLROOM','fixed',10,1)");
  const result=await operate("reserve",await pricedInput({occupants:6,eligible_guests:3,promo_code:"SMALLROOM",discount_reason:"Verified three eligible guests",expected_total:670}),id(1),family);
  const bill=await one("select * from transactions where reservation_id=$1",[result.reservation_id]);
  assert.equal(Number(bill.discount_amount),30); assert.equal(bill.discount_kind,"pwd_senior"); assert.equal(Number(bill.total_amount),670);
  assert.equal((await one("select count(*)::int n from promo_redemptions")).n,0);
});
test("invalid, exhausted or changed promo quotes roll back guests, bills, room claims and charges", async () => {
  await db.exec("insert into promo_codes(code,discount_type,discount_value,max_uses) values('LASTROOM','fixed',50,1)");
  const input=await pricedInput({promo_code:"LASTROOM",discount_reason:"Promo selected by guest",expected_total:250});
  await operate("reserve",input);
  const selected=(await one("select room_id from physical_rooms where room_number='S02'")).room_id;
  for (const changed of [{promo_code:"MISSING"},{},{expected_total:240}]) {
    await assert.rejects(()=>operate("reserve",{...input,...changed},id(1),selected));
    assert.equal((await one("select count(*)::int n from reservations")).n,1);
    assert.equal((await one("select count(*)::int n from walk_in_guests")).n,1);
    assert.equal((await one("select count(*)::int n from room_charges")).n,1);
  }
});
test("only admins publish versioned room rates; stale quotes fail without creating a booking", async () => {
  const input=await pricedInput(), classification=(await one("select classification_id from physical_rooms where room_id=$1",[room])).classification_id;
  const rates={rate_3_hours:350,rate_12_hours:1000,extension_hourly_rate:175,additional_guest_rate:200};
  await assert.rejects(()=>one("select room_save_rates($1,$2,1,$3::jsonb)",[id(2),classification,JSON.stringify(rates)]),code("42501"));
  await one("select room_save_rates($1,$2,1,$3::jsonb)",[id(1),classification,JSON.stringify(rates)]);
  await assert.rejects(()=>operate("reserve",input),code("40001"));
  await assert.rejects(()=>one("select room_save_rates($1,$2,1,$3::jsonb)",[id(1),classification,JSON.stringify(rates)]),code("40001"));
  assert.equal((await one("select count(*)::int n from reservations")).n,0);
  const result=await operate("reserve",{...input,pricing_version:2,expected_total:350});
  assert.equal(Number(result.total_amount),350);
  assert.equal((await one("select count(*)::int n from room_rate_versions")).n,1);
  await assert.rejects(()=>db.exec("delete from room_rate_versions"),code("42501"));
});
test("dedicated room bills use accommodation for discounts even under a private swimming commercial label", async () => {
  const result=await operate("reserve",await pricedInput({commercial_type:"private_swimming",eligible_guests:2,discount_reason:"Verified both senior IDs",expected_total:240}));
  assert.equal(Number((await one("select discount_package_price from transactions where reservation_id=$1",[result.reservation_id])).discount_package_price),300);
});
test("room rates migration can be rerun without changing existing billed rates or saved prices", async () => {
  const input=await pricedInput(); await operate("reserve",input);
  const rates=(await db.query("select * from room_classifications order by code")).rows;
  const bills=(await db.query("select * from transactions")).rows;
  // beforeEach deliberately truncates version history; restore its initial
  // snapshot to represent a correctly installed database before rerunning.
  await db.exec("insert into room_rate_versions(classification_id,version,rates) select classification_id,pricing_version,'{}' from room_classifications");
  await db.exec(readFileSync("docs/room-rates-discounts-migration.sql","utf8"));
  assert.deepEqual((await db.query("select * from room_classifications order by code")).rows,rates);
  assert.deepEqual((await db.query("select * from transactions")).rows,bills);
});
test("an occupied stay uses the current configured extension rate and rejects an older hourly quote",async()=>{
  const a=await occupied(); await db.exec("update room_classifications set extension_hourly_rate=150");
  await assert.rejects(()=>operate("extend",{assignment_id:a.assignment_id,expected_checkout:a.expected_checkout,hours:2,hourly_rate:100}),code("40001"));
  await operate("extend",{assignment_id:a.assignment_id,expected_checkout:a.expected_checkout,hours:2,hourly_rate:150});
  assert.equal(Number((await one("select total_amount from transactions")).total_amount),1300);
});
test("operational staff without the billing grant cannot apply walk-in discounts through SQL",async()=>{
  const input=await pricedInput({eligible_guests:2,discount_reason:"Verified both eligibility IDs",expected_total:240});
  await db.exec("update role_permissions set permissions=array['rooms','room_operations','create_reservation'] where role='staff'");
  await assert.rejects(()=>operate("reserve",input,id(2)),code("42501"));
  assert.equal((await one("select count(*)::int n from reservations")).n,0);
});
test("Room Settings publishes the same catalog rates and rolls back prices if a capacity change is invalid",async()=>{
  await reserved();
  const input={name:"Standard Rooms",included_capacity:1,maximum_capacity:1,base_rate:900,base_hours:12,
    rate_3_hours:350,rate_12_hours:950,additional_guest_rate:200,extension_hourly_rate:150,cleaning_buffer_minutes:60,pricing_version:1};
  await assert.rejects(()=>operate("configure",input),code("40001"));
  let classification=await one("select c.* from room_classifications c join physical_rooms r using(classification_id) where r.room_id=$1",[room]);
  assert.equal(Number(classification.rate_3_hours),300);assert.equal(Number(classification.pricing_version),1);
  await operate("configure",{...input,included_capacity:2,maximum_capacity:2});
  classification=await one("select c.* from room_classifications c join physical_rooms r using(classification_id) where r.room_id=$1",[room]);
  assert.equal(Number(classification.rate_3_hours),350);assert.equal(Number(classification.base_rate),950);assert.equal(Number(classification.pricing_version),2);
});

async function customerInput(overrides = {}) {
  const classification = (await one("select classification_id from room_classifications where code='standard'")).classification_id;
  const start = new Date(Math.ceil((Date.now()+61*60000)/1800000)*1800000).toISOString();
  return { startDatetime:start,endDatetime:new Date(Date.parse(start)+3*3600000).toISOString(),durationHours:3,
    firstName:"Customer",lastName:"Guest",phone:"+639171234567",address:"Street, City, Province, 1234",
    rooms:[{classificationId:classification,occupants:2,pricingVersion:1}],eligibleGuests:0,promoCode:null,
    selectedServices:[],specialRequests:"",expectedTotal:300,bookingPolicyVersion:1,termsPolicyId:id(200),privacyPolicyId:id(201),...overrides };
}
const guestReserve = async (input,request=id(150),guest=id(100)) => (await one("select room_guest_reserve($1,$2,$3::jsonb) result",[guest,request,JSON.stringify(input)])).result;

test("online room creation rejects previous, too-soon and off-grid slots on the server without writing records",async()=>{
  const input=await customerInput();
  const nextHalfHour=Math.floor(Date.now()/1800000)*1800000+1800000;
  for(const start of [nextHalfHour-3600000,nextHalfHour,Date.parse(input.startDatetime)+15*60000,Date.parse(input.startDatetime)+1000,Date.parse(input.startDatetime)+1]) {
    await assert.rejects(()=>guestReserve({...input,startDatetime:new Date(start).toISOString(),endDatetime:new Date(start+3*3600000).toISOString()}),code('22023'));
  }
  assert.equal((await one("select count(*)::int n from reservations")).n,0);
  assert.equal((await one("select count(*)::int n from room_assignments")).n,0);
});

test("customers reserve multiple physical rooms with services and only the larger declared eligibility or promo discount",async()=>{
  const input=await customerInput(), family=(await one("select classification_id from room_classifications where code='family'")).classification_id;
  await db.query("insert into services(service_id,name,billing_type,price,max_quantity) values($1,'Extra table','quantity',100,10)",[id(90)]);
  await db.exec("insert into promo_codes(code,discount_type,discount_value) values('ROOMGUEST','percent',20)");
  input.rooms.push({classificationId:family,occupants:6,pricingVersion:1});input.selectedServices=[{serviceId:id(90),quantity:2}];
  input.eligibleGuests=4;input.promoCode='ROOMGUEST';input.expectedTotal=1080;
  const result=await guestReserve(input);
  assert.equal(Number(result.totalAmount),1080);assert.equal((await one("select count(*)::int n from room_assignments")).n,2);
  const bill=await one("select discount_amount,discount_kind from transactions");assert.equal(Number(bill.discount_amount),120);assert.equal(bill.discount_kind,'promo');
  assert.equal((await one("select count(*)::int n from room_charges where created_by is null and auth_actor_id=$1",[id(100)])).n,3);
  assert.equal((await one("select count(*)::int n from reservation_services")).n,1);
  assert.equal((await one("select guest_id from reservations")).guest_id,id(100));
  assert.equal((await one("select state from promo_redemptions")).state,'held');
});
test("customer eligibility applies at creation but cannot be forged later through the guest promo action",async()=>{
  const result=await guestReserve(await customerInput({eligibleGuests:1,expectedTotal:270}));
  assert.equal(Number((await one("select discount_amount from transactions")).discount_amount),30);
  await assert.rejects(()=>one("select set_booking_discount($1,$2,2,null,270,'Unverified new count',true)",[result.id,id(100)]),code('42501'));
  // An unset creation GUC must also deny eligibility, rather than treating SQL NULL as permission.
  const a=await reserved(50,(await one("select room_id from physical_rooms where room_number='S02'")).room_id,10,13);
  await db.query("update reservations set guest_id=$1,room_pricing=true,status='pending' where reservation_id=$2",[id(100),a.reservation_id]);
  await assert.rejects(()=>one("select set_booking_discount($1,$2,1,null,1000,'Forged guest eligibility',true)",[a.reservation_id,id(100)]),code('42501'));
});
test("room save retries reuse their request identity and cannot create duplicate bookings or reuse altered input",async()=>{
  const input=await customerInput(), first=await guestReserve(input), second=await guestReserve(input);
  assert.equal(first.id,second.id);assert.equal((await one("select count(*)::int n from reservations")).n,1);
  await assert.rejects(()=>guestReserve({...input,specialRequests:'Changed details'}),code('40001'));
});
test("a multi-room shortage or changed quote rolls back every room, bill, charge and profile update",async()=>{
  await db.exec("update physical_rooms set is_active=false where room_number between 'S02' and 'S10'");
  const input=await customerInput();input.rooms.push({...input.rooms[0]});input.expectedTotal=600;input.firstName='Changed';
  await assert.rejects(()=>guestReserve(input),code('40001'));
  input.rooms.pop();input.expectedTotal=1;await assert.rejects(()=>guestReserve(input),code('40001'));
  for(const table of ['reservations','room_assignments','room_charges','transactions','room_activity'])assert.equal((await one(`select count(*)::int n from ${table}`)).n,0);
  assert.equal((await one("select first_name from guests where id=$1",[id(100)])).first_name,'Customer');
});
test("room customer bookings coexist with private-pool schedules but share all physical room claims",async()=>{
  const input=await customerInput();
  await db.query("insert into reservations(reservation_id,reference_number,commercial_type,status,start_datetime,end_datetime,adult_count,child_count) values($1,'PRIVATE-POOL','private_swimming','confirmed',$2,$3,2,0)",[id(50),input.startDatetime,input.endDatetime]);
  await guestReserve(input);
  const assigned=(await one("select room_id from room_assignments")).room_id;
  await assert.rejects(()=>reserved(51,assigned,2,4,'public_swimming'),code('40001'));
});
test("customer availability includes cleaning buffers and exposes no guest or reservation data",async()=>{
  const input=await customerInput(), booking=await guestReserve(input);
  const catalog=(await one("select room_guest_catalog($1,$2) c",[input.startDatetime,input.endDatetime])).c;
  const selected=(await one("select room_id from room_assignments")).room_id;
  const block=catalog.rooms.find(r=>r.room_id===selected).blocks[0];
  assert.equal(Date.parse(block.start_datetime),Date.parse(input.startDatetime)-3600000);
  assert.equal(Date.parse(block.end_datetime),Date.parse(input.endDatetime)+3600000);
  const text=JSON.stringify(catalog);assert.ok(!text.includes(booking.referenceNumber));assert.ok(!text.includes(input.phone));assert.ok(!text.includes('firstName'));
  assert.equal(catalog.rooms.length,20);
});
test("room payments enforce the full balance in SQL while private swimming keeps its down-payment workflow",async()=>{
  const result=await guestReserve(await customerInput());
  await assert.rejects(()=>db.query("insert into payments(reservation_id,amount,status,payment_type) values($1,60,'pending','downpayment')",[result.id]),code('22023'));
  await assert.rejects(()=>db.query("insert into payments(reservation_id,amount,status,payment_type) values($1,60,'pending','full')",[result.id]),code('22023'));
  await assert.rejects(()=>db.query("insert into payments(reservation_id,amount,status,payment_type) values($1,60,'pending','additional')",[result.id]),code('22023'));
  await db.query("insert into payments(reservation_id,amount,status,payment_type) values($1,300,'pending','full')",[result.id]);
  assert.equal((await one("select count(*)::int n from payments")).n,1);
});

test("room holds expire after 30 minutes without payment, while pending review and approved payment preserve inventory",async()=>{
  await db.exec(fn("docs/reservation-lifecycle-migration.sql","accept_payment_submission"));
  await db.exec(fn("docs/reservation-lifecycle-migration.sql","finish_payment_review"));
  await db.exec(fn("docs/reservation-lifecycle-migration.sql","expire_unpaid_reservations"));
  await db.exec(`alter table payments add column if not exists payment_id uuid default gen_random_uuid();
    create trigger test_accept_room_payment after insert on payments for each row execute function accept_payment_submission();
    create trigger test_finish_room_payment after update of status on payments for each row execute function finish_payment_review();`);
  try {
    const input=await customerInput(), before=Date.now();
    const unpaid=await guestReserve(input,id(151)), review=await guestReserve(input,id(152)), approved=await guestReserve(input,id(153));
    const deadline=Date.parse(unpaid.paymentDeadlineAt);
    assert.ok(deadline>=before+30*60000 && deadline<=Date.now()+30*60000);
    for(const booking of [review,approved])await db.query("insert into payments(reservation_id,amount,status,payment_type) values($1,300,'pending','full')",[booking.id]);
    assert.equal((await one("select status from reservations where reservation_id=$1",[review.id])).status,'payment_submitted');
    await db.query("update payments set status='verified' where reservation_id=$1",[approved.id]);
    assert.equal((await one("select status from reservations where reservation_id=$1",[approved.id])).status,'confirmed');
    await db.exec("update reservations set payment_deadline_at=clock_timestamp()-interval '1 second'");
    assert.equal((await one("select expire_unpaid_reservations() n")).n,1);
    assert.equal((await one("select status from reservations where reservation_id=$1",[unpaid.id])).status,'expired');
    assert.equal((await one("select state from room_assignments where reservation_id=$1",[unpaid.id])).state,'cancelled');
    for(const booking of [review,approved]) {
      const assignment=await one("select room_id,state from room_assignments where reservation_id=$1",[booking.id]);
      assert.equal(assignment.state,'reserved');
      await assert.rejects(()=>one("select room_assert_available($1,$2,$3)",[assignment.room_id,input.startDatetime,input.endDatetime]),code('40001'));
    }
    await assert.rejects(()=>db.query("insert into payments(reservation_id,amount,status,payment_type) values($1,300,'pending','full')",[unpaid.id]));
  } finally {
    await db.exec("drop trigger test_accept_room_payment on payments;drop trigger test_finish_room_payment on payments");
  }
});
