import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRoomDatabase } from "./helpers/room-database.mjs";

const migration = readFileSync("docs/manual-multi-room-reservation-migration.sql", "utf8");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db, standard, family;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const reserve = async (input, actor = id(1), rpc = "room_reserve_multiple_priced") => (await one(`select ${rpc}($1,$2,$3::jsonb) result`, [actor, standard, JSON.stringify(input)])).result;
const code = expected => error => error.code === expected;
before(async () => {
  db = await createRoomDatabase();
  // The pool-room prerequisite also changes allocators outside this fixture.
  // Reproduce its inventory column and protected pair for this creation path.
  await db.exec("alter table physical_rooms add column private_swimming_only boolean not null default false");
  await db.exec(migration); await db.exec(migration);
  standard = (await one("select room_id from physical_rooms where room_number='S03'")).room_id;
  family = (await one("select room_id from physical_rooms where room_number='F01'")).room_id;
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec("reset role; truncate reservations,walk_in_guests,staff_users,promo_codes,transactions,audit_logs,notifications cascade; update physical_rooms set status='vacant',is_active=true,private_swimming_only=room_number in ('S01','S02'); update room_classifications set pricing_version=1,rate_3_hours=case when code='family' then 500 else 300 end,rate_12_hours=case when code='family' then 1500 else 900 end,extension_hourly_rate=case when code='family' then 200 else 150 end,additional_guest_rate=case when code='family' then 100 else 0 end,cleaning_buffer_minutes=60");
  await db.query("insert into staff_users values($1,'Admin','admin',true),($2,'Manager','staff',true),($3,'Cashier','cashier',true),($4,'Disabled','admin',false)", [id(1), id(2), id(3), id(4)]);
  await db.exec("update role_permissions set permissions=array['rooms','room_operations','create_reservation','edit_reservation'] where role='staff'");
});
function input(overrides = {}) {
  const starts_at = new Date(Date.now() + 24 * 3600000).toISOString();
  const result = { first_name: "Real", last_name: "Guest", phone: "+639171234567", address: "Guest address", occupants: 8,
    commercial_type: "room_accommodation", starts_at, duration_hours: 3, extension_hours: 1, pricing_version: 1,
    eligible_guests: 0, expected_total: 1350,
    rooms: [{ room_id: standard, occupants: 2, pricing_version: 1 }, { room_id: family, occupants: 6, pricing_version: 1 }], ...overrides };
  result.ends_at = new Date(Date.parse(result.starts_at) + (result.duration_hours + result.extension_hours) * 3600000).toISOString();
  return result;
}
const counts = async () => {
  const result = {};
  for (const table of ["reservations", "walk_in_guests", "transactions", "room_assignments", "room_charges", "room_extensions", "room_activity", "audit_logs", "promo_redemptions"])
    result[table] = (await one(`select count(*)::int n from ${table}`)).n;
  return result;
};

test("mixed room classes create one guest, reference and bill with per-room occupants, extensions and one winning discount", async () => {
  await db.exec("insert into promo_codes(code,discount_type,discount_value) values('GROUP100','fixed',100)");
  const result = await reserve(input({ eligible_guests: 4, promo_code: "GROUP100", discount_reason: "Verified guest eligibility", expected_total: 1250 }), id(2));
  const saved = await one("select * from reservations where reservation_id=$1", [result.reservation_id]);
  assert.equal(saved.adult_count, 8); assert.equal(saved.reference_number, result.reference_number);
  const lines = (await db.query("select * from room_assignments where reservation_id=$1 order by occupants", [result.reservation_id])).rows;
  assert.deepEqual(lines.map(row => row.occupants), [2, 6]);
  assert.equal(new Set(lines.map(row => row.reservation_id)).size, 1);
  assert.ok(lines.every(row => row.pricing_snapshot.version === 1 && row.pricing_snapshot.extension_hours === 1));
  assert.ok(lines.every(row => Date.parse(row.expected_checkout) - Date.parse(row.starts_at) === 4 * 3600000));
  const bill = await one("select * from transactions where reservation_id=$1", [result.reservation_id]);
  assert.equal(Number(bill.discount_package_price), 800); assert.equal(Number(bill.discount_amount), 100);
  assert.equal(bill.discount_kind, "promo"); assert.equal(Number(bill.total_amount), 1250);
  const n = await counts(); assert.equal(n.reservations, 1); assert.equal(n.walk_in_guests, 1); assert.equal(n.transactions, 1);
  assert.equal(n.room_assignments, 2); assert.equal(n.room_extensions, 2); assert.equal(n.room_activity, 2); assert.equal(n.promo_redemptions, 1);
});

