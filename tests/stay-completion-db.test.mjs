import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const staff = "11111111-1111-4111-8111-111111111111", guest = "22222222-2222-4222-8222-222222222222", reservation = "33333333-3333-4333-8333-333333333333", slot = "44444444-4444-4444-8444-444444444444", visit = "55555555-5555-4555-8555-555555555555";
let db;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const actor = id => db.query("select set_config('fixture.actor',$1,false)", [id]);
const arrive = () => one("select public.check_in_reservation($1,$2) result", [reservation, staff]);
const depart = () => one("select public.check_out_reservation($1,$2) result", [reservation, staff]);
function fn(path, name) { const sql = readFileSync(path, "utf8"), start = sql.indexOf(`create or replace function public.${name}(`); assert.ok(start >= 0); return sql.slice(start, sql.indexOf("$$;", start) + 3); }
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('fixture.actor',true),'')::uuid$$;
    create table staff_users(id uuid primary key,role text,is_active boolean);
    create table role_permissions(role text primary key,permissions text[]);
    create table guests(id uuid primary key,is_active boolean default true);
    create table reservations(reservation_id uuid primary key,guest_id uuid,reference_number text,status text,start_datetime timestamptz,end_datetime timestamptz,booking_mode text,booking_policy_version bigint);
    create table transactions(reservation_id uuid primary key,total_amount numeric,paid_amount numeric default 0,status text,cancellation_deposit_base numeric,
      balance numeric generated always as(greatest(total_amount-paid_amount,0)) stored);
    create table payments(reservation_id uuid,amount numeric,status text);
    create table refund_requests(reservation_id uuid,amount numeric,status text);
    create table reservation_reschedules(reservation_id uuid,status text);
    create table invoices(reservation_id uuid,status text);
    create table booking_policy_versions(version bigint primary key,guest_cancellation_notice_hours integer);
    create table audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
    create table reviews(review_id uuid primary key default gen_random_uuid(),guest_id uuid,reservation_id uuid,title text,review_text text,archived_at timestamptz,archived_by uuid,archive_reason text,created_at timestamptz,updated_at timestamptz);
    create table review_submission_log(review_id uuid primary key,guest_id uuid,fingerprint text,created_at timestamptz);
    create table ocular_time_slots(slot_id uuid primary key,start_time time,end_time time);
    create table ocular_visits(visit_id uuid primary key,guest_id uuid,reference_number text,scheduled_date date,time_slot_id uuid,status text);
    create function public.refund_staff_permission(text) returns boolean language sql as $$select false$$;`);
  await db.exec(fn("docs/overpayment-refunds-migration.sql", "refresh_reservation_payment_totals"));
  await db.exec(fn("docs/review-feedback-management-migration.sql", "review_submission_policy"));
  await db.exec(fn("docs/review-feedback-management-migration.sql", "guard_review_submission"));
  await db.exec("create trigger guard_review_submission before insert on reviews for each row execute function public.guard_review_submission()");
  await db.exec(readFileSync("docs/reservation-calendar-attendance-migration.sql", "utf8"));
  for (let i = 0; i < 2; i++) {
    await db.exec(readFileSync("docs/stay-completion-migration.sql", "utf8"));
    await db.exec(readFileSync("docs/ocular-review-migration.sql", "utf8"));
  }
  await db.exec("grant select,insert,update on reservations,reviews,ocular_visits to authenticated");
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec("reset role;drop trigger if exists fail_stay_audit on audit_logs;truncate reservations,staff_users,role_permissions,guests,transactions,payments,refund_requests,reservation_reschedules,invoices,booking_policy_versions,audit_logs,reviews,review_submission_log,ocular_visits,ocular_time_slots cascade");
  await actor(guest);
  await db.query("insert into staff_users values($1,'admin',true);", [staff]);
  await db.query("insert into guests values($1,true)", [guest]);
  await db.exec("insert into booking_policy_versions values(1,0)");
  await db.query("insert into reservations values($1,$2,'MV-STAY','confirmed',date_trunc('day',clock_timestamp() at time zone 'Asia/Manila') at time zone 'Asia/Manila',clock_timestamp()+interval '2 hours','day',1,null,null,null,null)", [reservation, guest]);
  await db.query("insert into transactions(reservation_id,total_amount,paid_amount,status) values($1,1000,1000,'paid')", [reservation]);
  await db.query("insert into invoices values($1,'issued')", [reservation]);
  await db.query("insert into ocular_time_slots values($1,'10:00','11:00')", [slot]);
  await db.query("insert into ocular_visits(visit_id,guest_id,reference_number,scheduled_date,time_slot_id,status) values($1,$2,'MV-OCULAR',current_date+2,$3,'pending')", [visit, guest, slot]);
});
const pay = amount => db.query("insert into payments values($1,$2,'verified')", [reservation, amount]);
const rejectCode = value => error => error.code === value;

test("checkout needs actual check-in and net verified full payment; cached paid totals and pending receipts cannot bypass it", async () => {
  await pay(1000); await assert.rejects(depart, rejectCode("40001")); await arrive();
  await db.exec("delete from payments"); await assert.rejects(depart, rejectCode("40001"));
  await pay(200); await assert.rejects(depart, rejectCode("40001"));
  await db.query("insert into payments values($1,800,'pending')", [reservation]); await assert.rejects(depart, rejectCode("40001"));
  await db.exec("update payments set status='verified'");
  const first = (await depart()).result, second = (await depart()).result;
  assert.equal(first.status, "completed"); assert.ok(first.checked_out_at); assert.equal(first.checked_out_by, staff);
  assert.equal(first.checked_out_at, second.checked_out_at); assert.equal(second.alreadyCheckedOut, true);
  assert.equal((await one("select status from invoices")).status, "paid");
  assert.equal((await one("select count(*)::int n from audit_logs where action='Checked out guest and completed stay'")).n, 1);
});

test("services and previous refunds affect checkout; an overpayment can still fully cover the bill", async () => {
  await arrive(); await pay(1200);
  await db.query("insert into refund_requests values($1,300,'refunded')", [reservation]);
  await assert.rejects(depart, rejectCode("40001"));
  await pay(100); await db.exec("update transactions set total_amount=1100");
  await assert.rejects(depart, rejectCode("40001"));
  await pay(200); assert.equal((await depart()).result.status, "completed");
});

test("arrival locks cancellation previews, direct cancellation, schedule edits and reschedule submissions", async () => {
  await arrive();
  const preview = (await one("select get_cancellation_preview($1,'guest') result", [reservation])).result;
  assert.equal(preview.allowed, false); assert.match(preview.blockedReason, /Checked-in/);
  await assert.rejects(() => db.exec("update reservations set status='cancelled'"), rejectCode("40001"));
  await assert.rejects(() => db.exec("update reservations set start_datetime=start_datetime+interval '1 day'"), rejectCode("40001"));
  await assert.rejects(() => db.query("insert into reservation_reschedules values($1,'pending')", [reservation]), rejectCode("40001"));
  await db.exec("update transactions set total_amount=1200"); // Billing may continue during the stay.
});

test("pending rescheduling blocks arrival and unprivileged staff or browser writes cannot forge completion", async () => {
  await db.query("insert into reservation_reschedules values($1,'pending')", [reservation]); await assert.rejects(arrive, rejectCode("40001"));
  await db.exec("delete from reservation_reschedules;update staff_users set role='staff'"); await assert.rejects(arrive, rejectCode("42501"));
  await db.exec("insert into role_permissions values('staff',array['edit_reservation'])"); await arrive(); await pay(1000);
  await db.exec("set role authenticated");
  try {
    await assert.rejects(depart, rejectCode("42501"));
    await assert.rejects(() => db.exec("update reservations set checked_out_at=now()"), rejectCode("42501"));
    await assert.rejects(() => db.exec("update reservations set status='completed'"), rejectCode("40001"));
  } finally { await db.exec("reset role"); }
});

test("an audit failure rolls back checkout and preserves the active stay", async () => {
  await arrive(); await pay(1000);
  await db.exec("create or replace function fail_stay_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable';end$$;create trigger fail_stay_audit before insert on audit_logs for each row execute function fail_stay_audit()");
  await assert.rejects(depart, /audit unavailable/);
  const row = await one("select status,checked_out_at from reservations"); assert.equal(row.status, "confirmed"); assert.equal(row.checked_out_at, null);
});

test("only guests with completed stays can review, and durable rate limits still apply after checkout", async () => {
  const submit = () => one("insert into reviews(guest_id,title,review_text) values($1,'Our stay','Our family enjoyed the pool and the helpful staff during our wonderful resort stay.') returning *", [guest]);
  await assert.rejects(submit, rejectCode("42501")); await arrive(); await assert.rejects(submit, rejectCode("42501"));
  await pay(1000); await depart(); await submit(); await assert.rejects(submit, rejectCode("P0409"));
  await assert.rejects(() => db.query("insert into reviews(guest_id,title,review_text) values($1,'Another visit','A different account of another wonderful family visit to this lovely resort and pool.')", [guest]), rejectCode("P0429"));
  await assert.rejects(() => db.query("insert into reviews(guest_id,reservation_id,title,review_text) values($1,gen_random_uuid(),'Not mine','Our family enjoyed the pool and helpful staff during a wonderful resort stay.')", [guest]), rejectCode("42501"));
});

test("ocular decisions require permission and a reason, retain their audit trail and reject duplicate conflicting decisions", async () => {
  const review = (action = "reject", reason = "Requested date is unavailable") => one("select review_ocular_visit($1,$2,$3,$4) result", [visit, action, reason, staff]);
  await assert.rejects(() => review("reject", ""), rejectCode("22023"));
  await db.exec("update staff_users set role='staff'"); await assert.rejects(review, rejectCode("42501"));
  await db.exec("insert into role_permissions values('staff',array['ocular_approval'])");
  const first = (await review()).result; assert.equal(first.status, "rejected"); assert.equal(first.reviewed_by, staff); assert.ok(first.reviewed_at);
  assert.equal((await review()).result.alreadyReviewed, true); await assert.rejects(() => review("approve"), rejectCode("40001"));
  assert.equal((await one("select count(*)::int n from audit_logs where entity_type='ocular_visit'")).n, 1);
});

test("future ocular visits may be approved but browser updates and past approvals cannot bypass staff review", async () => {
  await db.exec("set role authenticated");
  try { await assert.rejects(() => db.exec("update ocular_visits set status='confirmed'"), rejectCode("42501")); }
  finally { await db.exec("reset role"); }
  await db.exec("update ocular_visits set scheduled_date=current_date-1");
  await assert.rejects(() => one("select review_ocular_visit($1,'approve','The request was accepted',$2)", [visit, staff]), rejectCode("40001"));
  await db.exec("update ocular_visits set scheduled_date=current_date+2");
  assert.equal((await one("select review_ocular_visit($1,'approve','The requested slot is available',$2) result", [visit, staff])).result.status, "confirmed");
});
