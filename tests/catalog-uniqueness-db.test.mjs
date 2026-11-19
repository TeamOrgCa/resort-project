import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync("docs/catalog-uniqueness-migration.sql", "utf8");
const schema = `create table services(id integer primary key,name text,is_active boolean);
  create table units(id integer primary key,name text,is_active boolean);
  create table payment_methods(id integer primary key,name text,is_active boolean);
  create table ocular_time_slots(id integer primary key,start_time time,end_time time,is_active boolean);`;
let db;
before(async () => { db = new PGlite(); await db.exec(schema); await db.exec(migration); await db.exec(migration); });
beforeEach(async () => db.exec("truncate services,units,payment_methods,ocular_time_slots"));
after(async () => db?.close());

test("catalog name uniqueness rejects case and spacing duplicates, including archived records and renamed items", async () => {
  for (const table of ["services", "units", "payment_methods"]) {
    await db.exec(`insert into ${table} values(1,'Extra mattress',false),(2,'Different item',true)`);
    for (const name of ["Extra mattress", " EXTRA MATTRESS ", "Extra\t  mattress"]) {
      await assert.rejects(db.query(`insert into ${table} values(3,$1,true)`, [name]), error => error.code === "23505");
      await assert.rejects(db.query(`update ${table} set name=$1 where id=2`, [name]), error => error.code === "23505");
    }
    await db.exec(`update ${table} set name='EXTRA MATTRESS',is_active=true where id=1`);
    assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n, 2);
  }
});

test("ocular times reject exact duplicates on insert and update while retaining distinct time ranges", async () => {
  await db.exec("insert into ocular_time_slots values(1,'08:00','09:00',false),(2,'10:00','11:00',true)");
  await assert.rejects(db.exec("insert into ocular_time_slots values(3,'08:00:00','09:00:00',true)"), error => error.code === "23505");
  await assert.rejects(db.exec("update ocular_time_slots set start_time='08:00',end_time='09:00' where id=2"), error => error.code === "23505");
  await db.exec("update ocular_time_slots set is_active=true where id=1; insert into ocular_time_slots values(3,'08:00','10:00',true)");
  assert.equal((await db.query("select count(*)::int n from ocular_time_slots")).rows[0].n, 3);
});

test("installing uniqueness fails clearly on existing duplicates and preserves every record", async () => {
  const old = new PGlite();
  try {
    await old.exec(schema);
    await old.exec("insert into services values(1,'Mattress',true),(2,' mattress ',false)");
    await assert.rejects(old.exec(migration), /Duplicate name in services/);
    await old.exec("rollback");
    assert.equal((await old.query("select count(*)::int n from services")).rows[0].n, 2);
    await old.exec("update services set name='Other mattress' where id=2; insert into ocular_time_slots values(1,'08:00','09:00',true),(2,'08:00','09:00',false)");
    await assert.rejects(old.exec(migration), /Duplicate ocular time slots/);
    await old.exec("rollback");
    assert.equal((await old.query("select count(*)::int n from ocular_time_slots")).rows[0].n, 2);
  } finally { await old.close(); }
});
