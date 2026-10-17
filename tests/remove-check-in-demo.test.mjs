import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const cleanup = readFileSync("docs/remove-check-in-demo.sql", "utf8");
const schema = readFileSync("updated-schema.sql", "utf8");
const guests = ["de000000-0000-4000-8000-000000000001", "de000000-0000-4000-8000-000000000011", "de000000-0000-4000-8000-000000000012"];
const unit = "de000000-0000-4000-8000-000000000002", service = "de000000-0000-4000-8000-000000000003", method = "de000000-0000-4000-8000-000000000004";
let db, bookings;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
function table(name) {
  const match = schema.match(new RegExp(`create table (?:public\\.)?${name} \\([\\s\\S]*?\\n\\);`));
  assert.ok(match, name); return match[0];
}
function fn(path, name) {
  const sql = readFileSync(path, "utf8"), start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  const bodyStart = sql.indexOf("$$", start), bodyEnd = sql.indexOf("$$", bodyStart + 2);
  return sql.slice(start, sql.indexOf(";", bodyEnd) + 1);
}
async function runCleanup() {
  try { return await db.exec(cleanup); }
  catch (error) { await db.exec("rollback"); throw error; }
}
const count = async table => (await one(`select count(*)::int n from ${table}`)).n;

before(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create table staff_users(id uuid primary key); create table guests(id uuid primary key);
    create table package_rate_versions(version bigint primary key,rates jsonb,times jsonb);
    insert into package_rate_versions values(1,'{"keep":"prices"}','{"keep":"times"}');`);
  for (const name of ["audit_logs", "walk_in_guests", "reservations", "units", "services", "unit_rates", "payment_methods", "payment_accounts",
    "reservation_units", "reservation_services", "transactions", "payments", "receipts", "invoices", "reservation_reschedules", "reservation_status_logs", "notifications"]) await db.exec(table(name));
  await db.exec(`alter table audit_logs add column details jsonb;
    alter table reservations add column checked_in_at timestamptz,add column checked_out_at timestamptz;
    create table refund_requests(reservation_id uuid references reservations(reservation_id),amount numeric,status text);
    create table reviews(review_id uuid primary key default gen_random_uuid(),reservation_id uuid references reservations(reservation_id));
    create table reservation_reschedule_adjustments(reservation_id uuid references reservations(reservation_id));`);
  for (const [path, name] of [
    ["docs/cancellation-refund-workflow-migration.sql", "lock_payment_refund_funds"],
    ["docs/overpayment-refunds-migration.sql", "refresh_reservation_payment_totals"],
    ["docs/overpayment-refunds-migration.sql", "update_transaction_paid_amount"],
    ["updated-schema.sql", "update_transaction_total"],
    ["docs/additional-services-billing-migration.sql", "update_invoice_total"],
    ["docs/first-come-booking-migration.sql", "audit_booking_slot_change"],
  ]) await db.exec(fn(path, name));
  await db.exec(`create trigger payment_lock before insert or update or delete on payments for each row execute function lock_payment_refund_funds();
    create trigger paid_totals after insert or update or delete on payments for each row execute function update_transaction_paid_amount();
    create trigger units_bill after insert or update or delete on reservation_units for each row execute function update_transaction_total();
    create trigger services_bill after insert or update or delete on reservation_services for each row execute function update_transaction_total();
    create trigger invoice_total after insert or update or delete on reservation_services for each row execute function update_invoice_total();
    create trigger slot_audit after insert or update of status or delete on reservations for each row execute function audit_booking_slot_change();`);
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec("truncate reservations,walk_in_guests,units,services,payment_methods,audit_logs,notifications cascade");
  for (let i = 0; i < 3; i++) await db.query(`insert into walk_in_guests(walk_in_guest_id,first_name,last_name,email,phone_number,address)
    values($1,'Demo',$2,'resort-tester@example.invalid','00000000000','TEST DATA - Marville Resort demonstration')`, [guests[i], ["Tester", "Tester Two", "Tester Three"][i]]);
  await db.query("insert into units(unit_id,name,capacity,base_price) values($1,'[DEMO] Cottage and rooms',30,0)", [unit]);
  await db.query("insert into services(service_id,name,price) values($1,'[DEMO] Extra mattress rental',300)", [service]);
  await db.query("insert into payment_methods(payment_method_id,name,type,is_active) values($1,'[DEMO] Test payment - no money received','demo',false)", [method]);
  bookings = [];
  for (let i = 0; i < 3; i++) {
    const ref = ["MV-DEMO-CHECKIN-20261015", "MV-DEMO-CHECKIN-20261017-02", "MV-DEMO-CHECKIN-20261017-03"][i];
    const r = await one(`insert into reservations(walk_in_guest_id,reference_number,start_datetime,end_datetime,status,booking_type)
      values($1,$2,'2026-10-17T08:00:00+08:00','2026-10-17T16:00:00+08:00','confirmed','walk_in') returning reservation_id`, [guests[i], ref]);
    bookings.push(r.reservation_id);
    await db.query("insert into transactions(reservation_id,total_amount) values($1,1000)", [r.reservation_id]);
    await db.query("insert into reservation_units(reservation_id,unit_id,quantity,price_per_night) values($1,$2,1,1000)", [r.reservation_id, unit]);
    await db.query("insert into reservation_services(reservation_id,service_id,quantity,price_at_time) values($1,$2,1,300)", [r.reservation_id, service]);
    const payment = await one(`insert into payments(reservation_id,amount,payment_method_id,payment_type,status,reference_number,account_name,proof_path,ocr_status)
      values($1,1300,$2,'full','verified',$3,'DEMO ONLY - no actual payment','','not_applicable') returning payment_id`, [r.reservation_id, method, ref + "-PAY"]);
    await db.query("insert into receipts(payment_id,receipt_number,amount_paid) values($1,$2,1300)", [payment.payment_id, ref + "-RCPT"]);
    await db.query("insert into invoices(reservation_id,total_amount,status) values($1,1300,'paid')", [r.reservation_id]);
    await db.query(`insert into audit_logs(action,entity_type,entity_id,details) values('Seeded synthetic check-in demo','reservation',$1,'{"test_data":true,"actual_money_received":false}')`, [r.reservation_id]);
    await db.query("insert into notifications(recipient_role,recipient_id,title,entity_type,entity_id) values('admin',gen_random_uuid(),'Demo notification','reservation',$1)", [r.reservation_id]);
  }
  await db.query("update reservations set status='cancelled' where reservation_id=$1", [bookings[0]]);
  await db.query("update reservations set checked_in_at=now() where reservation_id=$1", [bookings[1]]);
  await db.query("update reservations set status='completed',checked_in_at=now(),checked_out_at=now() where reservation_id=$1", [bookings[2]]);
  await db.query("insert into reservation_reschedule_adjustments values($1)", [bookings[2]]);
});

test("removes all three demos across dates and lifecycle states through real cascading FKs, retains audit and package settings", async () => {
  const rates = await one("select * from package_rate_versions");
  await runCleanup();
  for (const name of ["reservations", "payments", "receipts", "transactions", "invoices", "reservation_units", "reservation_services",
    "reservation_status_logs", "reservation_reschedule_adjustments", "notifications", "walk_in_guests", "units", "services", "payment_methods"]) assert.equal(await count(name), 0, name);
  assert.deepEqual(await one("select * from package_rate_versions"), rates);
  assert.equal((await one("select count(*)::int n from audit_logs where action='Seeded synthetic check-in demo'")).n, 3);
  assert.equal((await one("select count(*)::int n from audit_logs where action='Removed synthetic check-in demo'")).n, 1);
  await runCleanup();
  assert.equal((await one("select count(*)::int n from audit_logs where action='Removed synthetic check-in demo'")).n, 1);
});

test("preserves a non-demo booking using shared demo catalog entries and the same walk-in profile", async () => {
  const real = await one(`insert into reservations(walk_in_guest_id,reference_number,start_datetime,end_datetime,status,booking_type)
    values($1,'REAL-BOOKING','2026-10-18T08:00:00+08:00','2026-10-18T16:00:00+08:00','confirmed','walk_in') returning reservation_id`, [guests[0]]);
  await db.query("insert into reservation_units(reservation_id,unit_id,price_per_night) values($1,$2,1000)", [real.reservation_id, unit]);
  await db.query("insert into reservation_services(reservation_id,service_id,price_at_time) values($1,$2,300)", [real.reservation_id, service]);
  await db.query("insert into payment_accounts(payment_method_id,account_name) values($1,'Retain this linked account')", [method]);
  await runCleanup();
  assert.equal((await one("select reference_number from reservations")).reference_number, "REAL-BOOKING");
  for (const name of ["walk_in_guests", "units", "services", "payment_methods", "payment_accounts"]) assert.equal(await count(name), 1, name);
});

test("reference-like records without the seed audit marker are preserved", async () => {
  await db.query("delete from audit_logs where entity_id=$1", [bookings[2]]);
  await runCleanup();
  assert.equal((await one("select reservation_id from reservations")).reservation_id, bookings[2]);
  assert.equal(await count("payments"), 1);
});

for (const activity of ["payment", "refund", "review"]) test(`${activity} outside the seed aborts the cleanup and preserves all demos`, async () => {
  if (activity === "payment") await db.query(`insert into payments(reservation_id,amount,payment_type,status,reference_number,account_name,proof_path)
    values($1,100,'additional','verified','REAL-PAYMENT','Actual payer','proof.png')`, [bookings[1]]);
  if (activity === "refund") await db.query("insert into refund_requests values($1,100,'pending')", [bookings[1]]);
  if (activity === "review") await db.query("insert into reviews(reservation_id) values($1)", [bookings[1]]);
  await assert.rejects(runCleanup, /Nothing was deleted/);
  assert.equal(await count("reservations"), 3);
  assert.equal(await count("walk_in_guests"), 3);
});
