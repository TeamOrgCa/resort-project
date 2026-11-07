import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
let db;
const guest="11111111-1111-4111-8111-111111111111", other="33333333-3333-4333-8333-333333333333";
const admin="44444444-4444-4444-8444-444444444444", cashier="55555555-5555-4555-8555-555555555555";
const reservation="22222222-2222-4222-8222-222222222222", method="66666666-6666-4666-8666-666666666666";
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const actor=(id=null,role="service_role")=>db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('fixture.role',$2,false)",[id??"",role]);
const migration=readFileSync("docs/ocr-auto-approve-payments-migration.sql","utf8");
const code=n=>error=>error.code===n;
before(async()=>{db=new PGlite();await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.guests(id uuid primary key);
    create table public.staff_users(id uuid primary key, role text, is_active boolean);
    create table public.role_permissions(role text primary key, permissions text[]);
    create table public.booking_policy_versions(version bigint primary key, cancellation_text text, refund_text text,
      refund_review_enabled boolean, guest_cancellation_notice_hours integer);
    create table public.reservations(reservation_id uuid primary key, guest_id uuid references public.guests,
      reference_number text, status text, start_datetime timestamptz, end_datetime timestamptz,
      booking_policy_version bigint references public.booking_policy_versions, payment_deadline_at timestamptz,
      cancelled_at timestamptz, cancellation_reason text, created_at timestamptz default now());
    create table public.transactions(reservation_id uuid primary key references public.reservations,
      total_amount numeric(10,2), paid_amount numeric(10,2) default 0, status text default 'unpaid',
      balance numeric(10,2) generated always as (greatest(total_amount - paid_amount, 0)) stored,
      overpaid_amount numeric(10,2) generated always as (greatest(paid_amount - total_amount, 0)) stored);
    create table public.payment_methods(payment_method_id uuid primary key, name text, type text, is_active boolean);
    create table public.payments(payment_id uuid primary key default gen_random_uuid(), reservation_id uuid references public.reservations,
      amount numeric(10,2), status text, payment_type text, reference_number text unique,
      payment_method_id uuid references public.payment_methods, ocr_status text, ocr_checked_at timestamptz);
    create function public.update_transaction_paid_amount() returns trigger language plpgsql as $$ begin return null; end $$;
    create trigger trigger_update_transaction after insert or update or delete on public.payments
      for each row execute function public.update_transaction_paid_amount();
    create table public.refund_requests(refund_id uuid primary key default gen_random_uuid(), reservation_id uuid not null unique references public.reservations,
      guest_id uuid references public.guests, amount numeric(10,2) not null check(amount > 0), policy_snapshot text not null,
      policy_version bigint references public.booking_policy_versions, status text default 'pending', requested_at timestamptz default now(),
      reviewed_by uuid references public.staff_users, reviewed_at timestamptz, review_reason text,
      refunded_by uuid references public.staff_users, refunded_at timestamptz, gcash_reference text, proof_path text);
    create table public.audit_logs(user_id uuid references public.staff_users, auth_user_id uuid, action text, entity_type text, entity_id uuid, details jsonb);
    create table public.invoices(reservation_id uuid references public.reservations, status text);
    create table public.reservation_reschedules(reservation_id uuid references public.reservations, status text);
    insert into public.guests values ('${guest}'), ('${other}');
    insert into public.staff_users values ('${admin}', 'admin', true), ('${cashier}', 'cashier', true);
    insert into public.role_permissions values ('cashier', array['payment_approval']);
    insert into public.booking_policy_versions values (1, 'Cancellation policy', 'Refund policy', true, 48);
    insert into public.payment_methods values ('${method}', 'GCash', 'ewallet', true);
  
  alter table guests add column is_active boolean default true,add column first_name text,add column last_name text;
  alter table staff_users add column active_session_id uuid;
  alter table reservations add column walk_in_guest_id uuid;
  alter table payments add column verified_by uuid,add column verified_at timestamptz,add column rejected_by uuid,add column rejected_at timestamptz,
    add column account_name text,add column account_number text,add column proof_path text,add column ocr_notes text;
  create table walk_in_guests(walk_in_guest_id uuid primary key,first_name text,last_name text);
  create table receipts(receipt_id uuid primary key default gen_random_uuid(),payment_id uuid unique references payments,
    receipt_number text,amount_paid numeric,transaction_total_at_time numeric,balance_after_payment numeric,billed_to_name text);
  create table notifications(recipient_role text,recipient_id uuid,actor_id uuid,title text,message text,action_url text,entity_type text,entity_id uuid);
  create function auth.role() returns text language sql as $$select current_setting('fixture.role',true)$$;
  create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('session_id','77777777-7777-4777-8777-777777777777')$$;
 `);
 await db.exec(readFileSync("docs/gcash-payment-validation-migration.sql","utf8"));
 await db.exec(readFileSync("docs/overpayment-refunds-migration.sql","utf8"));
 await db.exec(readFileSync("docs/payment-review-and-notifications-migration.sql","utf8"));
 const schema=readFileSync("updated-schema.sql","utf8"), start=schema.lastIndexOf('create or replace function public.create_receipt_on_payment('), end=schema.indexOf('end $$;',start)+8;
 await db.exec(schema.slice(start,end));
 await db.exec("create trigger trigger_create_receipt after update of status on payments for each row execute function public.create_receipt_on_payment()");
 await db.exec(migration);await db.exec(migration);
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec("reset role;truncate public.reservations,public.audit_logs cascade;update guests set is_active=true");await actor();
 await db.query("insert into reservations(reservation_id,guest_id,reference_number,status,payment_deadline_at) values($1,$2,'MV-OCR','pending',now()+interval '30 minutes')",[reservation,guest]);
 await db.query("insert into transactions(reservation_id,total_amount) values($1,3000)",[reservation]);
});
const payload=(overrides={})=>({reservation_id:reservation,amount:600,payment_method_id:method,payment_type:'downpayment',reference_number:'1234567890123',
 receipt_paid_at:new Date().toISOString(),ocr_checked_at:new Date().toISOString(),ocr_status:'consistent',ocr_notes:'All receipt fields matched',account_name:'Test Guest',proof_path:guest+'/proof.png',...overrides});
const submit=(overrides={})=>one("select public.submit_consistent_gcash_payment($1::jsonb) result",[JSON.stringify(payload(overrides))]).then(r=>r.result);
test("a consistent receipt is verified atomically, confirms the booking and creates a receipt and explicit automatic audit",async()=>{
 const result=await submit();assert.equal(result.status,'verified');assert.equal(result.auto_approved,true);assert.equal(result.paid_amount,600);assert.equal(result.remaining_balance,2400);
 const payment=await one("select * from payments");assert.equal(payment.auto_approved,true);assert.equal(payment.verified_by,null);assert.ok(payment.verified_at);
 assert.equal((await one("select status from reservations")).status,'confirmed');
 const receipt=await one("select * from receipts");assert.equal(Number(receipt.amount_paid),600);assert.equal(Number(receipt.balance_after_payment),2400);
 const audit=await one("select * from audit_logs");assert.equal(audit.user_id,null);assert.equal(audit.details.automatic_approval,true);assert.equal(audit.details.approval_source,'consistent_gcash_ocr');
});
test("non-consistent, incomplete, expired, duplicate and other-owner receipts cannot auto approve",async()=>{
 for(const status of ['mismatch','unreadable','not_applicable'])await assert.rejects(submit({ocr_status:status}),code('22023'));
 await assert.rejects(submit({receipt_paid_at:null}),code('22023'));
 await assert.rejects(submit({proof_path:other+'/proof.png'}),code('42501'));
 await assert.rejects(submit({amount:599}),code('40001'));
 await assert.rejects(submit({receipt_paid_at:new Date(Date.now()-86400000).toISOString()}),code('22023'));
 await db.exec("update reservations set payment_deadline_at=now()-interval '1 minute'");
 await assert.rejects(submit(),code('P0001'));
 await db.exec("update reservations set payment_deadline_at=now()+interval '30 minutes'");
 assert.equal((await one("select count(*)::int n from payments")).n,0);
 await submit();await assert.rejects(submit({reference_number:'1234567890123',payment_type:'full',amount:2400}),code('23505'));
 await db.exec("truncate reservations cascade");
});
test("guests cannot call the server RPC or forge the automatic approval marker",async()=>{
 await actor(guest,'authenticated');await assert.rejects(submit(),code('42501'));
 await db.exec("set role authenticated");try{await assert.rejects(submit(),code('42501'));}finally{await db.exec('reset role');}
 await actor();await db.query("insert into payments(reservation_id,amount,status,payment_type,payment_method_id,reference_number,ocr_status) values($1,600,'pending','downpayment',$2,'MANUAL','consistent')",[reservation,method]);
 await actor(guest,'authenticated');
 await assert.rejects(db.exec("update payments set status='verified',auto_approved=true"),code('42501'));
 assert.equal((await one("select status from payments")).status,'pending');
});
test("a billing or audit failure rolls back the entire auto approval instead of leaving a pending payment",async()=>{
 await db.exec("create function fail_auto_audit() returns trigger language plpgsql as $$begin raise exception 'Audit unavailable';end$$;create trigger fail_auto_audit before insert on audit_logs for each row execute function fail_auto_audit()");
 try{await assert.rejects(submit(),/Audit unavailable/);}finally{await db.exec('drop trigger fail_auto_audit on audit_logs');}
 assert.equal((await one("select count(*)::int n from payments")).n,0);assert.equal((await one("select count(*)::int n from receipts")).n,0);
 assert.equal((await one("select status from reservations")).status,'pending');assert.equal(Number((await one("select paid_amount from transactions")).paid_amount),0);
});
test("verified overpayments expose the exact excess but do not automatically create a refund request",async()=>{
 const result=await submit({payment_type:'full',amount:3500});assert.equal(result.overpaid_amount,500);assert.equal(result.remaining_balance,0);
 assert.equal((await one("select count(*)::int n from refund_requests")).n,0);
 await actor(guest,'authenticated');await db.query("select public.request_overpayment_refund($1)",[reservation]);
 const refund=await one("select * from refund_requests");assert.equal(Number(refund.amount),500);assert.equal(refund.status,'pending');assert.equal(refund.request_kind,'overpayment');
});
test("migration preserves historical pending payments for manual review",async()=>{
 await db.query("insert into payments(reservation_id,amount,status,payment_type,payment_method_id,reference_number,ocr_status) values($1,600,'pending','downpayment',$2,'HISTORICAL','consistent')",[reservation,method]);
 await db.exec(migration);assert.equal((await one("select status from payments")).status,'pending');
});

test("manual staff approval still works for historical receipts without an automatic approval marker", async () => {
 await db.exec("update reservations set status='payment_submitted'");
 await db.query("insert into payments(reservation_id,amount,status,payment_type,payment_method_id,reference_number,ocr_status) values($1,600,'pending','downpayment',$2,'MANUAL','consistent')",[reservation,method]);
 await db.exec("update staff_users set active_session_id='77777777-7777-4777-8777-777777777777'");
 await actor(cashier,'authenticated');await db.exec("update payments set status='verified'");
 const payment=await one("select * from payments");assert.equal(payment.verified_by,cashier);assert.equal(payment.auto_approved,false);
 assert.equal((await one("select details from audit_logs")).details.approval_source,'staff');
});
