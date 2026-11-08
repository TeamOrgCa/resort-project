import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const staff = "11111111-1111-4111-8111-111111111111", admin = "22222222-2222-4222-8222-222222222222";
const reservation = "33333333-3333-4333-8333-333333333333";
let db;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.walk_in_guests(email text not null);
    create table public.staff_users(id uuid,role text,is_active boolean);
    create table public.role_permissions(role text,permissions text[]);
    create table public.reservations(reservation_id uuid primary key,reference_number text,status text,booking_mode text,
      start_datetime timestamptz,end_datetime timestamptz,adult_count integer,child_count integer,
      updated_at timestamptz default now(),payment_deadline_at timestamptz,checked_in_at timestamptz,checked_out_at timestamptz,special_requests text);
    create table public.transactions(reservation_id uuid,total_amount numeric,paid_amount numeric,status text);
    create table public.reservation_services(reservation_id uuid,service_id uuid,quantity integer,price_at_time numeric,unique(reservation_id,service_id));
    create table public.reservation_units(reservation_id uuid,unit_id uuid,quantity integer,price_per_night numeric);
    create table public.services(service_id uuid,price numeric,is_active boolean);
    create table public.units(unit_id uuid,base_price numeric,is_active boolean,archived_at timestamptz);
    create table public.payments(reservation_id uuid,status text);
    create table public.reservation_reschedules(reservation_id uuid,status text);
    create table public.invoices(invoice_id uuid default gen_random_uuid(),reservation_id uuid,total_amount numeric,status text,created_at timestamptz default now());
    create table public.receipts(amount_paid numeric,transaction_total_at_time numeric);
    create table public.audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);`);
  const migration = readFileSync("docs/reservation-management-improvements-migration.sql", "utf8");
  await db.exec(migration); await db.exec(migration);
  await db.query("insert into public.staff_users values($1,'staff',true),($2,'admin',true)", [staff, admin]);
  await db.exec("insert into public.role_permissions values('staff',array['edit_reservation'])");
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec("truncate public.reservations,public.transactions,public.reservation_services,public.reservation_units,public.invoices,public.audit_logs,public.payments,public.reservation_reschedules,public.receipts,public.walk_in_guests");
  await db.query(`insert into public.reservations(reservation_id,reference_number,status,booking_mode,start_datetime,end_datetime,adult_count,child_count)
    values($1,'MV-TEST','confirmed','day',now()+interval '1 day',now()+interval '1 day 8 hours',20,0)`, [reservation]);
  await db.query("insert into public.transactions values($1,8600,8000,'partial')", [reservation]);
  await db.query("insert into public.invoices(reservation_id,total_amount,status) values($1,8600,'partially_paid')", [reservation]);
  await db.exec("insert into public.receipts values(8000,8600)");
});
async function change(overrides = {}, actor = staff) {
  const r = await one("select * from public.reservations"), bill = await one("select * from public.transactions");
  const expected = { updatedAt: r.updated_at, totalAmount: Number(bill.total_amount), paidAmount: Number(bill.paid_amount), services: [], units: [] };
  const patch = { bookingMode: r.booking_mode, startDatetime: r.start_datetime, endDatetime: r.end_datetime,
    adultCount: 21, childCount: 0, unitId: null, specialRequests: "", services: [], reason: "Another guest arrived at check-in", packageDelta: 125, expectedTotal: 8725, ...overrides };
  return one("select public.edit_staff_reservation($1,$2,$3,$4) result", [reservation, actor, expected, patch]);
}
test("checked-in guest counts update the bill and invoice, retain receipt snapshots and record a reasoned audit", async () => {
  await db.exec("update public.reservations set start_datetime=now()-interval '1 hour',end_datetime=now()+interval '7 hours',checked_in_at=now()");
  const result = await change(); assert.equal(result.result.remainingBalance, 725);
  assert.equal((await one("select adult_count from public.reservations")).adult_count, 21);
  assert.equal(Number((await one("select total_amount from public.invoices")).total_amount), 8725);
  assert.equal(Number((await one("select paid_amount from public.transactions")).paid_amount), 8000);
  assert.equal(Number((await one("select transaction_total_at_time from public.receipts")).transaction_total_at_time), 8600);
  const audit = (await one("select details from public.audit_logs")).details;
  assert.equal(audit.before.adult_count, 20); assert.equal(audit.after.adultCount, 21);
  assert.equal(audit.after_check_in, true); assert.equal(audit.guest_count_changed, true); assert.match(audit.reason, /arrived/);
});
test("schedule changes, completed stays, admin writes and a changed quote cannot bypass the atomic edit guard", async () => {
  await db.exec("update public.reservations set checked_in_at=now()");
  await assert.rejects(change({ startDatetime: "2030-01-01T08:00:00+08:00", endDatetime: "2030-01-01T16:00:00+08:00" }), /Schedule changes/);
  await assert.rejects(change({}, admin), /permission/);
  await assert.rejects(change({ expectedTotal: 1 }), /Bill changed/);
  assert.equal((await one("select adult_count from public.reservations")).adult_count, 20);
  assert.equal((await one("select count(*) n from public.audit_logs")).n, 0);
  await db.exec("update public.reservations set checked_out_at=now(),status='completed'");
  await assert.rejects(change(), /no longer editable/);
});
test("uncompleted checked-in stays remain count-editable after scheduled departure", async () => {
  await db.exec("update public.reservations set checked_in_at=now()-interval '9 hours',start_datetime=now()-interval '10 hours',end_datetime=now()-interval '1 hour'");
  assert.equal((await change()).result.totalAmount, 8725);
});
test("database rejects new past or current slots in PHT and accepts nullable offline email", async () => {
  for (const start of ["clock_timestamp()-interval '1 second'", "clock_timestamp()", "((clock_timestamp() at time zone 'Asia/Manila')::date + time '00:00') at time zone 'Asia/Manila'"]) {
    await assert.rejects(db.exec(`insert into public.reservations(reservation_id,start_datetime) values(gen_random_uuid(),${start})`), /already started/);
  }
  await db.exec("insert into public.walk_in_guests values(null)");
  assert.equal((await one("select email from public.walk_in_guests")).email, null);
  const privileges = await one("select has_function_privilege('authenticated','public.edit_staff_reservation(uuid,uuid,jsonb,jsonb)','execute') allowed");
  assert.equal(privileges.allowed, false);
});