test("a conflict in the later room rolls back every claim and charge, and a cancelled claim releases inventory", async () => {
  const request = input();
  const single = { ...request, occupants: 6, pricing_version: 1, expected_total: 900 };
  delete single.rooms;
  const existing = (await one("select room_reserve_priced($1,$2,$3::jsonb) result", [id(1), family, JSON.stringify(single)])).result;
  const before = await counts();
  await assert.rejects(() => reserve(request), code("40001")); assert.deepEqual(await counts(), before);
  await db.query("update reservations set status='cancelled' where reservation_id=$1", [existing.reservation_id]);
  const group = await reserve(request);
  assert.equal((await one("select count(*)::int n from room_assignments where reservation_id=$1", [group.reservation_id])).n, 2);
  await assert.rejects(() => reserve(request), code("40001"));
});

test("duplicate, protected, inactive, over-capacity and stale room selections cannot partially create reservations", async () => {
  const protectedRoom = (await one("select room_id from physical_rooms where room_number='S01'")).room_id;
  for (const overrides of [
    { rooms: null }, { rooms: [] }, { rooms: [null] },
    { rooms: [{ room_id: standard, occupants: 2, pricing_version: 1 }, { room_id: standard, occupants: 2, pricing_version: 1 }], occupants: 4 },
    { rooms: [{ room_id: standard, occupants: 2, pricing_version: 1 }, { room_id: protectedRoom, occupants: 2, pricing_version: 1 }], occupants: 4 },
    { rooms: [{ room_id: standard, occupants: 3, pricing_version: 1 }, { room_id: family, occupants: 5, pricing_version: 1 }] },
    { rooms: [{ room_id: standard, occupants: 2, pricing_version: 1 }, { room_id: family, occupants: 6, pricing_version: 2 }] },
    { occupants: 7 }, { commercial_type: "public_swimming" }, { expected_total: 1 },
  ]) {
    await assert.rejects(() => reserve(input(overrides)));
    assert.ok(Object.values(await counts()).every(n => n === 0), JSON.stringify(overrides));
  }
  await db.query("update physical_rooms set is_active=false where room_id=$1", [family]);
  await assert.rejects(() => reserve(input()), code("22023"));
  assert.ok(Object.values(await counts()).every(n => n === 0));
});

test("maintenance and cleaning buffers apply to every selected room", async () => {
  const request = input();
  await db.query("insert into room_maintenance(room_id,starts_at,ends_at,reason,created_by) values($1,$2,$3,'Pool-side maintenance',$4)", [family, request.starts_at, request.ends_at, id(1)]);
  await assert.rejects(() => reserve(request), code("40001")); assert.equal((await counts()).reservations, 0);
  await db.exec("truncate room_maintenance");
  const first = await reserve(request);
  const buffered = input({ starts_at: new Date(Date.parse(request.ends_at) + 30 * 60000).toISOString() });
  await assert.rejects(() => reserve(buffered), code("40001"));
  assert.equal((await counts()).reservations, 1); assert.ok(first.reservation_id);
});

test("single-room callers keep their contract and a repeated migration preserves existing reservations and prices", async () => {
  const request = input({ occupants: 2, extension_hours: 0, expected_total: 300 }); delete request.rooms;
  const result = await reserve(request, id(2), "room_reserve_priced");
  assert.equal(Number(result.total_amount), 300); assert.equal((await counts()).room_assignments, 1);
  const before = await counts(); const bill = await one("select * from transactions");
  await db.exec(migration); assert.deepEqual(await counts(), before); assert.deepEqual(await one("select * from transactions"), bill);
  assert.equal((await one("select has_function_privilege('authenticated','room_reserve_multiple_priced(uuid,uuid,jsonb)','execute') allowed")).allowed, false);
});

test("operation and discount permissions apply to group reservations even when bypassing the API", async () => {
  for (const actor of [id(3), id(4)]) await assert.rejects(() => reserve(input(), actor), code("42501"));
  await db.exec("update role_permissions set permissions=array['rooms','room_operations','create_reservation'] where role='staff'");
  await assert.rejects(() => reserve(input({ eligible_guests: 4, discount_reason: "Verified four eligibility IDs", expected_total: 1270 }), id(2)), code("42501"));
  assert.ok(Object.values(await counts()).every(n => n === 0));
});
