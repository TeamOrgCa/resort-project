import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";

const { DEFAULT_PACKAGE_TIMES, parsePackageTimes, packageTimesLabel } = loadTsModule("lib/booking/package-times.ts");
const { buildBookingWindow, validateBookingWindow } = loadTsModule("lib/booking/policy.ts");
const { validateEditWindow } = loadTsModule("lib/booking/reservation-edit.ts");
const copy = () => structuredClone(DEFAULT_PACKAGE_TIMES);
const edited = () => ({ ...copy(), day: { start: "09:30", end: "17:00", endDayOffset: 0 },
  night: { start: "19:15", end: "07:30", endDayOffset: 1 } });

test("edited minute-precision slots generate and validate exact Manila windows across a month boundary", () => {
  const times = edited();
  const window = buildBookingWindow({ bookingMode: "night", date: new Date("2027-01-31T00:00:00"), packageTimes: times });
  assert.equal(window.startDatetime, "2027-01-31T11:15:00.000Z");
  assert.equal(window.endDatetime, "2027-01-31T23:30:00.000Z");
  assert.equal(validateBookingWindow({ ...window, bookingMode: "night" }, times).valid, true);
  assert.equal(validateBookingWindow({ ...window, bookingMode: "night" }).valid, false);
  const moved = { ...window, startDatetime: "2027-02-01T11:15:00.000Z", endDatetime: "2027-02-01T23:30:00.000Z", bookingMode: "night" };
  assert.equal(validateEditWindow(moved, times).valid, true, "historical times validate when moving to another date");
  assert.equal(validateBookingWindow({ bookingMode: "day", startDatetime: "2027-06-14T10:30:00+08:00", endDatetime: "2027-06-14T18:00:00+08:00" }, times).valid, false, "matching duration does not authorize a different start");
  times.whole_day.night_to_day = { start: "20:00", end: "18:30", endDayOffset: 1 };
  const whole = buildBookingWindow({ bookingMode: "whole_day", wholeDayVariant: "night_to_day", date: new Date("2027-06-14T00:00:00"), packageTimes: times });
  assert.equal(validateEditWindow({ ...whole, bookingMode: "whole_day" }, times).valid, true);
  assert.match(packageTimesLabel("whole_day", times), /8:00 PM.*6:30 PM next day/);
  const imported = { booking_mode: "day", start_datetime: "2027-06-14T10:00:00+08:00", end_datetime: "2027-06-14T18:00:00+08:00" };
  assert.equal(validateEditWindow({ bookingMode: "day", startDatetime: "2027-06-15T10:00:00+08:00", endDatetime: "2027-06-15T18:00:00+08:00" }, copy(), imported).valid, true);
});

test("time validation rejects missing slots, malformed clocks, zero/negative stays and stays over 24 hours", () => {
  assert.deepEqual(parsePackageTimes(DEFAULT_PACKAGE_TIMES), DEFAULT_PACKAGE_TIMES);
  for (const slot of [
    { start: "24:00", end: "17:00", endDayOffset: 0 },
    { start: "09:60", end: "17:00", endDayOffset: 0 },
    { start: "9:00", end: "17:00", endDayOffset: 0 },
    { start: "17:00", end: "09:00", endDayOffset: 0 },
    { start: "09:00", end: "09:00", endDayOffset: 0 },
    { start: "09:00", end: "17:00", endDayOffset: 1 },
    { start: "09:00", end: "17:00", endDayOffset: "0" },
  ]) assert.equal(parsePackageTimes({ ...copy(), day: slot }), null);
  assert.equal(parsePackageTimes({ ...copy(), whole_day: {} }), null);
  assert.ok(parsePackageTimes({ ...copy(), day: { start: "09:00", end: "09:00", endDayOffset: 1 } }));
});

test("admin API publishes times with prices and rejects invalid slots before writing", async () => {
  const writes = [];
  const route = loadTsModule("app/api/admin/catalog/package-rates/route.ts", {
    "@/lib/server/admin-audit": { requireAdminStaff: async () => ({ supabase: { rpc: async (name, args) => {
      writes.push({ name, args }); return { data: 2, error: null };
    } } }) },
  });
  const save = times => route.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ rates: legacyRates, expectedVersion: 1, times }) }));
  assert.equal((await save({})).status, 400);
  assert.equal(writes.length, 0);
  const response = await save(edited());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).schedule.times, edited());
  assert.deepEqual(writes[0].args.p_times, edited());
});

