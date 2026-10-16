import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const migration = readFileSync("docs/payment-review-and-notifications-migration.sql", "utf8");
const admin="11111111-1111-4111-8111-111111111111", manager="22222222-2222-4222-8222-222222222222", reservation="33333333-3333-4333-8333-333333333333", payment="44444444-4444-4444-8444-444444444444", method="55555555-5555-4555-8555-555555555555", session="66666666-6666-4666-8666-666666666666";
let db;
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const actor=async(id=manager,sid=session)=>db.query("select set_config('fixture.actor',$1,false),set_config('fixture.session',$2,false)",[id,sid]);
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('fixture.actor',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('session_id',current_setting('fixture.session',true))$$;
 create table staff_users(id uuid primary key,role text,is_active boolean,active_session_id uuid);
 create table role_permissions(role text primary key,permissions text[]);
 create table payment_methods(payment_method_id uuid primary key,type text);
 create table reservations(reservation_id uuid primary key,status text);
 create table transactions(reservation_id uuid,total_amount numeric,paid_amount numeric);
 create table refund_requests(reservation_id uuid,amount numeric,status text);
 create table payments(payment_id uuid primary key,reservation_id uuid,payment_method_id uuid,status text,amount numeric,reference_number text,verified_by uuid,verified_at timestamptz,rejected_by uuid,rejected_at timestamptz);
 create table audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
 create table notifications(recipient_role text,recipient_id uuid,actor_id uuid,title text,message text,action_url text,entity_type text,entity_id uuid);
 create function public.refresh_reservation_payment_totals(p_reservation uuid) returns void language sql as $$
   update public.transactions set paid_amount=greatest(coalesce((select sum(amount) from public.payments where reservation_id=p_reservation and status='verified'),0)
     -coalesce((select sum(amount) from public.refund_requests where reservation_id=p_reservation and status='refunded'),0),0) where reservation_id=p_reservation;
 $$;
 grant select,update(status) on payments to authenticated;
 alter table payments enable row level security; create policy read_payments on payments for select to authenticated using(true);`);
 await db.exec(migration);await db.exec(migration);
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec("reset role;truncate notifications,audit_logs,payments,reservations,payment_methods,role_permissions,staff_users,transactions,refund_requests");
 await db.query("insert into staff_users values($1,'admin',true,$3),($2,'staff',true,$3)",[admin,manager,session]);
 await db.exec("insert into role_permissions values('staff',array['reservations','payment_approval'])");
 await db.query("insert into payment_methods values($1,'ewallet');",[method]);
 await db.query("insert into reservations values($1,'payment_submitted')",[reservation]);
 await db.query("insert into payments(payment_id,reservation_id,payment_method_id,status,amount,reference_number) values($1,$2,$3,'pending',100,'REF-100')",[payment,reservation,method]);
 await actor();
});
const reject = reason => db.query("update payments set status='rejected',rejection_reason=$1 where payment_id=$2",[reason,payment]);
const code=n=>error=>error.code===n;
test("managers with the configured permission can reject with a recorded reason, reviewer and atomic audit",async()=>{
 await db.exec("set role authenticated");try{await reject("  Recipient does not match  ");}finally{await db.exec("reset role");}
 const row=await one("select * from payments");assert.equal(row.status,"rejected");assert.equal(row.rejection_reason,"Recipient does not match");assert.equal(row.rejected_by,manager);assert.ok(row.rejected_at);
 assert.equal((await one("select status from reservations")).status,"rejected");
 assert.equal((await one("select details from audit_logs")).details.rejection_reason,"Recipient does not match");
 await assert.rejects(()=>reject("Changed after the decision"),code("23514"));
});
test("missing, whitespace, short and excessive reasons cannot reject a payment or change its reservation",async()=>{
 for(const reason of [null,"  ","bad","x".repeat(2001)]) await assert.rejects(()=>reject(reason),code("22023"));
 assert.equal((await one("select status from payments")).status,"pending");assert.equal((await one("select count(*)::int n from audit_logs")).n,0);
});
test("permission revocation, deactivation and replaced sessions cannot review payments",async()=>{
 for(const setup of ["update role_permissions set permissions='{}'","update staff_users set is_active=false","update staff_users set active_session_id=gen_random_uuid()"]){
  await db.exec(setup);assert.equal((await one("select public.can_review_payment($1) ok",[method])).ok,false);
  await assert.rejects(()=>reject("Receipt does not match"),code("42501"));
  await db.exec("update role_permissions set permissions=array['payment_approval'];update staff_users set is_active=true");await db.query("update staff_users set active_session_id=$1",[session]);
 }
});
test("cash-entry grants only verify cash; they do not authorize GCash review or cash rejection",async()=>{
 await db.exec("update role_permissions set permissions=array['payment_entry']");await assert.rejects(()=>reject("Incorrect proof received"),code("42501"));
 await db.exec("update payment_methods set type='cash'");await assert.rejects(()=>reject("Incorrect proof received"),code("42501"));
 await db.exec("update payments set status='verified'");assert.equal((await one("select verified_by from payments")).verified_by,manager);
 assert.equal((await one("select status from reservations")).status,"confirmed");
});
test("an audit failure rolls back the payment decision and rejected payments cannot be re-reviewed",async()=>{
 await db.exec("create function fail_review_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable';end$$;create trigger fail_review_audit before insert on audit_logs for each row execute function fail_review_audit()");
 try{await assert.rejects(()=>reject("Receipt amount is incorrect"),/audit unavailable/);}finally{await db.exec("drop trigger fail_review_audit on audit_logs");}
 assert.equal((await one("select status from payments")).status,"pending");assert.equal((await one("select status from reservations")).status,"payment_submitted");
 await reject("Receipt amount is incorrect");await assert.rejects(()=>db.exec("update payments set status='verified'"),code("23514"));
});
test("refund completion creates readable titles for guests and staff and repairs the previous wording",async()=>{
 await db.query("select public.notify_refund_workflow($1,'Refund refunded','Transfer verified','refund_request',$2)",[reservation,payment]);
 assert.deepEqual((await db.query("select title from notifications")).rows.map(r=>r.title),["Refund completed","Refund completed"]);
 await db.exec("insert into notifications(title) values('Refund refunded');");await db.exec(migration);
 assert.equal((await one("select count(*)::int n from notifications where title='Refund refunded'")).n,0);
});
test("approving another payment preserves completed refunds in net paid totals and later rejection leaves a confirmed booking active",async()=>{
 await db.query("insert into transactions values($1,500,0);",[reservation]);
 await db.query("insert into refund_requests values($1,50,'refunded')",[reservation]);
 await db.query("insert into payments(payment_id,reservation_id,payment_method_id,status,amount,reference_number) values(gen_random_uuid(),$1,$2,'verified',300,'PREVIOUS')",[reservation,method]);
 await db.query("update payments set status='verified' where payment_id=$1",[payment]);
 assert.equal(Number((await one("select paid_amount from transactions")).paid_amount),350);
 await db.query("insert into payments(payment_id,reservation_id,payment_method_id,status,amount,reference_number) values(gen_random_uuid(),$1,$2,'pending',150,'BALANCE')",[reservation,method]);
 await db.exec("update payments set status='rejected',rejection_reason='Receipt does not match' where reference_number='BALANCE'");
 assert.equal((await one("select status from reservations")).status,"confirmed");assert.equal(Number((await one("select paid_amount from transactions")).paid_amount),350);
});
