import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const migration = readFileSync("docs/reschedule-policy-migration.sql", "utf8");
const guestRequestsMigration = readFileSync("docs/guest-reschedule-requests-migration.sql", "utf8");
const { reschedulePolicy } = loadTsModule("lib/booking/reschedule-charge-policy.ts");
const admin = "11111111-1111-4111-8111-111111111111";
const staff = "22222222-2222-4222-8222-222222222222";
const guest = "33333333-3333-4333-8333-333333333333";
const reservation = "44444444-4444-4444-8444-444444444444";
let db;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const plus = (time, days) => new Date(Date.parse(time) + days * 86400000).toISOString();
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('fixture.actor',true),'')::uuid$$;
    create table public.staff_users(id uuid primary key,role text,is_active boolean);
    create table public.role_permissions(role text primary key,permissions text[]);
    create table public.reservations(reservation_id uuid primary key,guest_id uuid,reference_number text,
      status text,booking_mode text,start_datetime timestamptz,end_datetime timestamptz,adult_count integer,
      child_count integer,payment_deadline_at timestamptz,updated_at timestamptz default now(),special_requests text,checked_in_at timestamptz);
    create table public.transactions(reservation_id uuid primary key,total_amount numeric,paid_amount numeric,status text);
    create table public.reservation_services(reservation_id uuid,service_id uuid,quantity integer,price_at_time numeric,unique(reservation_id,service_id));
    create table public.reservation_units(reservation_id uuid,unit_id uuid,quantity integer,price_per_night numeric);
    create table public.services(service_id uuid primary key,price numeric,is_active boolean);
    create table public.units(unit_id uuid primary key,base_price numeric,is_active boolean,archived_at timestamptz);
    create table public.payments(reservation_id uuid,status text);
    create table public.refund_requests(reservation_id uuid,status text);
    create table public.invoices(invoice_id uuid primary key default gen_random_uuid(),reservation_id uuid,total_amount numeric,status text,created_at timestamptz default now());
    create table public.reservation_reschedules(reschedule_id uuid primary key default gen_random_uuid(),reservation_id uuid,requested_by uuid,
      status text default 'pending',old_start timestamptz,old_end timestamptz,new_start timestamptz,new_end timestamptz,
      reschedule_fee numeric,rate_adjustment numeric,created_at timestamptz default now(),approved_by uuid,approved_at timestamptz,rejection_reason text);
    create table public.audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
  `);
  await db.query("insert into public.staff_users values($1,'admin',true),($2,'staff',true)", [admin, staff]);
  await db.exec("insert into public.role_permissions values('staff',array['edit_reservation','reschedule_approval'])");
  await db.exec(migration);
  await db.exec(guestRequestsMigration);
  await db.exec(guestRequestsMigration);
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`reset role;select set_config('fixture.actor','',false);truncate public.reservation_reschedule_adjustments,public.reservations,public.transactions,public.invoices,
    public.audit_logs,public.reservation_reschedules,public.reservation_services,public.reservation_units,public.payments,public.refund_requests;
    update public.role_permissions set permissions=array['edit_reservation','reschedule_approval'];`);
  await db.query(`insert into public.reservations(reservation_id,guest_id,reference_number,status,booking_mode,start_datetime,end_datetime,adult_count,child_count)
    values($1,$2,'MV-TEST','confirmed','day',((now() at time zone 'Asia/Manila')::date+20+time '08:00') at time zone 'Asia/Manila',
      ((now() at time zone 'Asia/Manila')::date+20+time '16:00') at time zone 'Asia/Manila',20,0)`, [reservation, guest]);
  await db.query("insert into public.transactions values($1,8600,600,'partial');", [reservation]);
  await db.query("insert into public.invoices(reservation_id,total_amount,status) values($1,8600,'partially_paid')", [reservation]);
});
async function originalDays(days) {
  await db.query(`update public.reservations set start_datetime=((now() at time zone 'Asia/Manila')::date+$1::int+time '08:00') at time zone 'Asia/Manila',
    end_datetime=((now() at time zone 'Asia/Manila')::date+$1::int+time '16:00') at time zone 'Asia/Manila'`, [days]);
}
async function moved({ actor = staff, ack = false, days = 1, feeOverride } = {}) {
  const r = await one("select * from public.reservations");
  const t = await one("select * from public.transactions");
  const policy = (await one("select public.reschedule_policy_snapshot($1) policy", [r.start_datetime])).policy;
  const patch = { bookingMode: "day", startDatetime: plus(r.start_datetime, days), endDatetime: plus(r.end_datetime, days),
    adultCount: 20, childCount: 0, unitId: null, services: [], specialRequests: "", reason: "Guest requested another date by phone",
    packageDelta: 0, rescheduleFee: feeOverride ?? policy.noticeFee, dateRateAdjustment: 0,
    lateRescheduleAcknowledged: ack, expectedTotal: Number(t.total_amount) + policy.noticeFee };
  const expected = { updatedAt: r.updated_at, totalAmount: Number(t.total_amount), paidAmount: Number(t.paid_amount), services: [], units: [] };
  return { patch, expected, save: async (rpc = "edit_staff_reservation_reschedule") =>
    (await one("select public." + rpc + "($1,$2,$3,$4) result", [reservation, actor, expected, patch])).result };
}
async function guestRequest(days = 1) {
  return one(`insert into public.reservation_reschedules(reservation_id,requested_by,old_start,old_end,new_start,new_end,reschedule_fee,rate_adjustment)
    select reservation_id,guest_id,start_datetime,end_datetime,start_datetime+make_interval(days=>$1),end_datetime+make_interval(days=>$1),
      (public.reschedule_policy_snapshot(start_datetime)->>'noticeFee')::numeric,500 from public.reservations returning *`, [days]);
}

test("SQL and application policies agree on peak months, Philippine dates, deadlines and every fee bracket", async () => {
  for (let month = 1; month <= 12; month++) {
    for (const days of [-1, 0, 1, 2, 3, 5, 6, 7, 13, 14]) {
      const original = `2027-${String(month).padStart(2, "0")}-20T08:00:00+08:00`;
      const now = plus(original, -days);
      const sql = (await one("select public.reschedule_policy_snapshot($1,$2) policy", [original, now])).policy;
      const js = reschedulePolicy(original, Date.parse(now));
      for (const key of ["peak", "minimumNoticeDays", "daysNotice", "deadline", "allowed", "noticeFee"]) assert.equal(sql[key], js[key], `${original} ${days} ${key}`);
    }
  }
  const original = "2027-09-20T08:00:00+08:00";
  for (const now of ["2027-09-06T23:59:59+08:00", "2027-09-07T00:00:00+08:00"]) {
    const sql = (await one("select public.reschedule_policy_snapshot($1,$2) policy", [original, now])).policy;
    assert.equal(sql.allowed, reschedulePolicy(original, Date.parse(now)).allowed);
  }
});

test("staff date edits charge exactly once, preserve payments, update invoices and reject stale retries", async () => {
  const edit = await moved();
  assert.equal((await edit.save()).totalAmount, 8650);
  assert.equal((await one("select paid_amount from public.transactions")).paid_amount, "600");
  assert.equal((await one("select total_amount from public.invoices")).total_amount, "8650.00");
  assert.equal((await one("select notice_fee from public.reservation_reschedule_adjustments")).notice_fee, "50.00");
  await assert.rejects(() => edit.save(), e => e.code === "40001");
  assert.equal((await one("select count(*)::int n from public.audit_logs")).n, 1);
});

test("late and past-date edits require an acknowledged, authorized exception and the proper fee", async () => {
  await originalDays(2);
  await assert.rejects(async () => (await moved({ days: 10 })).save(), e => e.code === "42501");
  await db.exec("update public.role_permissions set permissions=array['edit_reservation']");
  await assert.rejects(async () => (await moved({ days: 10, ack: true })).save(), e => e.code === "42501");
  assert.equal((await (await moved({ actor: admin, days: 10, ack: true })).save()).rescheduleFee, 300);
  await originalDays(-1);
  assert.equal((await (await moved({ actor: admin, days: 10, ack: true })).save()).rescheduleFee, 500);
  assert.equal((await one("select count(*)::int n from public.reservation_reschedule_adjustments where late_exception")).n, 2);
});

test("forged fees, changed packages, open refunds and completed reservations cannot be rescheduled", async () => {
  await assert.rejects(async () => (await moved({ feeOverride: 0 })).save(), e => e.code === "40001");
  const edit = await moved(); edit.patch.bookingMode = "night";
  await assert.rejects(() => edit.save(), e => e.code === "22023");
  await db.query("insert into public.refund_requests values($1,'approved')", [reservation]);
  await assert.rejects(async () => (await moved()).save(), e => e.code === "40001");
  await db.exec("truncate public.refund_requests;update public.reservations set status='completed'");
  await assert.rejects(async () => (await moved()).save(), e => e.code === "40001");
});

test("audit failures roll back the date, bill, invoice and charge record together", async () => {
  const before = await one("select start_datetime from public.reservations");
  await db.exec("create function public.fail_reschedule_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable';end$$;create trigger fail_reschedule_audit before insert on public.audit_logs for each row execute function public.fail_reschedule_audit()");
  try { await assert.rejects(async () => (await moved()).save(), /audit unavailable/); }
  finally { await db.exec("drop trigger fail_reschedule_audit on public.audit_logs"); }
  assert.equal((await one("select total_amount from public.transactions")).total_amount, "8600");
  assert.equal((await one("select count(*)::int n from public.reservation_reschedule_adjustments")).n, 0);
  assert.deepEqual((await one("select start_datetime from public.reservations")).start_datetime, before.start_datetime);
});

test("guest requests allow short notice and prevent duplicates without charging before approval", async () => {
  await guestRequest();
  await assert.rejects(() => guestRequest(), e => e.code === "40001");
  assert.equal((await one("select total_amount from public.transactions")).total_amount, "8600");
  await db.exec("truncate public.reservation_reschedules"); await originalDays(2);
  const original = await one("select start_datetime,end_datetime from public.reservations");
  const request = await guestRequest(); assert.equal(Number(request.reschedule_fee), 300);
  assert.deepEqual(await one("select start_datetime,end_datetime from public.reservations"), original);
  assert.equal((await one("select total_amount from public.transactions")).total_amount, "8600");
});

test("short-notice, same-day and past-date requests wait for authorized approval and retain the correct fee", async () => {
  for (const [days, fee] of [[6, 50], [5, 100], [3, 100], [2, 300], [1, 300], [0, 500], [-1, 500]]) {
    await db.exec("truncate public.reservation_reschedules,public.audit_logs;update public.reservations set status='confirmed',checked_in_at=null;update public.transactions set total_amount=8600");
    await originalDays(days);
    const before = await one("select start_datetime from public.reservations");
    const request = await guestRequest(30); assert.equal(Number(request.reschedule_fee), fee);
    assert.equal(request.status, "pending");
    assert.deepEqual((await one("select start_datetime from public.reservations")).start_datetime, before.start_datetime);
    assert.equal((await one("select total_amount from public.transactions")).total_amount, "8600");
    await db.exec("update public.reservations set status='reschedule_requested'");
    const result = (await one("select public.approve_reschedule_request($1,$2) result", [request.reschedule_id, staff])).result;
    assert.equal(result.additionalCharge, fee + 500); assert.equal(result.totalAmount, 8600 + fee + 500); assert.equal(result.paidAmount, 600);
    const audit = (await one("select details from public.audit_logs")).details;
    assert.equal(audit.notice_fee, fee); assert.equal(audit.requested_by, guest); assert.equal(audit.policy_at_request.daysNotice, days);
    assert.equal(audit.late_request, days < audit.policy_at_request.minimumNoticeDays);
  }
});

test("late requests retain ownership, arrival, financial-review and quote protections", async () => {
  await originalDays(2);
  await db.query("select set_config('fixture.actor',$1,false)", [admin]);
  await assert.rejects(() => guestRequest(), e => e.code === "42501");
  await db.query("select set_config('fixture.actor',$1,false)", [guest]);
  await db.exec("update public.reservations set checked_in_at=now()");
  await assert.rejects(() => guestRequest(), e => e.code === "40001");
  await db.exec("update public.reservations set checked_in_at=null");
  for (const table of ["payments", "refund_requests"]) {
    await db.query(`insert into public.${table} values($1,'pending')`, [reservation]);
    await assert.rejects(() => guestRequest(), e => e.code === "40001");
    await db.exec(`truncate public.${table}`);
  }
  const request = await guestRequest(); await db.exec("update public.reservations set status='reschedule_requested'");
  await db.exec("update public.reservation_reschedules set reschedule_fee=0");
  await assert.rejects(() => one("select public.approve_reschedule_request($1,$2)", [request.reschedule_id, staff]), e => e.code === "40001");
  await db.exec("set role authenticated");
  await assert.rejects(() => one("select public.approve_reschedule_request($1,$2)", [request.reschedule_id, staff]), e => e.code === "42501");
  await db.exec("reset role");
  assert.equal((await one("select total_amount from public.transactions")).total_amount, "8600");
});

test("late approval records and charges roll back together if auditing fails", async () => {
  await originalDays(2); const request = await guestRequest();
  await db.exec("update public.reservations set status='reschedule_requested'");
  const before = await one("select start_datetime from public.reservations");
  await db.exec("create or replace function public.fail_reschedule_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable';end$$;create trigger fail_reschedule_audit before insert on public.audit_logs for each row execute function public.fail_reschedule_audit()");
  try { await assert.rejects(() => one("select public.approve_reschedule_request($1,$2)", [request.reschedule_id, staff]), /audit unavailable/); }
  finally { await db.exec("drop trigger fail_reschedule_audit on public.audit_logs"); }
  assert.deepEqual((await one("select start_datetime from public.reservations")).start_datetime, before.start_datetime);
  assert.equal((await one("select total_amount from public.transactions")).total_amount, "8600");
  assert.equal((await one("select status from public.reservation_reschedules")).status, "pending");
});

test("waiting for staff review does not increase a late request's original notice fee", async () => {
  await originalDays(2); const request = await guestRequest();
  await db.exec("update public.reservations set status='reschedule_requested';update public.reservation_reschedules set created_at=created_at-interval '4 days',reschedule_fee=50");
  const result = (await one("select public.approve_reschedule_request($1,$2) result", [request.reschedule_id, staff])).result;
  assert.equal(result.additionalCharge, 550); assert.equal(result.totalAmount, 9150);
  assert.equal((await one("select details from public.audit_logs")).details.policy_at_request.daysNotice, 6);
});

test("guest approval preserves the captured bill despite legacy recalculation triggers", async () => {
  const request = await guestRequest();
  await db.exec("update public.reservations set status='reschedule_requested';create function public.legacy_recalculate() returns trigger language plpgsql as $$begin update public.transactions set total_amount=1;return new;end$$;create trigger legacy_recalculate after update on public.reservations for each row execute function public.legacy_recalculate()");
  try {
    const result = (await one("select public.approve_reschedule_request($1,$2) result", [request.reschedule_id, staff])).result;
    assert.equal(result.totalAmount, 9150); assert.equal(result.paidAmount, 600);
    assert.equal((await one("select total_amount from public.invoices")).total_amount, "9150.00");
    await assert.rejects(() => one("select public.approve_reschedule_request($1,$2)", [request.reschedule_id, staff]), /no longer pending/);
  } finally { await db.exec("drop trigger legacy_recalculate on public.reservations"); }
});

test("the original services-edit RPC cannot bypass date charges and reapplying preserves history", async () => {
  await assert.rejects(async () => (await moved()).save("edit_staff_reservation"), e => e.code === "22023");
  await (await moved()).save(); await db.exec(migration); await db.exec(guestRequestsMigration);
  assert.equal((await one("select count(*)::int n from public.reservation_reschedule_adjustments")).n, 1);
  assert.equal((await one("select total_amount from public.transactions")).total_amount, "8650.00");
});

test("approval rechecks permission, fixed times and open financial reviews", async () => {
  const request = await guestRequest(); await db.exec("update public.reservations set status='reschedule_requested'");
  const approve = actor => one("select public.approve_reschedule_request($1,$2)", [request.reschedule_id, actor]);
  await db.exec("update public.role_permissions set permissions=array['edit_reservation']");
  await assert.rejects(() => approve(staff), e => e.code === "42501");
  await db.query("insert into public.refund_requests values($1,'approved')", [reservation]);
  await assert.rejects(() => approve(admin), e => e.code === "40001");
  await db.exec("truncate public.refund_requests;update public.reservation_reschedules set new_end=new_end+interval '1 hour'");
  await assert.rejects(() => approve(admin), e => e.code === "22023");
  assert.equal((await one("select total_amount from public.transactions")).total_amount, "8600");
});
