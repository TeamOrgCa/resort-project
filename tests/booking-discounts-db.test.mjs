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
      package_rate_version integer,start_datetime timestamptz,end_datetime timestamptz,booking_mode text,adult_count integer,child_count integer);
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
});
after(async () => db?.close());
async function booking(n, head = 20, paid = 0) {
  await db.query("insert into reservations values($1,$2,'confirmed',null,1,'2027-01-04T00:00Z','2027-01-04T08:00Z','day',$3,0)", [id(n), id(7), head]);
  await db.query("insert into transactions(reservation_id,total_amount,paid_amount,status) values($1,11000,$2,'unpaid')", [id(n), paid]);
  await db.query("insert into invoices(reservation_id,total_amount,status) values($1,11000,'issued')", [id(n)]);
}
async function discount(n, eligible, code = null, expected = 11000, actor = 3) {
  return (await row("select set_booking_discount($1,$2,$3,$4,$5,'Verified eligibility documents',false) result", [id(n), id(actor), eligible, code, expected])).result;
}

test("20% is proportional to eligible guests and never stacks with a promo", async () => {
  await booking(10);
  await db.exec("insert into promo_codes(code,discount_type,discount_value) values('SAVE10','percent',10),('SMALL','fixed',250)");
  const pwd = await discount(10, 5);
  assert.equal(pwd.discountAmount, 500); assert.equal(pwd.totalAmount, 10500);
  const promo = await discount(10, 5, 'SAVE10', 10500);
  assert.equal(promo.discountAmount, 1000); assert.equal(promo.totalAmount, 10000); assert.equal(promo.discountKind, 'promo');
  const betterPwd = await discount(10, 15, 'SAVE10', 10000);
  assert.equal(betterPwd.totalAmount, 9500); assert.equal(betterPwd.discountKind, 'pwd_senior');
  const unchanged = await discount(10, 15, 'SMALL', 9500);
  assert.equal(unchanged.totalAmount, 9500); // no accumulation on repeated saves
  const removed = await discount(10, 0, null, 9500);
  assert.equal(removed.totalAmount, 11000); assert.equal(removed.discountAmount, 0);
});

test("cashiers can adjust paid bills without altering payments; overpayments are visible", async () => {
  await booking(11, 20, 11000);
  const result = await discount(11, 20, null, 11000, 2);
  assert.equal(result.totalAmount, 9000); assert.equal(result.paidAmount, 11000); assert.equal(result.overpaidAmount, 2000);
  assert.deepEqual(await row("select total_amount,status from invoices where reservation_id=$1", [id(11)]), { total_amount: '9000.00', status: 'paid' });
  await assert.rejects(discount(11, 21, null, 9000), e => e.code === '22023');
  await assert.rejects(discount(11, 1, null, 11000), e => e.code === '40001');
  await assert.rejects(discount(11, 1, null, 9000, 4), e => e.code === '42501');
});

test("head-count and date repricing use booked package rates and preserve promo snapshots", async () => {
  await booking(12);
  await discount(12, 5, 'SAVE10');
  await db.exec("update promo_codes set is_active=false where code='SAVE10'");
  assert.equal((await discount(12, 5, 'SAVE10', 10000)).discountAmount, 1000);
  await db.query("update reservations set adult_count=10 where reservation_id=$1", [id(12)]);
  const same = await row("select reprice_booking_discount($1) result", [id(12)]);
  assert.equal(same.result.discountAmount, 1000);
  await db.query("update reservations set start_datetime='2027-01-08T00:00Z',end_datetime='2027-01-08T08:00Z' where reservation_id=$1", [id(12)]);
  assert.equal((await row("select reprice_booking_discount($1) result", [id(12)])).result.discountAmount, 1500);
  await booking(13);
  await assert.rejects(discount(13, 0, 'SAVE10'), e => e.code === '22023');
  await db.exec(migration); // repeatable without rewriting existing discounts
  assert.equal((await row("select discount_amount from transactions where reservation_id=$1", [id(12)])).discount_amount, '1500.00');
});

test("pending payment and refund reviews lock discount changes", async () => {
  await booking(14);
  await db.query("insert into payments(reservation_id,status) values($1,'pending')", [id(14)]);
  await assert.rejects(discount(14, 1), e => e.code === '40001');
  await db.query("delete from payments where reservation_id=$1", [id(14)]);
  await db.query("insert into refund_requests values($1,$2,$3,'approved',null,null,null,null,null,null)", [id(20), id(14), id(7)]);
  await assert.rejects(discount(14, 1), e => e.code === '40001');
});

