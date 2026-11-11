import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const manager = "11111111-1111-4111-8111-111111111111", cashier = "22222222-2222-4222-8222-222222222222", admin = "33333333-3333-4333-8333-333333333333";
const reservation = "44444444-4444-4444-8444-444444444444", guest = "55555555-5555-4555-8555-555555555555";
const migration = readFileSync("docs/reservation-no-show-migration.sql", "utf8");
let db;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const code = value => error => error.code === value;
const mark = (staff = manager, reason = "Guest never arrived at the resort") => one("select mark_reservation_no_show($1,$2,$3) result", [reservation, staff, reason]);
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('fixture.actor',true),'')::uuid$$;
    create table staff_users(id uuid primary key,role text,is_active boolean);
    create table role_permissions(role text primary key,permissions text[]);
    create table reservations(reservation_id uuid primary key,guest_id uuid,walk_in_guest_id uuid,reference_number text,status text,
      start_datetime timestamptz,end_datetime timestamptz,booking_mode text,booking_type text,adult_count integer,child_count integer,
      special_requests text,payment_deadline_at timestamptz,checked_in_at timestamptz,checked_in_by uuid,checked_out_at timestamptz,checked_out_by uuid);
    create table transactions(reservation_id uuid primary key,total_amount numeric,paid_amount numeric);
    create table payments(payment_id uuid primary key default gen_random_uuid(),reservation_id uuid,amount numeric,status text,reference_number text,proof_path text);
    create table refund_requests(reservation_id uuid,amount numeric,status text);
    create table reservation_reschedules(reservation_id uuid,status text);
    create table audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
    create table notifications(recipient_role text,recipient_id uuid,actor_id uuid,title text,message text,action_url text,entity_type text,entity_id uuid);
    grant select,insert,update on reservations to authenticated;
    insert into staff_users values('${manager}','staff',true),('${cashier}','cashier',true),('${admin}','admin',true);
    insert into role_permissions values('staff',array['edit_reservation']),('cashier',array['edit_reservation']);`);
  await db.exec(migration); await db.exec(migration);
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec("reset role;select set_config('fixture.actor','',false);drop trigger if exists fail_no_show_audit on audit_logs;truncate reservations,transactions,payments,refund_requests,reservation_reschedules,audit_logs,notifications cascade;update staff_users set is_active=true;update role_permissions set permissions=array['edit_reservation']");
  await db.query("insert into reservations(reservation_id,guest_id,reference_number,status,start_datetime,end_datetime,booking_type,booking_mode,adult_count,child_count) values($1,$2,'MV-NO-SHOW','confirmed',clock_timestamp()-interval '10 hours',clock_timestamp()-interval '2 hours','online','day',20,0)", [reservation, guest]);
  await db.query("insert into transactions values($1,10000,2000)", [reservation]);
  await db.query("insert into payments(reservation_id,amount,status,reference_number,proof_path) values($1,2000,'verified','ORIGINAL-PAYMENT','guest/proof.png')", [reservation]);
});

test("a manager records an ended confirmed stay as no-show atomically without changing billing or creating refunds", async () => {
  const original = await one("select * from transactions");
  const first = (await mark()).result, again = (await mark()).result;
  assert.equal(first.status, "no_show"); assert.equal(first.no_show_by, manager); assert.ok(first.no_show_at);
  assert.equal(first.checked_in_at, null); assert.equal(first.checked_out_at, null);
  assert.equal(again.alreadyMarkedNoShow, true); assert.equal(again.no_show_at, first.no_show_at);
  assert.deepEqual(await one("select * from transactions"), original);
  assert.equal((await one("select count(*)::int n from refund_requests")).n, 0);
  assert.equal((await one("select count(*)::int n from audit_logs")).n, 1);
  assert.equal((await one("select count(*)::int n from notifications")).n, 1);
  const alert = await one("select * from notifications"); assert.equal(alert.recipient_id, guest); assert.doesNotMatch(alert.message, /Guest never arrived/);
});

test("cashiers, administrators, inactive managers and managers without the grant cannot mark no-show", async () => {
  for (const actor of [cashier, admin]) await assert.rejects(() => mark(actor), code("42501"));
  await db.query("update staff_users set is_active=false where id=$1", [manager]); await assert.rejects(mark, code("42501"));
  await db.query("update staff_users set is_active=true where id=$1", [manager]);
  await db.exec("update role_permissions set permissions='{}' where role='staff'"); await assert.rejects(mark, code("42501"));
});

test("future reservations and ongoing stays are blocked until the full scheduled end timestamp", async () => {
  await db.exec("update reservations set start_datetime=clock_timestamp()-interval '2 hours',end_datetime=clock_timestamp()+interval '10 hours'");
  await assert.rejects(mark, code("40001"));
  await db.exec("update reservations set start_datetime=clock_timestamp()+interval '1 day',end_datetime=clock_timestamp()+interval '2 days'");
  await assert.rejects(mark, code("40001"));
  assert.equal((await one("select status from reservations")).status, "confirmed");
});

test("recorded arrival or departure, pending reviews and open refunds prevent a no-show", async () => {
  await db.exec("update reservations set checked_in_at=now()"); await assert.rejects(mark, code("40001"));
  await db.exec("update reservations set checked_in_at=null,checked_out_at=now()"); await assert.rejects(mark, code("40001"));
  await db.exec("update reservations set checked_out_at=null");
  await db.query("insert into payments(reservation_id,amount,status) values($1,500,'pending')", [reservation]); await assert.rejects(mark, code("40001"));
  await db.exec("delete from payments where status='pending'");
  await db.query("insert into reservation_reschedules values($1,'pending')", [reservation]); await assert.rejects(mark, code("40001"));
  await db.exec("delete from reservation_reschedules");
  for (const status of ["pending", "reviewed", "approved", "payout_submitted"]) {
    await db.query("insert into refund_requests values($1,500,$2)", [reservation, status]); await assert.rejects(mark, code("40001"));
    await db.exec("delete from refund_requests");
  }
});

test("browser roles cannot forge markers or call the service-only RPC even with a manager identity", async () => {
  await db.query("select set_config('fixture.actor',$1,false)", [manager]); await db.exec("set role authenticated");
  try {
    await assert.rejects(mark, code("42501"));
    await assert.rejects(() => db.query("update reservations set status='no_show',no_show_at=now(),no_show_by=$1,no_show_reason='Forged reason'", [manager]), code("42501"));
  } finally { await db.exec("reset role;select set_config('fixture.actor','',false)"); }
  assert.equal((await one("select status from reservations")).status, "confirmed");
});

test("no-show records cannot reopen, alter their marker or accept/change/remove payment history", async () => {
  await mark();
  await assert.rejects(() => db.exec("update reservations set status='confirmed'"), code("40001"));
  await assert.rejects(() => db.exec("update reservations set no_show_reason='Rewritten reason'"), code("40001"));
  for (const sql of ["insert into payments(reservation_id,amount,status) select reservation_id,100,'verified' from reservations", "update payments set amount=500", "update payments set reference_number='REPLACED'", "delete from payments"]) await assert.rejects(() => db.exec(sql), code("40001"));
  assert.equal((await one("select amount from payments")).amount, "2000");
});

test("a failed audit rolls back both status and notification, and migration reapplication preserves history", async () => {
  await db.exec("create or replace function fail_no_show_audit() returns trigger language plpgsql as $$begin raise exception 'Audit unavailable';end$$;create trigger fail_no_show_audit before insert on audit_logs for each row execute function fail_no_show_audit()");
  await assert.rejects(mark, /Audit unavailable/);
  assert.equal((await one("select status from reservations")).status, "confirmed");
  assert.equal((await one("select count(*)::int n from notifications")).n, 0);
  await db.exec("drop trigger fail_no_show_audit on audit_logs"); await mark();
  const record = await one("select * from reservations"); await db.exec(migration); await db.exec(migration);
  assert.deepEqual(await one("select * from reservations"), record);
});
