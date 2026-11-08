import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("customer names enrich existing and future booking notifications without changing read state or leaking another guest", async () => {
  const db = new PGlite();
  const guest = "11111111-1111-4111-8111-111111111111", reservation = "22222222-2222-4222-8222-222222222222";
  const other = "33333333-3333-4333-8333-333333333333", payment = "44444444-4444-4444-8444-444444444444";
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table staff_users(id uuid,is_active boolean);
      create table guests(id uuid,first_name text,middle_name text,last_name text);
      create table walk_in_guests(walk_in_guest_id uuid,first_name text,middle_name text,last_name text);
      create table reservations(reservation_id uuid,guest_id uuid,walk_in_guest_id uuid,reference_number text);
      create table payments(payment_id uuid,reservation_id uuid);
      create table refund_requests(refund_id uuid,reservation_id uuid);
      create table reservation_reschedules(reschedule_id uuid,reservation_id uuid);
      create table transactions(transaction_id uuid,reservation_id uuid);
      create table invoices(invoice_id uuid,reservation_id uuid);
      create table receipts(receipt_id uuid,payment_id uuid);
      create table notifications(notification_id uuid default gen_random_uuid(),recipient_id uuid,recipient_role text,title text,message text,entity_type text,entity_id uuid,is_read boolean default false);
      insert into guests values('${guest}','Ana',null,'Santos');
      insert into walk_in_guests values('${other}','Juan','Dela','Cruz');
      insert into reservations values('${reservation}','${guest}',null,'SR-BOOK1234'),('${other}',null,'${other}','MV-WALK1234');
      insert into payments values('${payment}','${reservation}');
      insert into refund_requests values('${payment}','${reservation}');
      insert into notifications(recipient_role,title,message,entity_type,entity_id,is_read)
        values('staff','Booking SR-BOOK1234','Reservation SR-BOOK1234 is pending.','reservation','${reservation}',true);
    `);
    const migration = readFileSync("docs/notification-customer-names-migration.sql", "utf8");
    await db.exec(migration);
    let row = (await db.query("select * from notifications")).rows[0];
    assert.equal(row.title, "Booking Ana Santos (SR-BOOK1234)");
    assert.equal(row.message, "Reservation Ana Santos (SR-BOOK1234) is pending.");
    assert.equal(row.is_read, true); assert.equal(row.recipient_role, "staff");
    await db.exec(migration);
    assert.equal((await db.query("select message from notifications")).rows[0].message, row.message);
    for (const type of ["payment", "refund_request"]) {
      await db.query("insert into notifications(title,entity_type,entity_id) values('Update',$1,$2)", [type,payment]);
    }
    await db.exec(`insert into notifications(title,entity_type,entity_id) values('Walk-in update','reservation','${other}');
      insert into notifications(title,message) values('Legacy booking','SR-BOOK1234 confirmed');
      insert into notifications(title,message) values('Maintenance','Pool closed');`);
    const messages = (await db.query("select message from notifications")).rows.map(row => row.message);
    assert.equal(messages.filter(value => value === "Ana Santos (SR-BOOK1234)").length, 2);
    assert.ok(messages.includes("Juan Dela Cruz (MV-WALK1234)"));
    assert.ok(messages.includes("Ana Santos (SR-BOOK1234) confirmed"));
    assert.ok(messages.includes("Pool closed"));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    await db.query("insert into notifications(title,entity_type,entity_id) values('Forged','reservation',$1)", [reservation]);
    row = (await db.query("select message from notifications where title='Forged'")).rows[0];
    assert.equal(row.message, null);
  } finally { await db.close(); }
});