test("a promo covering the entire bill confirms an unpaid booking without a payment receipt", async () => {
  await booking(17);
  await db.query("update reservations set status='pending' where reservation_id=$1", [id(17)]);
  await db.query("update transactions set total_amount=10000 where reservation_id=$1", [id(17)]);
  await db.exec("insert into promo_codes(code,discount_type,discount_value) values('FULL100','percent',100)");
  const result = await row("select set_booking_discount($1,$2,0,'FULL100',10000,'Selected promo at creation',true) result", [id(17), id(7)]);
  assert.equal(result.result.totalAmount, 0);
  assert.equal((await row("select status from reservations where reservation_id=$1", [id(17)])).status, 'confirmed');
  assert.equal((await row("select status from invoices where reservation_id=$1", [id(17)])).status, 'paid');
});

test("refund notification requires missing verified details; only the owner can reply", async () => {
  await booking(15);
  await db.query("insert into refund_requests(refund_id,reservation_id,guest_id,status) values($1,$2,$3,'approved')", [id(21), id(15), id(7)]);
  await db.query("select request_refund_destination($1,$2)", [id(21), id(2)]);
  assert.equal((await row("select action_url from notifications where entity_id=$1", [id(21)])).action_url, '/manage?tab=refunds');
  await assert.rejects(db.query("select request_refund_destination($1,$2)", [id(21), id(2)]), e => e.code === '40001');
  await assert.rejects(db.query("update refund_requests set status='payout_submitted',payout_method='GCash' where refund_id=$1", [id(21)]), e => e.code === '40001');
  await db.exec(`set test.uid='${id(6)}'`);
  await assert.rejects(db.query("select submit_refund_destination($1,'GCash','Guest Name','09171234567')", [id(21)]), e => e.code === '42501');
  await db.exec(`set test.uid='${id(7)}'`);
  await assert.rejects(db.query("select submit_refund_destination($1,'Cash','Guest Name','123')", [id(21)]), e => e.code === '22023');
  await assert.rejects(db.query("select submit_refund_destination($1,'GCash','Guest Name','123')", [id(21)]), e => e.code === '22023');
  await db.query("select submit_refund_destination($1,'GCash','Guest Name','09171234567')", [id(21)]);
  assert.equal((await row("select destination_account_number from refund_requests where refund_id=$1", [id(21)])).destination_account_number, '09171234567');
  await assert.rejects(db.query("update refund_requests set status='payout_submitted',payout_method='Bank' where refund_id=$1", [id(21)]), e => e.code === '22023');
  await db.query("update refund_requests set status='payout_submitted',payout_method='GCash' where refund_id=$1", [id(21)]);
  await assert.rejects(db.query("select submit_refund_destination($1,'GCash','Guest Name','09171234567')", [id(21)]), e => e.code === '40001');
});

test("authenticated callers cannot forge discount metadata or refund destination replies", async () => {
  await db.exec('set role authenticated');
  try {
    await assert.rejects(db.query("update transactions set discount_eligible_guests=1 where reservation_id=$1", [id(10)]), e => e.code === '42501');
    await assert.rejects(db.query("update refund_requests set destination_account_number='09170000000' where refund_id=$1", [id(21)]), e => e.code === '42501');
    await assert.rejects(db.query("select set_booking_discount($1,$2,1,null,11000,'Forged actor',false)", [id(10), id(1)]), e => e.code === '42501');
  } finally { await db.exec('reset role'); }
});

test("reservation edits recalculate discounts atomically and reject stale eligibility snapshots", async () => {
  await db.exec(`create function edit_staff_reservation(uuid,uuid,jsonb,jsonb) returns jsonb language plpgsql as $$
    begin
      update public.reservations set adult_count=($4->>'adultCount')::integer where reservation_id=$1;
      update public.transactions set total_amount=($4->>'expectedTotal')::numeric where reservation_id=$1;
      return jsonb_build_object('totalAmount',($4->>'expectedTotal')::numeric);
    end $$;`);
  await booking(16);
  await discount(16, 5);
  const expected = { discount: { amount: 500, eligible: 5, code: null, type: null, value: 0 } };
  const result = await row("select edit_staff_reservation_with_discount($1,$2,$3,$4) result", [id(16), id(3), expected, { adultCount: 10, expectedTotal: 10500 }]);
  assert.equal(result.result.totalAmount, 10000); assert.equal(result.result.discountAmount, 1000);
  await assert.rejects(db.query("select edit_staff_reservation_with_discount($1,$2,$3,$4)", [id(16), id(3), expected, { adultCount: 8, expectedTotal: 10000 }]), e => e.code === '40001');
  await assert.rejects(db.query("select edit_staff_reservation_with_discount($1,$2,$3,$4)", [id(16), id(3), {}, { adultCount: 4, expectedTotal: 10000 }]), e => e.code === '22023');
  assert.equal((await row("select adult_count from reservations where reservation_id=$1", [id(16)])).adult_count, 10);
  assert.equal((await row("select total_amount from transactions where reservation_id=$1", [id(16)])).total_amount, '10000.00');
});
