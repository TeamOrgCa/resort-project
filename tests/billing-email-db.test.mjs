import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
let db;
const id="11111111-1111-4111-8111-111111111111";
before(async()=>{
  db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('fixture.uid',true),'')::uuid$$;
    create function auth.role() returns text language sql as $$select nullif(current_setting('fixture.role',true),'')$$;
    create table staff_users(id uuid,role text,is_active boolean);
    create table role_permissions(role text,permissions text[]);
    create table business_settings(setting_key text,setting_value jsonb);
    create table receipts(receipt_id uuid,email_sent boolean,email_sent_at timestamptz,email_error text);
    create table invoices(invoice_id uuid,email_sent boolean,email_sent_at timestamptz,email_error text);
    insert into staff_users values('${id}','cashier',true);insert into invoices values('${id}',true,now(),null);`);
  await db.exec(readFileSync("docs/billing-pdf-email-migration.sql","utf8"));
});
after(async()=>db?.close());
const actor=(role,uid="")=>db.query("select set_config('fixture.role',$1,false),set_config('fixture.uid',$2,false)",[role,uid]);
test("server OCR approval and cashiers can send billing emails while guests are denied",async()=>{
  await actor("service_role");assert.equal((await db.query("select billing_email_enabled() as enabled")).rows[0].enabled,true);
  await actor("authenticated",id);assert.equal((await db.query("select billing_email_enabled() as enabled")).rows[0].enabled,true);
  await actor("authenticated","22222222-2222-4222-8222-222222222222");await assert.rejects(db.query("select billing_email_enabled()"),/Not authorized/);
  await actor("");await assert.rejects(db.query("select billing_email_enabled()"),/Not authorized/);
});
test("an updated invoice's failed delivery clears the old sent marker for retry",async()=>{
  await actor("service_role");await db.query("select record_billing_email_delivery('invoice',$1,false,'SMTP unavailable')",[id]);
  const row=(await db.query("select * from invoices")).rows[0];assert.equal(row.email_sent,false);assert.equal(row.email_error,"SMTP unavailable");
  await db.query("select record_billing_email_delivery('invoice',$1,true,null)",[id]);assert.equal((await db.query("select email_sent from invoices")).rows[0].email_sent,true);
});
test("manager billing access follows payment permissions and requires an active account",async()=>{
  const manager="33333333-3333-4333-8333-333333333333";
  await db.query("insert into staff_users values($1,'staff',true)",[manager]);
  await db.query("insert into role_permissions values('staff',array['transactions'])");
  await actor("authenticated",manager);
  await assert.rejects(db.query("select billing_email_enabled()"),/Not authorized/);
  for (const permission of ['payment_entry','payment_approval']) {
    await db.query("update role_permissions set permissions=array[$1] where role='staff'",[permission]);
    assert.equal((await db.query("select billing_email_enabled() as enabled")).rows[0].enabled,true);
    await db.query("select record_billing_email_delivery('invoice',$1,true,null)",[id]);
  }
  await db.query("update staff_users set is_active=false where id=$1",[manager]);
  await assert.rejects(db.query("select billing_email_enabled()"),/Not authorized/);
  await assert.rejects(db.query("select record_billing_email_delivery('invoice',$1,true,null)",[id]),/Not authorized/);
});
