import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const admin = "11111111-1111-4111-8111-111111111111", manager = "22222222-2222-4222-8222-222222222222";
const guest = "33333333-3333-4333-8333-333333333333", guest2 = "44444444-4444-4444-8444-444444444444";
const slot = "55555555-5555-4555-8555-555555555555";
const cashier = "66666666-6666-4666-8666-666666666666";
let db;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const actor = async (id, role = "authenticated") => {
  await db.query("select set_config('test.actor',$1,false),set_config('test.role',$2,false)", [id ?? "", role]);
};
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function auth.role() returns text language sql as $$select current_setting('test.role',true)$$;
    create table staff_users(id uuid primary key,role text,is_active boolean);
    create table role_permissions(role text,permissions text[]);
    create function refund_staff_permission(p text) returns boolean language sql as $$select exists(select 1 from public.staff_users s join public.role_permissions rp on rp.role=s.role where s.id=auth.uid() and s.is_active and p=any(rp.permissions))$$;
    create table guests(id uuid primary key,is_active boolean);
    create table reservations(reservation_id uuid primary key default gen_random_uuid(),guest_id uuid,status text,start_datetime timestamptz,end_datetime timestamptz,payment_deadline_at timestamptz);
    create table maintenance_blocks(block_id uuid primary key default gen_random_uuid(),name text,reason text,start_date date,end_date date,status text default 'active',created_by uuid,released_by uuid,released_at timestamptz);
    create table ocular_time_slots(slot_id uuid primary key,start_time time,end_time time,max_capacity int,is_active boolean);
    create table ocular_visits(visit_id uuid primary key default gen_random_uuid(),guest_id uuid,reference_number text unique,scheduled_date date,time_slot_id uuid,status text);
    create table audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
    create table notifications(recipient_role text,recipient_id uuid,actor_id uuid,title text,message text,action_url text,entity_type text,entity_id uuid);
    insert into staff_users values('${admin}','admin',true),('${manager}','staff',true),('${cashier}','cashier',true);
    insert into role_permissions values('staff',array['ocular_approval','edit_reservation']),('cashier',array['edit_reservation']);
    insert into guests values('${guest}',true),('${guest2}',true);
    insert into ocular_time_slots values('${slot}','09:00','10:00',1,true);
    insert into maintenance_blocks(name,reason,start_date,end_date) values('Private repair','Confidential reason','2030-01-02','2030-01-03');
    insert into notifications values('guest','${guest}',null,'Private repair','Confidential reason',null,'maintenance_block',null);`);
  await db.exec(readFileSync("docs/ocular-review-migration.sql", "utf8"));
  await db.exec(readFileSync("docs/manager-ocular-cancellation-migration.sql", "utf8"));
  const migration = readFileSync("docs/timed-maintenance-auto-ocular-migration.sql", "utf8");
  await db.exec(migration); await db.exec(migration);
  const managerOnly = readFileSync("docs/manager-only-maintenance-migration.sql", "utf8");
  await db.exec(managerOnly); await db.exec(managerOnly);
  const legacy = await one("select start_datetime,end_datetime from maintenance_blocks");
  assert.equal(legacy.start_datetime.toISOString(), "2030-01-01T16:00:00.000Z");
  assert.equal(legacy.end_datetime.toISOString(), "2030-01-03T16:00:00.000Z");
  assert.doesNotMatch(JSON.stringify((await one("select title,message from notifications"))), /Private|Confidential/);
  await db.exec(`create trigger reject_maintenance_booking_trigger before insert or update of start_datetime,end_datetime,status on reservations for each row execute function reject_maintenance_booking();`);
});
after(async () => db?.close());
beforeEach(async () => {
  await actor(null, "service_role");
  await db.exec("truncate reservations,maintenance_blocks,ocular_visits,audit_logs,notifications; update ocular_time_slots set max_capacity=1,is_active=true; update staff_users set is_active=true; update role_permissions set permissions=array['ocular_approval','edit_reservation'] where role='staff'");
});
const block = async (start = "2035-01-05T10:00:00+08:00", end = "2035-01-05T12:00:00+08:00") =>
  one("select create_timed_maintenance_block('Internal title','Confidential repair',$1,$2) id", [start, end]);
const visit = async (owner = guest, reference = "OV-TEST", date = "2035-01-05") =>
  one("select save_confirmed_ocular_visit($1,$2,$3,$4) result", [owner, date, slot, reference]);

test("PHT intervals permit adjacent bookings but reject actual overlap, invalid intervals and overlapping maintenance", async () => {
  await actor(manager); await block();
  await db.exec("insert into reservations(status,start_datetime,end_datetime) values('confirmed','2035-01-05T08:00+08','2035-01-05T10:00+08'),('confirmed','2035-01-05T12:00+08','2035-01-05T18:00+08')");
  await assert.rejects(db.exec("insert into reservations(status,start_datetime,end_datetime) values('confirmed','2035-01-05T11:00+08','2035-01-05T13:00+08')"), /unavailable due to maintenance/);
  await assert.rejects(block("2035-01-05T10:30+08", "2035-01-05T11:30+08"), /exclusion constraint/);
  await assert.rejects(block("2035-01-05T12:00+08", "2035-01-05T10:00+08"), /valid maintenance/);
  const notification = await one("select title,message from notifications limit 1");
  assert.doesNotMatch(JSON.stringify(notification), /Internal|Confidential/); assert.match(notification.message, /10:00.*12:00.*Philippine/);
});
test("only authorized active managers can create and release blocks; conflicts still prevent creation", async () => {
  for (const id of [guest, admin, cashier]) {
    await actor(id); await assert.rejects(block(), /Authorized manager/);
  }
  await actor(manager); const result = await block();
  for (const id of [admin, cashier]) {
    await actor(id); await assert.rejects(db.query("select release_maintenance_block($1)", [result.id]), /Authorized manager/);
  }
  assert.equal((await one("select status from maintenance_blocks where block_id=$1", [result.id])).status, "active");
  await actor(manager); await db.query("select release_maintenance_block($1)", [result.id]);
  await db.exec("insert into reservations(status,start_datetime,end_datetime) values('confirmed','2035-01-05T10:00+08','2035-01-05T11:00+08')");
  await assert.rejects(block(), /active reservation overlaps/);
});

test("maintenance RPCs reject a manager after the edit grant or active status is revoked", async () => {
  await actor(manager); const result = await block();
  await db.exec("update role_permissions set permissions=array[]::text[] where role='staff'");
  await assert.rejects(block("2035-01-07T09:00+08", "2035-01-07T10:00+08"), /Authorized manager/);
  await assert.rejects(db.query("select release_maintenance_block($1)", [result.id]), /Authorized manager/);
  await db.exec("update role_permissions set permissions=array['edit_reservation'] where role='staff'; update staff_users set is_active=false where role='staff'");
  await assert.rejects(block("2035-01-07T09:00+08", "2035-01-07T10:00+08"), /Authorized manager/);
  await assert.rejects(db.query("select release_maintenance_block($1)", [result.id]), /Authorized manager/);
  assert.equal((await one("select status from maintenance_blocks where block_id=$1", [result.id])).status, "active");
});
test("ocular visits auto-confirm, enforce capacity and ownership, and reject duplicate guest dates and maintenance", async () => {
  const first = (await visit()).result; assert.equal(first.status, "confirmed");
  await assert.rejects(visit(guest2, "OV-FULL"), /slot is full/);
  await db.exec("update ocular_time_slots set max_capacity=2");
  await assert.rejects(visit(guest, "OV-DUPLICATE"), /already have an ocular visit/);
  const second = (await visit(guest2, "OV-SECOND")).result; assert.equal(second.status, "confirmed");
  await assert.rejects(db.query("select save_confirmed_ocular_visit($1,'2035-01-06',$2,null,$3)", [guest2, slot, first.visit_id]), /cannot be rescheduled/);
  await actor(manager); await assert.rejects(block("2035-01-05T09:30+08", "2035-01-05T10:30+08"), /ocular visit overlaps/);
  await block("2035-01-06T09:30+08", "2035-01-06T10:30+08");
  await actor(null, "service_role");
  await assert.rejects(visit(guest, "OV-MAINTENANCE", "2035-01-06"), /unavailable due to maintenance/);
  await assert.rejects(db.query("select save_confirmed_ocular_visit($1,'2035-01-06',$2,null,$3)", [guest, slot, first.visit_id]), /unavailable due to maintenance/);
  assert.equal((await one("select scheduled_date::text d from ocular_visits where visit_id=$1", [first.visit_id])).d, "2035-01-05");
});
test("visited action is authorized, cannot record future attendance and records past attendance with an audit", async () => {
  const v = (await visit()).result;
  await assert.rejects(db.query("select complete_ocular_visit($1,$2)", [v.visit_id, admin]), /permission/);
  await assert.rejects(db.query("select complete_ocular_visit($1,$2)", [v.visit_id, manager]), /before its scheduled time/);
  // Seed a historical visit without bypassing any live application workflow.
  await db.exec("alter table ocular_visits disable trigger guard_ocular_review_write; update ocular_visits set scheduled_date=current_date-1; alter table ocular_visits enable trigger guard_ocular_review_write");
  const completed = (await one("select complete_ocular_visit($1,$2) v", [v.visit_id, manager])).v;
  assert.equal(completed.status, "completed");
  assert.match((await one("select action from audit_logs")).action, /visited/);
  assert.equal((await one("select has_function_privilege('authenticated','save_confirmed_ocular_visit(uuid,date,uuid,text,uuid)','execute') allowed")).allowed, false);
  assert.equal((await one("select has_function_privilege('service_role','review_ocular_visit(uuid,text,text,uuid)','execute') allowed")).allowed, false);
});
