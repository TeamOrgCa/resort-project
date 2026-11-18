import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const sql = name => readFileSync(`docs/${name}-migration.sql`, "utf8");
const guest = "11111111-1111-4111-8111-111111111111", manager = "22222222-2222-4222-8222-222222222222";
const booking = "33333333-3333-4333-8333-333333333333", service = "44444444-4444-4444-8444-444444444444";
const unit = "55555555-5555-4555-8555-555555555555", nextUnit = "66666666-6666-4666-8666-666666666666";

test("advance booking limit applies to new bookings and reschedules, includes the last Philippine date, and preserves unchanged historical dates", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;
      create table business_settings(setting_key text primary key,setting_value jsonb);
      create table reservations(reservation_id uuid primary key,start_datetime timestamptz,special_requests text);
      insert into business_settings values('reservation.maximum_advance_booking_days','2');`);
    await db.exec(sql("advance-booking-window")); await db.exec(sql("advance-booking-window"));
    const day = (await db.query("select ((clock_timestamp() at time zone 'Asia/Manila')::date+2)::text as deadline")).rows[0].deadline;
    await db.query("insert into reservations values($1,($2||'T23:30:00+08:00')::timestamptz,'')", [booking, day]);
    await assert.rejects(() => db.query("update reservations set start_datetime=start_datetime+interval '1 day'"), /Bookings are available only through/);
    await assert.rejects(() => db.query("insert into reservations values($1,clock_timestamp()+interval '4 days','')", [unit]), /Bookings are available only through/);
    await db.exec("update business_settings set setting_value='0'");
    await db.exec("update reservations set special_requests='Keep already-booked date'");
    await db.exec("update reservations set start_datetime=start_datetime");
    assert.equal((await db.query("select special_requests from reservations")).rows[0].special_requests, "Keep already-booked date");
  } finally { await db.close(); }
});

test("atomic guest accommodation changes and manager service reductions preserve receipts, payments and negotiated package totals", async () => {
  const db = new PGlite();
  const one = async (query, args = []) => (await db.query(query, args)).rows[0];
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table guests(id uuid,is_active boolean);
      create table staff_users(id uuid,role text,is_active boolean);
      create table role_permissions(role text,permissions text[]);
      create table reservations(reservation_id uuid primary key,guest_id uuid,reference_number text,status text,booking_mode text,
        start_datetime timestamptz,end_datetime timestamptz,adult_count integer,child_count integer,
        updated_at timestamptz default clock_timestamp(),payment_deadline_at timestamptz,checked_in_at timestamptz,checked_out_at timestamptz,special_requests text);
      create table transactions(reservation_id uuid primary key,total_amount numeric,paid_amount numeric,status text);
      create table reservation_services(reservation_id uuid,service_id uuid,quantity integer,price_at_time numeric,unique(reservation_id,service_id));
      create table reservation_units(reservation_id uuid,unit_id uuid,quantity integer,price_per_night numeric);
      create table services(service_id uuid primary key,name text,price numeric,is_active boolean);
      create table units(unit_id uuid primary key,base_price numeric,is_active boolean,archived_at timestamptz);
      create table payments(reservation_id uuid,status text,amount numeric);
      create table refund_requests(reservation_id uuid,status text,amount numeric);
      create table reservation_reschedules(reservation_id uuid,status text);
      create table invoices(invoice_id uuid default gen_random_uuid(),reservation_id uuid,total_amount numeric,status text,created_at timestamptz default now());
      create table receipts(reservation_id uuid,amount_paid numeric,transaction_total_at_time numeric);
      create table audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
      create function refresh_reservation_payment_totals(p_reservation uuid) returns void language sql as $$
        update public.transactions set paid_amount=(select coalesce(sum(amount),0) from public.payments where reservation_id=p_reservation and status='verified') where reservation_id=p_reservation;
      $$;`);
    await db.exec(sql("accommodation-and-manager-service-edit")); await db.exec(sql("service-quantity-limits"));
    await db.query("insert into guests values($1,true);", [guest]);
    await db.query("insert into staff_users values($1,'staff',true)", [manager]);
    await db.exec("insert into role_permissions values('staff',array['edit_reservation']),('cashier',array['edit_reservation'])");
    await db.query("insert into reservations values($1,$2,'MV-TEST','confirmed','day',now()+interval '5 days',now()+interval '5 days 8 hours',20,0,clock_timestamp(),null,null,null,'')", [booking,guest]);
    await db.query("insert into units values($1,999,true,null),($2,5000,true,null)", [unit,nextUnit]);
    await db.query("insert into reservation_units values($1,$2,1,999)", [booking,unit]);
    await db.query("insert into services(service_id,name,price,is_active) values($1,'Table',999,true)", [service]);
    await db.query("insert into reservation_services values($1,$2,3,100)", [booking,service]);
    await db.query("insert into transactions values($1,8600,8500,'partial')", [booking]);
    await db.query("insert into payments values($1,'verified',8500)", [booking]);
    await db.query("insert into invoices(reservation_id,total_amount,status) values($1,8600,'partially_paid')", [booking]);
    await db.query("insert into receipts values($1,8500,8600)", [booking]);
    async function snapshot() {
      const r = await one("select * from reservations"), b = await one("select * from transactions");
      return { updatedAt:r.updated_at, totalAmount:Number(b.total_amount),paidAmount:Number(b.paid_amount),
        services:(await db.query('select service_id "serviceId",quantity,price_at_time::float8 price from reservation_services order by service_id')).rows,
        units:(await db.query('select unit_id "unitId",quantity,price_per_night::float8 price from reservation_units order by unit_id')).rows };
    }
    const guestPatch = {adultCount:20,childCount:0,services:[{serviceId:service,quantity:3}],unitId:nextUnit,packageDelta:0,expectedTotal:8600};
    await db.query("select edit_guest_reservation_bill($1,$2,$3,$4)", [booking,guest,await snapshot(),guestPatch]);
    assert.equal((await one("select unit_id from reservation_units")).unit_id,nextUnit);
    assert.equal(Number((await one("select total_amount from transactions")).total_amount),8600,"Accommodation is included in the private package");
    const stale = await snapshot();
    await db.exec("update reservations set start_datetime=now()-interval '1 hour',end_datetime=now()+interval '7 hours',checked_in_at=now(),updated_at=clock_timestamp()");
    await assert.rejects(() => db.query("select edit_guest_reservation_bill($1,$2,$3,$4)",[booking,guest,stale,{...guestPatch,unitId:unit}]), /changed/);
    await assert.rejects(async () => db.query("select edit_guest_reservation_bill($1,$2,$3,$4)",[booking,guest,await snapshot(),{...guestPatch,unitId:unit}]), /before check-in/);
    const r = await one("select * from reservations");
    const patch = {bookingMode:"day",startDatetime:r.start_datetime,endDatetime:r.end_datetime,adultCount:20,childCount:0,unitId:unit,
      specialRequests:"",services:[{serviceId:service,quantity:1,price:100}],reason:"Unused tables returned",packageDelta:0,expectedTotal:8400};
    await db.query("select edit_staff_reservation($1,$2,$3,$4)",[booking,manager,await snapshot(),patch]);
    assert.equal((await one("select quantity from reservation_services")).quantity,1);
    assert.equal(Number((await one("select total_amount from invoices")).total_amount),8400);
    assert.equal(Number((await one("select paid_amount from transactions")).paid_amount),8500);
    assert.equal(Number((await one("select transaction_total_at_time from receipts")).transaction_total_at_time),8600);
    await db.exec("update staff_users set role='cashier'");
    await assert.rejects(async () => db.query("select edit_staff_reservation($1,$2,$3,$4)",[booking,manager,await snapshot(),{...patch,services:[],expectedTotal:8300}]), /cannot be removed/);
    await db.exec("update staff_users set role='staff'");
    await db.query("select edit_staff_reservation($1,$2,$3,$4)",[booking,manager,await snapshot(),{...patch,services:[],expectedTotal:8300}]);
    assert.equal((await one("select count(*)::int n from reservation_services")).n,0);
    await db.exec("update reservations set checked_out_at=now()");
    await assert.rejects(async () => db.query("select edit_staff_reservation($1,$2,$3,$4)",[booking,manager,await snapshot(),{...patch,services:[],expectedTotal:8300}]), /no longer editable/);
  } finally { await db.close(); }
});
