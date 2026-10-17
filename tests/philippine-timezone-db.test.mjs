import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("timezone migration preserves history and instant defaults in UTC and Manila sessions", async () => {
  const db = new PGlite();
  const migration = readFileSync("docs/philippine-timezone-migration.sql", "utf8");
  try {
    await db.exec(`create table public.payments(id integer generated always as identity,created_at timestamptz default timezone('utc',now()),paid_at timestamptz default timezone('utc',now()));
      create table public.transactions(total_amount numeric,created_at timestamptz default timezone('utc',now()));
      create table public.calendar_settings(opening_at timestamp default timezone('utc',now()));
      insert into payments(created_at,paid_at) values('2026-10-16T16:30:00Z','2026-10-16T16:30:00Z');
      insert into transactions values(100,'2026-12-31T16:30:00Z');`);
    const snapshot = async () => (await db.query("select extract(epoch from created_at)::text as created,extract(epoch from paid_at)::text as paid from payments where id=1")).rows[0];
    const before = await snapshot();
    await db.exec(migration); await db.exec(migration);
    assert.deepEqual(await snapshot(), before, "migration must not rewrite any historical instant");
    const defaults = (await db.query("select column_name,column_default from information_schema.columns where table_schema='public' and table_name='payments' and column_name in ('created_at','paid_at')")).rows;
    assert.equal(defaults.length, 2); assert.ok(defaults.every(row => row.column_default === "now()"));
    const naive = (await db.query("select column_default from information_schema.columns where table_name='calendar_settings' and column_name='opening_at'")).rows[0];
    assert.match(naive.column_default, /timezone/, "do not reinterpret wall-clock columns");
    for (const zone of ["UTC", "Asia/Manila", "America/Los_Angeles"]) {
      await db.query("select set_config('TimeZone',$1,false)", [zone]);
      const inserted = (await db.query("insert into payments default values returning abs(extract(epoch from created_at-now())) as drift,created_at at time zone 'Asia/Manila'=now() at time zone 'Asia/Manila' as correct")).rows[0];
      assert.equal(Number(inserted.drift), 0); assert.equal(inserted.correct, true);
      const month = (await db.query("select * from get_sales_report('monthly')")).rows[0];
      assert.equal(month.label, "Jan"); assert.equal(Number(month.revenue), 100);
      const daily = (await db.query("select * from get_sales_report('daily')")).rows[0];
      assert.equal(daily.label, "Fri"); // Jan 1, 2027 in Manila, Thursday in UTC.
    }
  } finally { await db.close(); }
});
