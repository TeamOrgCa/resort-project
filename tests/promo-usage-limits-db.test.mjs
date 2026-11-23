import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync("docs/guest-discounts-promos-refund-details-migration.sql", "utf8");
let db;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0];
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create table services(service_id uuid primary key,billing_type text default 'quantity');
    create table reservation_services(reservation_id uuid,service_id uuid,billing_type text default 'quantity');
    create table reservations(reservation_id uuid primary key,guest_id uuid,status text,checked_out_at timestamptz,
      package_rate_version integer,start_datetime timestamptz,end_datetime timestamptz,booking_mode text,adult_count integer,child_count integer,payment_deadline_at timestamptz);
    create table transactions(reservation_id uuid primary key,total_amount numeric,paid_amount numeric,status text);
    create table package_rate_versions(version integer primary key,rates jsonb);
    create table invoices(invoice_id uuid primary key default gen_random_uuid(),reservation_id uuid,total_amount numeric,status text,created_at timestamptz default now());
    create table staff_users(id uuid primary key,role text,is_active boolean);
    create table role_permissions(role text primary key,permissions text[]);
    create table payments(reservation_id uuid,status text,account_name text,account_number text,payment_method_id uuid);
    create table refund_requests(refund_id uuid primary key,reservation_id uuid,guest_id uuid,status text,payout_method text);
    create table payment_methods(payment_method_id uuid primary key,name text,type text,is_active boolean);
    create table notifications(recipient_role text,recipient_id uuid,actor_id uuid,title text,message text,action_url text,entity_type text,entity_id uuid);
    create table audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
    create function notify_refund_workflow(uuid,text,text,text,uuid) returns void language sql as $$select$$;
    grant usage on schema public,auth to authenticated;
    grant select,insert,update on transactions,refund_requests to authenticated;
    insert into staff_users values('${id(1)}','admin',true),('${id(2)}','cashier',true),('${id(3)}','staff',true),('${id(4)}','staff',false);
    insert into role_permissions values('staff',array['edit_reservation','transactions','refund_approval']),('cashier',array['transactions','payment_entry','refund_payout']);
    insert into package_rate_versions values(1,'{"weekday":{"day":{"baseRate":10000},"night":{"baseRate":12000},"whole_day":{"baseRate":16000}},"weekend":{"day":{"baseRate":15000},"night":{"baseRate":17000},"whole_day":{"baseRate":21000}}}');
    insert into payment_methods values('${id(8)}','GCash','ewallet',true),('${id(9)}','Cash','cash',true);
  `);
  await db.exec(migration);
  await db.exec("insert into promo_codes(code,discount_type,discount_value) values('LEGACYUSE','fixed',1000)");
  await booking(90, 'confirmed'); await apply(90, 'LEGACYUSE');
  await booking(91); await apply(91, 'LEGACYUSE');
  await db.exec(readFileSync("docs/promo-usage-limits-migration.sql", "utf8"));
});
after(async () => db?.close());

async function booking(n, status = 'pending') {
  await db.query("insert into reservations(reservation_id,guest_id,status,package_rate_version,start_datetime,end_datetime,booking_mode,adult_count,child_count,payment_deadline_at) values($1,$2,$3,1,'2027-01-04T00:00Z','2027-01-04T08:00Z','day',20,0,now()+interval '1 hour')", [id(n), id(7), status]);
  await db.query("insert into transactions(reservation_id,total_amount,paid_amount,status) values($1,10000,0,'unpaid')", [id(n)]);
}
async function promo(code, limit = 5, value = 1000) {
  await db.query("insert into promo_codes(code,discount_type,discount_value,max_uses) values($1,'fixed',$2,$3)", [code, value, limit]);
}
async function apply(n, code, eligible = 0, expected = 10000) {
  return (await row("select set_booking_discount($1,$2,$3,$4,$5,'Verified booking promo',false) result", [id(n), id(1), eligible, code, expected])).result;
}
const stats = code => row("select usage_count,pending_uses,remaining_uses from promo_code_availability where code=$1", [code]);
const numbers = s => Object.fromEntries(Object.entries(s).map(([key, value]) => [key, value === null ? null : Number(value)]));

test("migration backfills existing confirmed uses and pending snapshots without changing their bills", async () => {
  assert.deepEqual(numbers(await stats('LEGACYUSE')), { usage_count: 1, pending_uses: 1, remaining_uses: null });
  assert.equal((await row("select total_amount from transactions where reservation_id=$1", [id(90)])).total_amount, '9000.00');
  await db.exec(readFileSync('docs/promo-usage-limits-migration.sql', 'utf8'));
  assert.deepEqual(numbers(await stats('LEGACYUSE')), { usage_count: 1, pending_uses: 1, remaining_uses: null });
});

test("a five-use promo counts confirmed reservations only and protects all five pending quotes", async () => {
  await promo('LIMIT5');
  for (let i = 100; i < 105; i++) { await booking(i); await apply(i, 'LIMIT5'); }
  assert.deepEqual(numbers(await stats('LIMIT5')), { usage_count: 0, pending_uses: 5, remaining_uses: 0 });
  await booking(105);
  await assert.rejects(apply(105, 'LIMIT5'), e => e.code === '40001');
  assert.equal((await row("select discount_promo_code from transactions where reservation_id=$1", [id(105)])).discount_promo_code, null, 'failed save rolls back the bill too');
  await db.query("update reservations set status='confirmed' where reservation_id=$1", [id(100)]);
  await db.query("update reservations set status='confirmed' where reservation_id=$1", [id(100)]);
  await apply(100, 'LIMIT5', 0, 9000);
  assert.deepEqual(numbers(await stats('LIMIT5')), { usage_count: 1, pending_uses: 4, remaining_uses: 0 });
  await db.query("update reservations set status='cancelled' where reservation_id=$1", [id(101)]);
  await db.query("update reservations set payment_deadline_at=now()-interval '1 second' where reservation_id=$1", [id(102)]);
  assert.deepEqual(numbers(await stats('LIMIT5')), { usage_count: 1, pending_uses: 2, remaining_uses: 2 });
  await apply(105, 'LIMIT5');
  await db.query("update reservations set status='confirmed' where reservation_id in ($1,$2,$3)", [id(103), id(104), id(105)]);
  assert.deepEqual(numbers(await stats('LIMIT5')), { usage_count: 4, pending_uses: 0, remaining_uses: 1 });
  await booking(106, 'confirmed'); await apply(106, 'LIMIT5');
  assert.deepEqual(numbers(await stats('LIMIT5')), { usage_count: 5, pending_uses: 0, remaining_uses: 0 });
  await booking(107, 'confirmed'); await assert.rejects(apply(107, 'LIMIT5'), e => e.code === '40001');
});

test("payment review keeps a hold until approved or rejected, without marking it used", async () => {
  await promo('REVIEW1', 1); await booking(110); await apply(110, 'REVIEW1');
  await db.query("update reservations set status='payment_submitted',payment_deadline_at=now()-interval '1 hour' where reservation_id=$1", [id(110)]);
  assert.deepEqual(numbers(await stats('REVIEW1')), { usage_count: 0, pending_uses: 1, remaining_uses: 0 });
  await db.query("update reservations set status='rejected' where reservation_id=$1", [id(110)]);
  assert.deepEqual(numbers(await stats('REVIEW1')), { usage_count: 0, pending_uses: 0, remaining_uses: 1 });
});

test("a winning PWD discount consumes no promo use; changing pending discounts releases their holds", async () => {
  await promo('PWDTEST', 1); await booking(120); await apply(120, 'PWDTEST', 20);
  assert.deepEqual(numbers(await stats('PWDTEST')), { usage_count: 0, pending_uses: 0, remaining_uses: 1 });
  await apply(120, 'PWDTEST', 0, 8000);
  assert.deepEqual(numbers(await stats('PWDTEST')), { usage_count: 0, pending_uses: 1, remaining_uses: 0 });
  await apply(120, null, 0, 9000);
  assert.deepEqual(numbers(await stats('PWDTEST')), { usage_count: 0, pending_uses: 0, remaining_uses: 1 });
});

test("confirmation counts once across edits, cancellation, code renaming and migration reapplication", async () => {
  await promo('HISTORY1', 1); await booking(130); await apply(130, 'HISTORY1');
  await db.query("update reservations set status='confirmed' where reservation_id=$1", [id(130)]);
  await db.exec("update promo_codes set code='RENAMED1' where code='HISTORY1'");
  await apply(130, 'HISTORY1', 0, 9000); // old code remains a booked snapshot
  await db.exec(readFileSync('docs/promo-usage-limits-migration.sql', 'utf8'));
  assert.deepEqual(numbers(await stats('RENAMED1')), { usage_count: 1, pending_uses: 0, remaining_uses: 0 });
  await apply(130, null, 20, 9000);
  assert.deepEqual(numbers(await stats('RENAMED1')), { usage_count: 1, pending_uses: 0, remaining_uses: 0 });
  await db.query("update reservations set status='cancelled' where reservation_id=$1", [id(130)]);
  assert.equal(Number((await stats('RENAMED1')).usage_count), 1);
});

test("admins can change or remove limits, but cannot lower them below occupied slots", async () => {
  await promo('EDITCAP', 5);
  await booking(140, 'confirmed'); await apply(140, 'EDITCAP');
  await booking(141); await apply(141, 'EDITCAP');
  await assert.rejects(db.exec("update promo_codes set max_uses=1 where code='EDITCAP'"), e => e.code === '23514');
  await db.exec("update promo_codes set max_uses=2 where code='EDITCAP'");
  assert.equal(Number((await stats('EDITCAP')).remaining_uses), 0);
  await db.exec("update promo_codes set max_uses=null where code='EDITCAP'");
  assert.equal((await stats('EDITCAP')).remaining_uses, null);
  await assert.rejects(db.exec("update promo_codes set max_uses=0 where code='EDITCAP'"), e => e.code === '23514');
});

test("zero-total successful bookings redeem once and failed creation cleanup returns capacity", async () => {
  await promo('FREEBOOK', 1, 10000); await booking(150);
  await apply(150, 'FREEBOOK');
  assert.equal((await row("select status from reservations where reservation_id=$1", [id(150)])).status, 'confirmed');
  assert.deepEqual(numbers(await stats('FREEBOOK')), { usage_count: 1, pending_uses: 0, remaining_uses: 0 });
  await db.query("delete from reservations where reservation_id=$1", [id(150)]);
  assert.deepEqual(numbers(await stats('FREEBOOK')), { usage_count: 0, pending_uses: 0, remaining_uses: 1 });
});

test("competing saves cannot claim the last slot twice and guests cannot forge redemptions", async () => {
  await promo('LASTONE', 1); await booking(160); await booking(161);
  const attempts = await Promise.allSettled([apply(160, 'LASTONE'), apply(161, 'LASTONE')]);
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(Number((await stats('LASTONE')).pending_uses), 1);
  await db.exec('set role authenticated');
  try {
    await assert.rejects(db.query("select * from promo_code_availability"), e => e.code === '42501');
    await assert.rejects(db.query("delete from promo_redemptions"), e => e.code === '42501');
    await assert.rejects(db.query("select sync_booking_promo_usage($1)", [id(161)]), e => e.code === '42501');
  } finally { await db.exec('reset role'); }
});

test("a changed creation quote rolls back its hold, bill and even zero-total confirmation", async () => {
  await promo('QUOTECHANGE', 1, 10000); await booking(170);
  await assert.rejects(db.query("select apply_new_booking_promo($1,$2,'QUOTECHANGE',10000,true,1000)", [id(170), id(7)]), e => e.code === '40001');
  assert.deepEqual(numbers(await stats('QUOTECHANGE')), { usage_count: 0, pending_uses: 0, remaining_uses: 1 });
  assert.equal((await row("select status from reservations where reservation_id=$1", [id(170)])).status, 'pending');
  assert.equal((await row("select total_amount from transactions where reservation_id=$1", [id(170)])).total_amount, '10000');
  await db.query("select apply_new_booking_promo($1,$2,'QUOTECHANGE',10000,true,0)", [id(170), id(7)]);
  assert.equal(Number((await stats('QUOTECHANGE')).usage_count), 1);
});