test("chatbot time and price answers use saved times and do not quote defaults when unavailable", () => {
  const { getBookingGuidance, instructionForGuestBookings } = loadTsModule("lib/chatbot/guardrails.ts");
  assert.match(getBookingGuidance("What time are the swimming packages?", legacyRates, edited()), /9:30 AM.*5:00 PM/);
  assert.match(getBookingGuidance("Swimming prices?", legacyRates, edited()), /7:15 PM.*7:30 AM next day/);
  assert.match(instructionForGuestBookings([], true, legacyRates, edited()), /9:30 AM/);
  assert.doesNotMatch(getBookingGuidance("What time are the swimming packages?"), /8 AM|8:00 AM/);
});

let db;
const staff = "11111111-1111-4111-8111-111111111111";
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create table staff_users(id uuid primary key,role text,is_active boolean);
    create table audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,details jsonb);
    create table reservations(reservation_id uuid primary key default gen_random_uuid(),booking_mode text,start_datetime timestamptz,end_datetime timestamptz);
    insert into staff_users values('${staff}','admin',true);`);
  await db.exec(readFileSync("docs/package-rates-migration.sql", "utf8"));
  await db.exec(`insert into reservations(booking_mode,start_datetime,end_datetime) values('day','2027-06-14T08:00:00+08:00','2027-06-14T16:00:00+08:00')`);
  await db.exec(readFileSync("docs/package-times-migration.sql", "utf8"));
});
after(async () => db?.close());

test("database versions times, rejects stale/forged bookings, preserves historical windows and restores defaults", async () => {
  const first = await one("select * from get_package_rates()");
  assert.deepEqual(first.times, DEFAULT_PACKAGE_TIMES);
  assert.equal((await one("select valid_package_times($1::jsonb) valid", [JSON.stringify({ ...copy(), day: { start: "09:00", end: "17:00", endDayOffset: 1 } })])).valid, false);
  await assert.rejects(() => one("select publish_package_rates($1::jsonb,$2,$3::jsonb)", [JSON.stringify(legacyRates), first.version, JSON.stringify(edited())]), e => e.code === "42501");
  await db.query("select set_config('test.actor',$1,false)", [staff]);
  const published = await one("select publish_package_rates($1::jsonb,$2,$3::jsonb) version", [JSON.stringify(legacyRates), first.version, JSON.stringify(edited())]);
  assert.ok(published.version > first.version);
  const historical = await one("select * from reservations");
  assert.equal(historical.package_rate_version, first.version);
  assert.equal(new Date(historical.start_datetime).toISOString(), "2027-06-14T00:00:00.000Z");
  assert.deepEqual((await one("select * from get_package_rates($1)", [first.version])).times, DEFAULT_PACKAGE_TIMES);
  await assert.rejects(() => db.query("insert into reservations(booking_mode,start_datetime,end_datetime,package_rate_version) values('day','2027-06-15T09:30:00+08:00','2027-06-15T17:00:00+08:00',$1)", [first.version]), e => e.code === "40001");
  await assert.rejects(() => db.exec("insert into reservations(booking_mode,start_datetime,end_datetime) values('day','2027-06-15T08:00:00+08:00','2027-06-15T16:00:00+08:00')"), e => e.code === "22023");
  await db.exec("insert into reservations(booking_mode,start_datetime,end_datetime) values('day','2027-06-15T09:30:00+08:00','2027-06-15T17:00:00+08:00')");
  await assert.rejects(() => one("select publish_package_rates($1::jsonb,$2,$3::jsonb)", [JSON.stringify(legacyRates), first.version, JSON.stringify(copy())]), e => e.code === "40001");
  await db.exec(readFileSync("docs/package-times-migration.sql", "utf8"));
  assert.deepEqual((await one("select * from get_package_rates()")).times, edited(), "reapplying migration must preserve edited times");
  const restored = await one("select publish_package_rates($1::jsonb,$2,$3::jsonb) version", [JSON.stringify(legacyRates), published.version, JSON.stringify(copy())]);
  assert.ok(restored.version > published.version);
  assert.deepEqual((await one("select * from get_package_rates()")).times, DEFAULT_PACKAGE_TIMES);
  assert.deepEqual((await one("select * from get_package_rates($1)", [published.version])).times, edited());
  assert.equal((await one("select count(*)::int n from audit_logs where action='Updated swimming package rates and time slots'")).n, 2);
});
