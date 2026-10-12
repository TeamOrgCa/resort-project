import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Execute the actual migration functions in isolated PostgreSQL. No environment
// variables, production credentials, network connection, or Supabase writes.
let db;
const guest = "11111111-1111-4111-8111-111111111111";
const other = "33333333-3333-4333-8333-333333333333";
const admin = "44444444-4444-4444-8444-444444444444";
const cashier = "55555555-5555-4555-8555-555555555555";
const reservation = "22222222-2222-4222-8222-222222222222";
const method = "66666666-6666-4666-8666-666666666666";
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const actor = id => db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
const failure = code => error => error.code === code;
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.guests(id uuid primary key);
    create table public.staff_users(id uuid primary key, role text, is_active boolean);
    create table public.role_permissions(role text primary key, permissions text[]);
    create table public.booking_policy_versions(version bigint primary key, cancellation_text text, refund_text text,
      refund_review_enabled boolean, guest_cancellation_notice_hours integer);
    create table public.reservations(reservation_id uuid primary key, guest_id uuid references public.guests,
      reference_number text, status text, start_datetime timestamptz, end_datetime timestamptz,
      booking_policy_version bigint references public.booking_policy_versions, payment_deadline_at timestamptz,
      cancelled_at timestamptz, cancellation_reason text, created_at timestamptz default now());
    create table public.transactions(reservation_id uuid primary key references public.reservations,
      total_amount numeric(10,2), paid_amount numeric(10,2) default 0, status text default 'unpaid',
      balance numeric(10,2) generated always as (greatest(total_amount - paid_amount, 0)) stored,
      overpaid_amount numeric(10,2) generated always as (greatest(paid_amount - total_amount, 0)) stored);
    create table public.payment_methods(payment_method_id uuid primary key, name text, type text, is_active boolean);
    create table public.payments(payment_id uuid primary key default gen_random_uuid(), reservation_id uuid references public.reservations,
      amount numeric(10,2), status text, payment_type text, reference_number text unique,
      payment_method_id uuid references public.payment_methods, ocr_status text, ocr_checked_at timestamptz);
    create function public.update_transaction_paid_amount() returns trigger language plpgsql as $$ begin return null; end $$;
    create trigger trigger_update_transaction after insert or update or delete on public.payments
      for each row execute function public.update_transaction_paid_amount();
    create table public.refund_requests(refund_id uuid primary key default gen_random_uuid(), reservation_id uuid not null unique references public.reservations,
      guest_id uuid references public.guests, amount numeric(10,2) not null check(amount > 0), policy_snapshot text not null,
      policy_version bigint references public.booking_policy_versions, status text default 'pending', requested_at timestamptz default now(),
      reviewed_by uuid references public.staff_users, reviewed_at timestamptz, review_reason text,
      refunded_by uuid references public.staff_users, refunded_at timestamptz, gcash_reference text, proof_path text);
    create table public.audit_logs(user_id uuid references public.staff_users, auth_user_id uuid, action text, entity_type text, entity_id uuid, details jsonb);
    create table public.invoices(reservation_id uuid references public.reservations, status text);
    create table public.reservation_reschedules(reservation_id uuid references public.reservations, status text);
    insert into public.guests values ('${guest}'), ('${other}');
    insert into public.staff_users values ('${admin}', 'admin', true), ('${cashier}', 'cashier', true);
    insert into public.role_permissions values ('cashier', array['payment_approval']);
    insert into public.booking_policy_versions values (1, 'Cancellation policy', 'Refund policy', true, 48);
    insert into public.payment_methods values ('${method}', 'GCash', 'ewallet', true);
  `);
  await db.exec(readFileSync("docs/gcash-payment-validation-migration.sql", "utf8"));
  await db.exec(readFileSync("docs/overpayment-refunds-migration.sql", "utf8"));
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("truncate public.reservations, public.audit_logs cascade; update public.booking_policy_versions set refund_review_enabled = true;");
  await actor(guest);
  await db.query(`insert into public.reservations(reservation_id, guest_id, reference_number, status, start_datetime, end_datetime,
    booking_policy_version, payment_deadline_at) values ($1, $2, 'MV-TEST', 'confirmed', now() + interval '10 days', now() + interval '11 days', 1, now() + interval '30 minutes')`, [reservation, guest]);
  await db.query("insert into public.transactions(reservation_id, total_amount) values ($1, 3000)", [reservation]);
});
const pay = async (amount, status = "verified", reference = crypto.randomUUID()) => (await scalar(`insert into public.payments
  (reservation_id, amount, status, payment_type, payment_method_id, reference_number)
  values ($1, $2, $3, 'full', $4, $5) returning payment_id`, [reservation, amount, status, method, reference])).payment_id;
const request = async () => (await scalar("select public.request_overpayment_refund($1) as id", [reservation])).id;
const transition = async (id, action, reason = null, reference = "9876543210987") => db.query("select public.transition_refund($1,$2,$3,$4,$5)", [id, action, reason, reference, `proof/${id}.png`]);
const totals = () => scalar("select total_amount, paid_amount, balance, overpaid_amount from public.transactions where reservation_id=$1", [reservation]);

test("migrations can be reapplied without erasing history", async () => {
  await db.exec(readFileSync("docs/gcash-payment-validation-migration.sql", "utf8"));
  await db.exec(readFileSync("docs/overpayment-refunds-migration.sql", "utf8"));
  assert.equal((await totals()).total_amount, "3000.00");
});
test("refund amount is exactly the verified excess; pending payments do not qualify", async () => {
  await pay(1500); await assert.rejects(request(), failure("22023"));
  await pay(2000, "pending"); await assert.rejects(request(), failure("40001"));
  await db.query("update public.payments set status='verified' where status='pending'");
  const id = await request(); const row = await scalar("select * from public.refund_requests where refund_id=$1", [id]);
  assert.equal(row.amount, "500.00"); assert.equal(row.request_kind, "overpayment"); assert.equal(row.status, "pending");
  assert.equal((await totals()).paid_amount, "3500.00");
  await assert.rejects(request(), failure("40001"));
});
test("ownership and configurable staff permissions are checked by the database", async () => {
  await pay(3500); await actor(other); await assert.rejects(request(), failure("42501"));
  await actor(null); await assert.rejects(request(), failure("42501"));
  await actor(guest); const id = await request();
  await assert.rejects(transition(id, "approved"), failure("42501"));
  await actor(cashier); await assert.rejects(transition(id, "approved"), failure("42501"));
  await actor(admin); await transition(id, "approved");
  await actor(cashier); await assert.rejects(transition(id, "refunded"), failure("42501"));
});
test("approved payout reduces net paid and prevents duplicate requests or payouts", async () => {
  const paymentId = await pay(3500); const id = await request(); await actor(admin);
  await assert.rejects(transition(id, "refunded"), failure("22023"));
  await transition(id, "approved"); await transition(id, "refunded");
  const bill = await totals(); assert.equal(bill.paid_amount, "3000.00"); assert.equal(bill.overpaid_amount, "0.00"); assert.equal(bill.balance, "0.00");
  assert.equal((await scalar("select amount from public.payments where payment_id=$1", [paymentId])).amount, "3500.00");
  await assert.rejects(transition(id, "refunded"), failure("22023"));
  await actor(guest); await assert.rejects(request(), failure("22023"));
  await db.query("update public.transactions set total_amount=3200 where reservation_id=$1", [reservation]);
  assert.equal((await totals()).balance, "200.00", "refunded money cannot pay for added services");
});
test("refund history permits a fresh request after rejection or a later excess payment", async () => {
  await pay(3500); const rejected = await request(); await actor(admin);
  await transition(rejected, "rejected", "Please correct payment details");
  await actor(guest); const first = await request(); assert.notEqual(first, rejected);
  await actor(admin); await transition(first, "approved"); await transition(first, "refunded");
  await pay(200); await actor(guest); const second = await request();
  assert.equal((await scalar("select amount from public.refund_requests where refund_id=$1", [second])).amount, "200.00");
  assert.equal((await scalar("select count(*)::int as count from public.refund_requests")).count, 3);
});
test("a changed bill prevents approval or payout; approved requests can be rejected and reviewed again", async () => {
  await pay(3500); const id = await request(); await actor(admin); await transition(id, "approved");
  await db.query("update public.transactions set total_amount=3400 where reservation_id=$1", [reservation]);
  await assert.rejects(transition(id, "refunded"), failure("40001"));
  await transition(id, "rejected", "Bill changed before payout");
  await actor(guest); const fresh = await request();
  assert.equal((await scalar("select amount from public.refund_requests where refund_id=$1", [fresh])).amount, "100.00");
});
test("cancellation expands an open excess refund and resets approval instead of duplicating funds", async () => {
  await pay(3500); const id = await request(); await actor(admin); await transition(id, "approved"); await actor(guest);
  const cancelled = await scalar("select public.cancel_reservation_with_refund($1,'Guest cancellation',false) as id", [reservation]);
  assert.equal(cancelled.id, id);
  const refund = await scalar("select * from public.refund_requests where refund_id=$1", [id]);
  assert.equal(refund.amount, "3500.00"); assert.equal(refund.status, "pending"); assert.equal(refund.request_kind, "cancellation"); assert.equal(refund.reviewed_at, null);
  assert.equal((await scalar("select count(*)::int as count from public.refund_requests")).count, 1);
});
test("cancellation after a completed excess refund requests only the remaining net payments", async () => {
  await pay(3500); const excess = await request(); await actor(admin); await transition(excess, "approved"); await transition(excess, "refunded"); await actor(guest);
  const cancelled = await scalar("select public.cancel_reservation_with_refund($1,'Guest cancellation',false) as id", [reservation]);
  assert.notEqual(cancelled.id, excess);
  assert.equal((await scalar("select amount from public.refund_requests where refund_id=$1", [cancelled.id])).amount, "3000.00");
  await actor(admin); await transition(cancelled.id, "approved"); await transition(cancelled.id, "refunded", null, "9876543210988");
  assert.equal((await totals()).paid_amount, "0.00");
});
test("disabling cancellation refunds does not suppress a verified excess refund", async () => {
  await pay(3500); const id = await request(); await db.exec("update public.booking_policy_versions set refund_review_enabled=false");
  await db.query("select public.cancel_reservation_with_refund($1,'Guest cancellation',false)", [reservation]);
  assert.equal((await scalar("select request_kind, amount from public.refund_requests where refund_id=$1", [id])).amount, "500.00");
  await actor(admin); await transition(id, "approved"); await transition(id, "refunded");
});
test("guest overview exposes only owned history and removes eligibility while review is open", async () => {
  await pay(3500);
  let overview = (await scalar("select public.get_guest_refund_overview() as result")).result;
  assert.equal(overview.eligible[0].amount, 500);
  await request(); overview = (await scalar("select public.get_guest_refund_overview() as result")).result;
  assert.equal(overview.eligible.length, 0); assert.equal(overview.refunds.length, 1);
  await actor(other); overview = (await scalar("select public.get_guest_refund_overview() as result")).result;
  assert.deepEqual(overview, { refunds: [], eligible: [] });
});
test("verified funds cannot be removed underneath a pending refund", async () => {
  const id = await pay(3500); await request();
  await assert.rejects(db.query("delete from public.payments where payment_id=$1", [id]), failure("40001"));
  await assert.rejects(db.query("update public.payments set status='rejected' where payment_id=$1", [id]), failure("40001"));
});
test("GCash insert guard rejects underpayment, invalid dates and mismatched status and accepts actual overpayment", async () => {
  const insert = (amount, type, date = "clock_timestamp()", ocr = "consistent") => db.query(`insert into public.payments
    (reservation_id, amount, status, payment_type, payment_method_id, reference_number, receipt_paid_at, ocr_status, ocr_checked_at)
    values ($1, $2, 'pending', $3, $4, '1234567890123', ${date}, $5, clock_timestamp())`, [reservation, amount, type, method, ocr]);
  await assert.rejects(insert(599.99, "downpayment"), failure("40001"));
  await assert.rejects(insert(2999.99, "full"), failure("40001"));
  await assert.rejects(insert(3500, "full", "clock_timestamp() - interval '1 day'"), failure("22023"));
  await assert.rejects(insert(3500, "full", "clock_timestamp() + interval '2 minutes'"), failure("22023"));
  await assert.rejects(insert(3500, "full", "clock_timestamp()", "mismatch"), failure("22023"));
  await insert(3500, "full");
  assert.equal((await scalar("select amount from public.payments")).amount, "3500.00");
  await assert.rejects(insert(3500, "full"), failure("40001"));
});
test("normalized references prevent receipt reuse with different spacing or hyphens", async () => {
  await pay(3500, "verified", "1234-5678 90123");
  await assert.rejects(pay(500, "verified", "1234567890123"), failure("23505"));
});

test("pending receipts must remain reviewable before cancellation and a null actor flag cannot bypass notice", async () => {
  await pay(3500); await pay(100, "pending");
  await assert.rejects(db.query("select public.cancel_reservation_with_refund($1,'Cancellation',false)", [reservation]), failure("40001"));
  assert.equal((await scalar("select status from public.reservations")).status, "confirmed");
  await assert.rejects(db.query("select public.cancel_reservation_with_refund($1,'Cancellation',null)", [reservation]), failure("22023"));
});

test("an obsolete pending reschedule cannot block a cancellation refund payout", async () => {
  await pay(3500);
  await db.query("insert into public.reservation_reschedules values ($1,'pending')", [reservation]);
  const result = await scalar("select public.cancel_reservation_with_refund($1,'Cancellation',false) as id", [reservation]);
  await actor(admin); await transition(result.id, "approved"); await transition(result.id, "refunded");
  assert.equal((await totals()).paid_amount, "0.00");
});
