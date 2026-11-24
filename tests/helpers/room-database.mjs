import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fn(path, name) { const sql = readFileSync(path, "utf8"), start = sql.indexOf(`create or replace function public.${name}(`); assert.ok(start >= 0); return sql.slice(start, sql.indexOf("$$;", start) + 3); }
export async function createRoomDatabase() {
  let db;

  db = new PGlite({ extensions: { btree_gist } });
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create table staff_users(id uuid primary key,full_name text,role text,is_active boolean);
    create table role_permissions(role text primary key,permissions text[]);
    create table walk_in_guests(walk_in_guest_id uuid primary key default gen_random_uuid(),first_name text,last_name text,phone_number text,address text);
    create table reservations(reservation_id uuid primary key default gen_random_uuid(),reference_number text unique,guest_id uuid,walk_in_guest_id uuid references walk_in_guests,
      booking_mode text,booking_type text,package_rate_version bigint,start_datetime timestamptz,end_datetime timestamptz,adult_count integer,child_count integer,status text,payment_deadline_at timestamptz,
      checked_in_at timestamptz,checked_in_by uuid,checked_out_at timestamptz,checked_out_by uuid,cancelled_by uuid);
    create table transactions(reservation_id uuid primary key,total_amount numeric not null,paid_amount numeric default 0,status text,discount_amount numeric default 0,
      balance numeric generated always as(greatest(total_amount-paid_amount,0)) stored);
    create table payments(reservation_id uuid,amount numeric,status text);
    create table refund_requests(reservation_id uuid,amount numeric,status text);
    create table reservation_reschedules(reservation_id uuid,status text);
    create table invoices(invoice_id uuid default gen_random_uuid(),reservation_id uuid,total_amount numeric,status text,created_at timestamptz default now());
    create table audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
    create table notifications(recipient_role text,recipient_id uuid,actor_id uuid,title text,message text,action_url text,entity_type text,entity_id uuid);
    create table maintenance_blocks(block_id uuid default gen_random_uuid(),start_datetime timestamptz,end_datetime timestamptz,status text);
    create table units(unit_id uuid primary key,name text);
    create table services(service_id uuid primary key,name text,billing_type text);
    create table package_rate_versions(version bigint primary key,rates jsonb);
    create table reservation_services(reservation_id uuid,service_id uuid,quantity integer);
    create table reservation_units(reservation_id uuid,unit_id uuid,quantity integer);`);
  for (const name of ["check_in_reservation", "check_out_reservation", "guard_stay_lifecycle"]) await db.exec(fn("docs/stay-completion-migration.sql", name));
  await db.exec("create trigger guard_stay_lifecycle before update on reservations for each row execute function public.guard_stay_lifecycle()");
  await db.exec(fn("docs/overpayment-refunds-migration.sql", "refresh_reservation_payment_totals"));
  // Deployed databases already allow day and overnight bookings on the same
  // Manila date. Exercise migration against that real predecessor and records.
  await db.exec(readFileSync("docs/time-slot-reservation-migration.sql", "utf8"));
  await db.exec(`insert into reservations(reservation_id,reference_number,status,start_datetime,end_datetime,adult_count,child_count) values
    ('${id(80)}','EXISTING-DAY','confirmed','2026-10-31T08:00:00+08:00','2026-10-31T16:00:00+08:00',2,0),
    ('${id(81)}','EXISTING-NIGHT','confirmed','2026-10-31T18:00:00+08:00','2026-11-01T06:00:00+08:00',2,0)`);
  const existingReservations = (await db.query("select * from reservations order by reservation_id")).rows;
  // Exercise the full migration, including real GiST constraints, RLS and grants,
  // twice to check repeatability. Fixtures only replace the pre-existing schema.
  await db.exec(readFileSync("docs/room-management-migration.sql", "utf8"));
  await db.exec(readFileSync("docs/room-management-migration.sql", "utf8"));
  assert.deepEqual((await db.query("select * from reservations order by reservation_id")).rows,
    existingReservations.map(row => ({ ...row, commercial_type: "private_swimming" })));
  const discounts = readFileSync("docs/guest-discounts-promos-refund-details-migration.sql", "utf8");
  await db.exec(discounts.slice(discounts.indexOf("create table if not exists public.promo_codes("), discounts.indexOf("-- Existing adult/child")));
  await db.exec(fn("docs/guest-discounts-promos-refund-details-migration.sql", "reprice_booking_discount"));
  await db.exec(fn("docs/guest-discounts-promos-refund-details-migration.sql", "guard_booking_discount_write"));
  await db.exec("create trigger guard_booking_discount_write before insert or update on transactions for each row execute function guard_booking_discount_write()");
  await db.exec(readFileSync("docs/promo-usage-limits-migration.sql", "utf8"));
  await db.exec(readFileSync("docs/room-rates-discounts-migration.sql", "utf8"));
  const snapshot = (await db.query("select * from room_classifications order by code")).rows;
  assert.equal(Number(snapshot[0].rate_3_hours),300); assert.equal(Number(snapshot[0].rate_12_hours),900); assert.equal(Number(snapshot[0].extension_hourly_rate),150);
  await db.exec(readFileSync("docs/room-rates-discounts-migration.sql", "utf8"));
  assert.deepEqual((await db.query("select * from room_classifications order by code")).rows,snapshot);
  await db.exec(`create table guests(id uuid primary key,first_name text,last_name text,phone_number text,address text,is_active boolean default true);
    alter table reservations add column booking_policy_version bigint,add column terms_policy_id uuid,add column privacy_policy_id uuid,add column special_requests text;
    alter table services add column price numeric default 100,add column description text,add column image_url text,add column max_quantity integer default 10000,add column is_active boolean default true;
    alter table reservation_services add column price_at_time numeric,add column billing_type text;
    alter table payments add column payment_type text default 'additional';`);
  await db.exec(readFileSync("docs/customer-room-booking-migration.sql","utf8"));
  await db.exec(readFileSync("docs/customer-room-booking-migration.sql","utf8"));
  await db.exec(readFileSync("docs/room-online-time-slots-migration.sql","utf8"));
  await db.exec(readFileSync("docs/room-online-time-slots-migration.sql","utf8"));


  return db;
}

