import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

let db;
const migration = readFileSync("docs/service-billing-types-migration.sql", "utf8");
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create table services(service_id text primary key,name text,price numeric,max_quantity integer);
    create table reservation_services(reservation_id text,service_id text references services,quantity integer,price_at_time numeric,primary key(reservation_id,service_id));
    insert into services values('karaoke','Karaoke',200,8),('mattress','Mattress',300,5);
    insert into reservation_services values('existing','karaoke',2,150);
  `);
  await db.exec(readFileSync("docs/service-quantity-limits-migration.sql", "utf8"));
  await db.exec(migration);
});
after(async () => db?.close());
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0];

test("migration preserves existing booking types, quantities and prices and can be reapplied", async () => {
  await db.exec(migration);
  assert.deepEqual(await row("select quantity,price_at_time,billing_type from reservation_services where reservation_id='existing'"),
    { quantity: 2, price_at_time: "150", billing_type: "quantity" });
});

test("new bookings use the catalog billing type, with hourly totals and item counts", async () => {
  await db.exec("update services set billing_type='duration' where service_id='karaoke'");
  await db.exec("insert into reservation_services values('new','karaoke',3,200,'quantity'),('new','mattress',2,300,'duration')");
  assert.deepEqual(await row("select billing_type,quantity*price_at_time amount from reservation_services where reservation_id='new' and service_id='karaoke'"),
    { billing_type: "duration", amount: "600" });
  assert.equal((await row("select billing_type from reservation_services where reservation_id='new' and service_id='mattress'")).billing_type, "quantity");
  await assert.rejects(db.exec("insert into reservation_services values('too-many','karaoke',9,200)"), error => error.code === "22023" && /8 rental hours/.test(error.message));
});

test("catalog edits and upserts retain the original booked type and rate", async () => {
  await db.exec("update services set billing_type='quantity',price=900 where service_id='karaoke'");
  await db.exec("insert into reservation_services values('new','karaoke',4,200) on conflict(reservation_id,service_id) do update set quantity=excluded.quantity");
  const original = await row("select billing_type,quantity,price_at_time from reservation_services where reservation_id='new' and service_id='karaoke'");
  assert.deepEqual(original, { billing_type: "duration", quantity: 4, price_at_time: "200" });
  await db.exec("update reservation_services set billing_type='quantity' where reservation_id='new' and service_id='karaoke'");
  assert.equal((await row("select billing_type from reservation_services where reservation_id='new' and service_id='karaoke'")).billing_type, "duration");
  await db.exec("insert into reservation_services values('later','karaoke',1,900)");
  assert.equal((await row("select billing_type from reservation_services where reservation_id='later'")).billing_type, "quantity");
  await assert.rejects(db.exec("update services set billing_type='invalid' where service_id='karaoke'"), error => error.code === "23514");
});
