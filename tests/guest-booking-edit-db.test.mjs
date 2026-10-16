import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync("docs/guest-booking-edit-migration.sql", "utf8");
const guest = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const reservation = "33333333-3333-4333-8333-333333333333", service = "44444444-4444-4444-8444-444444444444", extra = "55555555-5555-4555-8555-555555555555";
let db;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('fixture.guest',true),'')::uuid$$;
    create table public.staff_users(id uuid,is_active boolean);
    create table public.guests(id uuid primary key,is_active boolean);
    create table public.reservations(reservation_id uuid primary key,guest_id uuid,reference_number text,status text,booking_mode text,
      start_datetime timestamptz,end_datetime timestamptz,adult_count integer,child_count integer,updated_at timestamptz default now(),payment_deadline_at timestamptz);
    create table public.transactions(reservation_id uuid primary key,total_amount numeric,paid_amount numeric,status text);
    create table public.services(service_id uuid primary key,name text,price numeric,is_active boolean);
    create table public.reservation_services(reservation_id uuid,service_id uuid,quantity integer,price_at_time numeric,unique(reservation_id,service_id));
    create table public.reservation_units(reservation_id uuid,unit_id uuid,quantity integer,price_per_night numeric);
    create table public.payments(reservation_id uuid,status text,amount numeric);
    create table public.refund_requests(reservation_id uuid,status text,amount numeric);
    create table public.reservation_reschedules(reservation_id uuid,status text);
    create table public.invoices(invoice_id uuid default gen_random_uuid(),reservation_id uuid,total_amount numeric,status text,created_at timestamptz default now());
    create table public.receipts(reservation_id uuid,amount_paid numeric,transaction_total_at_time numeric);
    create table public.audit_logs(auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
    create function public.refresh_reservation_payment_totals(p_reservation uuid) returns void language sql as $$
      update public.transactions set paid_amount=greatest(coalesce((select sum(amount) from public.payments where reservation_id=p_reservation and status='verified'),0)
        -coalesce((select sum(amount) from public.refund_requests where reservation_id=p_reservation and status='refunded'),0),0) where reservation_id=p_reservation;
    $$;
    -- Model legacy triggers that recalculate using current prices. The RPC must
    -- restore the captured bill plus its exact delta after every such trigger.
    create function public.legacy_recalculate() returns trigger language plpgsql as $$begin update public.transactions set total_amount=42; return null; end$$;
    create trigger legacy_services after insert or update or delete on public.reservation_services for each row execute function public.legacy_recalculate();
    create trigger legacy_counts after update of adult_count,child_count on public.reservations for each row execute function public.legacy_recalculate();`);
  await db.exec(migration);
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("truncate public.guests,public.staff_users,public.reservations,public.transactions,public.services,public.reservation_services,public.reservation_units,public.payments,public.refund_requests,public.reservation_reschedules,public.invoices,public.receipts,public.audit_logs");
  await db.query("insert into public.guests values($1,true),($2,true)", [guest, other]);
  await db.query("insert into public.reservations values($1,$2,'MV-TEST','confirmed','day',now()+interval '20 days',now()+interval '20 days 8 hours',22,0,now(),null)", [reservation, guest]);
  await db.query("insert into public.services values($1,'Table',999,false),($2,'Karaoke',500,true)", [service, extra]);
  await db.query("insert into public.reservation_services values($1,$2,2,100)", [reservation, service]);
  await db.query("insert into public.transactions values($1,8600,1720,'partial')", [reservation]);
  await db.query("insert into public.payments values($1,'verified',1720)", [reservation]);
  await db.query("insert into public.invoices(reservation_id,total_amount,status,created_at) values($1,8600,'partially_paid',now()),($1,8000,'void',now()-interval '1 day')", [reservation]);
  await db.query("insert into public.receipts values($1,1720,8600)", [reservation]);
});
async function edit({ adults = 22, children = 0, services = [{ serviceId: service, quantity: 2 }], delta = 0, actor = guest, expectedTotal } = {}) {
  const r = await one("select * from public.reservations"), bill = await one("select * from public.transactions");
  const old = (await db.query('select service_id "serviceId",quantity,price_at_time price from public.reservation_services order by service_id')).rows.map(s => ({ ...s, price: Number(s.price) }));
  const expected = { updatedAt: r.updated_at, totalAmount: Number(bill.total_amount), paidAmount: Number(bill.paid_amount), services: old, units: [] };
  const total = Number(bill.total_amount) + delta + services.reduce((sum, s) => sum + s.quantity * (old.find(o => o.serviceId === s.serviceId)?.price ?? 500), 0) - old.reduce((sum, s) => sum + s.quantity * s.price, 0);
  const patch = { adultCount: adults, childCount: children, services, packageDelta: delta, expectedTotal: expectedTotal ?? total };
  return { expected, patch, save: async () => (await one("select public.edit_guest_reservation_bill($1,$2,$3,$4) result", [reservation, actor, expected, patch])).result };
}
const code = value => error => error.code === value;

test("partially paid guests can reduce guest count and remove every service; captured prices and receipt history stay intact", async () => {
  const result = await (await edit({ adults: 20, services: [], delta: -250 })).save();
  assert.equal(result.totalAmount, 8150); assert.equal(result.remainingBalance, 6430); assert.equal(result.paidAmount, 1720);
  assert.equal(result.services.length, 0); assert.equal((await one("select adult_count from public.reservations")).adult_count, 20);
  assert.equal(Number((await one("select total_amount from public.invoices where status<>'void'")).total_amount), 8150);
  assert.equal((await one("select total_amount from public.invoices where status='void'")).total_amount, "8000");
  assert.equal((await one("select transaction_total_at_time from public.receipts")).transaction_total_at_time, "8600");
  assert.equal((await one("select details from public.audit_logs")).details.before_total, 8600);
});

test("existing archived services retain their booked prices while new services use catalog prices", async () => {
  const result = await (await edit({ adults: 23, delta: 125, services: [{ serviceId: service, quantity: 1 }, { serviceId: extra, quantity: 2 }] })).save();
  assert.equal(result.totalAmount, 9625); assert.equal(result.services.find(s => s.serviceId === service).priceAtTime, 100);
  assert.equal(result.services.find(s => s.serviceId === extra).priceAtTime, 500);
});

test("full payment prevents service reductions but permits additions and recalculated guest-count changes", async () => {
  await db.exec("update public.payments set amount=8600; update public.transactions set paid_amount=8600,status='paid'");
  await assert.rejects((await edit({ services: [] })).save, code("22023"));
  const result = await (await edit({ services: [{ serviceId: service, quantity: 3 }] })).save();
  assert.equal(result.remainingBalance, 100); assert.equal(result.totalAmount, 8700);
  const fewerGuests = await (await edit({ adults: 21, delta: -125, services: [{ serviceId: service, quantity: 3 }] })).save();
  assert.equal(fewerGuests.totalAmount, 8575); assert.equal(fewerGuests.overpaidAmount, 25);
});

test("unverified payments and active payment/reschedule/refund reviews cannot be bypassed", async () => {
  for (const table of ["payments", "reservation_reschedules", "refund_requests"]) {
    await db.query(`insert into public.${table}(reservation_id,status) values($1,'pending')`, [reservation]);
    await assert.rejects((await edit({ services: [] })).save, code("40001"));
    await db.query(`delete from public.${table} where status='pending'`);
  }
  await db.exec("update public.payments set amount=1600; insert into public.payments select reservation_id,'rejected',99999 from public.reservations; update public.transactions set paid_amount=1600");
  await db.query("insert into public.refund_requests values($1,'refunded',100)", [reservation]);
  await db.exec("update public.transactions set paid_amount=1500");
  assert.equal((await (await edit({ services: [] })).save()).paidAmount, 1500);
});

test("stale snapshots, changed catalog prices and invalid guest counts roll back every change", async () => {
  const stale = await edit({ services: [] }); await db.exec("update public.transactions set total_amount=8700");
  await assert.rejects(stale.save, code("40001"));
  for (const args of [{ adults: 31 }, { children: -1 }, { services: [{ serviceId: service, quantity: 0 }] }, { services: [{ serviceId: service, quantity: 1 }, { serviceId: service, quantity: 2 }] }]) {
    await assert.rejects((await edit(args)).save, code("22023"));
  }
  const changedPrice = await edit({ services: [{ serviceId: extra, quantity: 1 }] });
  await db.exec("update public.services set price=600 where is_active"); await assert.rejects(changedPrice.save, code("40001"));
  assert.equal((await one("select quantity from public.reservation_services")).quantity, 2);
  assert.equal((await one("select count(*) n from public.audit_logs")).n, 0);
});

test("unauthorized accounts and closed/expired bookings cannot edit; authenticated users cannot call the server-only RPC", async () => {
  await assert.rejects((await edit({ actor: other })).save, code("42501"));
  await db.exec("update public.guests set is_active=false"); await assert.rejects((await edit()).save, code("42501"));
  await db.exec("update public.guests set is_active=true; update public.reservations set status='cancelled'"); await assert.rejects((await edit()).save, code("40001"));
  await db.exec("update public.reservations set status='pending',payment_deadline_at=now()-interval '1 minute'"); await assert.rejects((await edit()).save, code("40001"));
  const attempt = await edit();
  await db.exec("set role authenticated");
  try { await assert.rejects(attempt.save, code("42501")); } finally { await db.exec("reset role"); }
});

test("during the stay only service additions are allowed, and excess payments remain available for manual refund", async () => {
  await db.exec("update public.reservations set start_datetime=now()-interval '1 hour',end_datetime=now()+interval '1 day'");
  await assert.rejects((await edit({ adults: 23, delta: 125 })).save, code("22023"));
  await assert.rejects((await edit({ services: [] })).save, code("22023"));
  assert.equal((await (await edit({ services: [{ serviceId: service, quantity: 3 }] })).save()).totalAmount, 8700);
  await db.exec("update public.reservations set start_datetime=now()+interval '1 day'; update public.transactions set total_amount=1800");
  const result = await (await edit({ services: [] })).save();
  assert.equal(result.totalAmount, 1500); assert.equal(result.paidAmount, 1720); assert.equal(result.overpaidAmount, 220); assert.equal(result.remainingBalance, 0);
  assert.equal((await one("select count(*) n from public.refund_requests")).n, 0);
});

test("an audit failure rolls back guest counts, service removal, invoice and financial totals together", async () => {
  await db.exec("create function public.reject_audit() returns trigger language plpgsql as $$begin raise exception 'audit failed'; end$$; create trigger fail_audit before insert on public.audit_logs for each row execute function public.reject_audit()");
  try {
    await assert.rejects((await edit({ adults: 20, services: [], delta: -250 })).save, /audit failed/);
    assert.equal((await one("select adult_count from public.reservations")).adult_count, 22);
    assert.equal((await one("select total_amount from public.transactions")).total_amount, "8600");
    assert.equal((await one("select quantity from public.reservation_services")).quantity, 2);
  } finally { await db.exec("drop trigger fail_audit on public.audit_logs; drop function public.reject_audit()"); }
  await db.exec(migration); assert.equal((await one("select transaction_total_at_time from public.receipts")).transaction_total_at_time, "8600");
});

test("direct guest writes cannot bypass bill editing while initial pending service inserts still work", async () => {
  await db.exec("grant usage on schema auth to authenticated; grant select,insert,update,delete on all tables in schema public to authenticated");
  await db.query("select set_config('fixture.guest',$1,false)", [guest]);
  await db.exec("set role authenticated");
  try {
    await assert.rejects(db.exec("update public.reservation_services set quantity=1"), code("42501"));
    await assert.rejects(db.exec("delete from public.reservation_services"), code("42501"));
  } finally { await db.exec("reset role"); }
  await db.exec("update public.reservations set status='pending',payment_deadline_at=now()+interval '30 minutes'; delete from public.payments");
  await db.exec("set role authenticated");
  try {
    await assert.rejects(db.query("insert into public.reservation_services values($1,$2,1,0)", [reservation, extra]), code("22023"));
    await db.query("insert into public.reservation_services values($1,$2,1,500)", [reservation, extra]);
    assert.equal((await one("select quantity from public.reservation_services where service_id=$1", [extra])).quantity, 1);
  } finally { await db.exec("reset role"); }
  await db.query("insert into public.staff_users values($1,true)", [other]);
  await db.query("select set_config('fixture.guest',$1,false)", [other]); await db.exec("set role authenticated");
  try { await db.exec("update public.reservation_services set quantity=3"); } finally { await db.exec("reset role"); }
});
