import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const migration = readFileSync("docs/reservation-calendar-attendance-migration.sql", "utf8");
const staff = "11111111-1111-4111-8111-111111111111", booking = "22222222-2222-4222-8222-222222222222";
let db;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table staff_users(id uuid primary key,role text,is_active boolean);
    create table role_permissions(role text,permissions text[]);
    create table reservations(reservation_id uuid primary key,reference_number text,status text,start_datetime timestamptz,end_datetime timestamptz);
    create table audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);`);
  await db.exec(migration); await db.exec(migration);
  await db.exec("grant select,insert,update on public.reservations to authenticated");
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec("reset role; truncate audit_logs,reservations,role_permissions,staff_users cascade");
  await db.query("insert into staff_users values($1,'admin',true)", [staff]);
  await db.query(`insert into reservations(reservation_id,reference_number,status,start_datetime,end_datetime)
    values($1,'MV-ARRIVAL','confirmed',date_trunc('day',clock_timestamp() at time zone 'Asia/Manila') at time zone 'Asia/Manila',clock_timestamp()+interval '2 hours')`, [booking]);
});
const arrive = () => one("select public.check_in_reservation($1,$2) result", [booking, staff]);
const code = value => error => error.code === value;
test("check-in records server time and staff with an audit entry; retries do not duplicate it", async () => {
  const first = (await arrive()).result, second = (await arrive()).result;
  assert.ok(first.checked_in_at); assert.equal(first.checked_in_by, staff); assert.equal(first.status, "confirmed");
  assert.equal(first.checked_in_at, second.checked_in_at);
  assert.equal((await one("select count(*)::int n from audit_logs")).n, 1);
  assert.equal((await one("select details from audit_logs")).details.reference_number, "MV-ARRIVAL");
});
test("inactive and ungranted staff cannot record attendance; edit permission permits it", async () => {
  await db.exec("update staff_users set is_active=false"); await assert.rejects(arrive, code("42501"));
  await db.exec("update staff_users set is_active=true,role='staff'"); await assert.rejects(arrive, code("42501"));
  await db.exec("insert into role_permissions values('staff',array['edit_reservation'])"); assert.ok((await arrive()).result.checked_in_at);
});
test("unconfirmed, cancelled, future and ended stays cannot be checked in", async () => {
  for (const status of ["pending", "cancelled", "payment_submitted", "reschedule_requested"]) {
    await db.query("update reservations set status=$1", [status]); await assert.rejects(arrive, code("40001"));
  }
  await db.exec("update reservations set status='confirmed',start_datetime=clock_timestamp()+interval '2 days',end_datetime=clock_timestamp()+interval '3 days'");
  await assert.rejects(arrive, code("40001"));
  await db.exec("update reservations set start_datetime=clock_timestamp()-interval '2 hours',end_datetime=clock_timestamp()-interval '1 hour'");
  await assert.rejects(arrive, code("40001"));
});
test("browser roles cannot call the trusted RPC or forge attendance through direct writes", async () => {
  await db.exec("set role authenticated");
  try {
    await assert.rejects(arrive, code("42501"));
    await assert.rejects(() => db.exec("update reservations set checked_in_at=now()"), code("42501"));
    await assert.rejects(() => db.exec("insert into reservations(reservation_id,checked_in_at) values(gen_random_uuid(),now())"), code("42501"));
    await db.exec("update reservations set reference_number='MV-RENAMED'");
  } finally { await db.exec("reset role"); }
});
