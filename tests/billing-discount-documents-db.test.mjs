import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync("docs/billing-discount-documents-migration.sql", "utf8");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table reservations(reservation_id uuid primary key,adult_count integer,child_count integer,guest_id uuid,walk_in_guest_id uuid);
    create table transactions(reservation_id uuid primary key,total_amount numeric,discount_amount numeric,discount_kind text,
      discount_promo_code text,discount_promo_type text,discount_promo_value numeric,discount_eligible_guests integer,discount_package_price numeric);
    create table payments(payment_id uuid primary key,reservation_id uuid,status text,amount numeric);
    create table receipts(payment_id uuid unique,receipt_number text,amount_paid numeric,transaction_total_at_time numeric,
      balance_after_payment numeric,billed_to_name text,email_sent boolean default false,is_active boolean default true);
    create table guests(id uuid,first_name text,last_name text);
    create table walk_in_guests(walk_in_guest_id uuid,first_name text,last_name text);
    create table refund_requests(reservation_id uuid,amount numeric,status text);
    insert into reservations values('${id(1)}',8,2,null,null);
    insert into transactions values('${id(1)}',9000,1000,'promo','SAVE10','percent',10,2,10000);
    insert into payments values('${id(2)}','${id(1)}','verified',1000);
    insert into receipts(payment_id,transaction_total_at_time) values('${id(2)}',9000);
    grant select,insert,update on receipts to authenticated;
  `);
  await db.exec(migration);
  const schema = readFileSync("updated-schema.sql", "utf8");
  const start = schema.lastIndexOf("create or replace function public.create_receipt_on_payment()");
  await db.exec(schema.slice(start, schema.indexOf("end $$;", start) + 7));
  await db.exec("create trigger trigger_create_receipt after update of status on payments for each row execute function public.create_receipt_on_payment()");
});
after(async () => db?.close());

test("verified payments issue receipts with the applied promo code, savings and package basis", async () => {
  await db.query("insert into payments values($1,$2,'pending',2000)", [id(3), id(1)]);
  await db.query("update payments set status='verified' where payment_id=$1", [id(3)]);
  const receipt = await one("select * from receipts where payment_id=$1", [id(3)]);
  assert.equal(receipt.transaction_total_at_time, "9000");
  assert.deepEqual(receipt.discount_snapshot, {
    amount: 1000, kind: "promo", promoCode: "SAVE10", promoType: "percent", promoValue: 10,
    eligibleGuests: 0, headCount: 10, packagePrice: 10000,
  });
});

test("later bill changes retain issued receipt details; only the winning PWD discount is saved on a later payment", async () => {
  await db.exec("update transactions set total_amount=8000,discount_amount=2000,discount_kind='pwd_senior',discount_eligible_guests=10");
  await db.query("insert into payments values($1,$2,'pending',1000)", [id(4), id(1)]);
  await db.query("update payments set status='verified' where payment_id=$1", [id(4)]);
  const old = await one("select discount_snapshot from receipts where payment_id=$1", [id(3)]);
  assert.equal(old.discount_snapshot.promoCode, "SAVE10"); assert.equal(old.discount_snapshot.amount, 1000);
  const current = (await one("select discount_snapshot from receipts where payment_id=$1", [id(4)])).discount_snapshot;
  assert.equal(current.kind, "pwd_senior"); assert.equal(current.eligibleGuests, 10);
  assert.equal(current.promoCode, null); assert.equal(current.promoValue, 0);
});

test("receipt snapshots cannot be forged or changed, while delivery and archive updates still work", async () => {
  await db.query("insert into payments values($1,$2,'verified',1000)", [id(5), id(1)]);
  await db.exec("set role authenticated");
  try {
    await db.query("insert into receipts(payment_id,transaction_total_at_time,discount_snapshot) values($1,8000,'{\"amount\":9999}')", [id(5)]);
    assert.equal((await one("select discount_snapshot from receipts where payment_id=$1", [id(5)])).discount_snapshot.amount, 2000);
    await assert.rejects(db.query("update receipts set discount_snapshot='{}' where payment_id=$1", [id(5)]), e => e.code === "42501");
    await assert.rejects(db.query("update receipts set transaction_total_at_time=1 where payment_id=$1", [id(5)]), e => e.code === "42501");
    await db.query("update receipts set email_sent=true,is_active=false where payment_id=$1", [id(5)]);
    assert.equal((await one("select email_sent from receipts where payment_id=$1", [id(5)])).email_sent, true);
  } finally { await db.exec("reset role"); }
});

test("historical receipts remain unknown and reapplying the migration preserves all saved snapshots", async () => {
  assert.equal((await one("select discount_snapshot from receipts where payment_id=$1", [id(2)])).discount_snapshot, null);
  await db.exec(migration);
  assert.equal((await one("select discount_snapshot from receipts where payment_id=$1", [id(3)])).discount_snapshot.promoCode, "SAVE10");
});

test("a receipt cannot snapshot a different booking total", async () => {
  await db.query("insert into payments values($1,$2,'verified',1000)", [id(6), id(1)]);
  await assert.rejects(db.query("insert into receipts(payment_id,transaction_total_at_time) values($1,9000)", [id(6)]), e => e.code === "23514");
});
