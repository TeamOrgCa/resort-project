import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
let db;
const guest="11111111-1111-4111-8111-111111111111", other="33333333-3333-4333-8333-333333333333";
const admin="44444444-4444-4444-8444-444444444444", cashier="55555555-5555-4555-8555-555555555555";
const manager="66666666-6666-4666-8666-666666666666", reservation="22222222-2222-4222-8222-222222222222";
const actor=id=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??""]);
const row=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const denied=e=>e.code==="42501";
const migration=readFileSync("docs/admin-read-only-manager-refunds-migration.sql","utf8");
before(async()=>{db=new PGlite();await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.guests(id uuid primary key);
    create table public.staff_users(id uuid primary key,role text,is_active boolean);
    create table public.role_permissions(role text primary key,permissions text[]);
    create table public.booking_policy_versions(version bigint primary key,cancellation_text text,refund_text text,refund_review_enabled boolean,guest_cancellation_notice_hours integer);
    create table public.reservations(reservation_id uuid primary key,guest_id uuid references public.guests,reference_number text,status text,start_datetime timestamptz,
      end_datetime timestamptz,checked_in_at timestamptz,booking_policy_version bigint,payment_deadline_at timestamptz,cancelled_at timestamptz,cancellation_reason text,created_at timestamptz default now());
    create table public.transactions(reservation_id uuid primary key references public.reservations,total_amount numeric(10,2),paid_amount numeric(10,2) default 0,status text,
      balance numeric generated always as (greatest(total_amount-paid_amount,0)) stored,overpaid_amount numeric generated always as (greatest(paid_amount-total_amount,0)) stored);
    create table public.payments(payment_id uuid primary key default gen_random_uuid(),reservation_id uuid references public.reservations,amount numeric,status text,verified_at timestamptz default now(),created_at timestamptz default now());
    create table public.receipts(receipt_id uuid primary key default gen_random_uuid(),payment_id uuid references public.payments,transaction_total_at_time numeric,issued_at timestamptz default now());
    create table public.payment_methods(payment_method_id uuid primary key default gen_random_uuid(),name text,is_active boolean);
    insert into public.payment_methods(name,is_active) values('GCash',true),('Bank transfer',true),('Inactive wallet',false);
    create table public.refund_requests(refund_id uuid primary key default gen_random_uuid(),reservation_id uuid unique references public.reservations,guest_id uuid,
      amount numeric(10,2) check(amount>0),policy_snapshot text,policy_version bigint,status text default 'pending' check(status in ('pending','approved','rejected','refunded')),
      requested_at timestamptz default now(),reviewed_by uuid,reviewed_at timestamptz,review_reason text,refunded_by uuid,refunded_at timestamptz,gcash_reference text,proof_path text,
      check(status<>'refunded' or (gcash_reference is not null and proof_path is not null and refunded_at is not null)));
    create table public.invoices(reservation_id uuid references public.reservations,status text);
    create table public.reservation_reschedules(reservation_id uuid references public.reservations,status text);
    create table public.audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
    create table public.reservation_status_logs(reservation_id uuid references public.reservations,old_status text,new_status text,changed_by uuid references public.staff_users);
    create table public.notifications(recipient_role text,recipient_id uuid,actor_id uuid,title text,message text,action_url text,entity_type text,entity_id uuid);
    create table storage.objects(bucket_id text,name text);
    create function public.update_transaction_paid_amount() returns trigger language plpgsql as $$begin return null;end$$;
    create trigger update_paid after insert or update or delete on public.payments for each row execute function public.update_transaction_paid_amount();
    insert into public.guests values('${guest}'),('${other}');
    insert into public.staff_users values('${admin}','admin',true),('${cashier}','cashier',true);
    insert into public.role_permissions values('cashier',array['transactions','payment_approval']);
    insert into public.booking_policy_versions values(1,'Cancellation policy','Downpayment non-refundable',true,48);
  
 create table public.maintenance_blocks(block_id uuid primary key default gen_random_uuid(),name text,reason text,start_date date,end_date date,status text default 'active',created_by uuid,released_by uuid,released_at timestamptz);
 create function public.expire_unpaid_reservations() returns void language sql as $$select$$;
 create table public.units(name text);
 create table public.business_settings(name text);
 insert into public.staff_users values('${manager}','staff',true);
 insert into public.role_permissions values('staff',array['reservations','cancel_reservation','edit_reservation','refund_review','refund_payout','refund_verify']);
 `);
 await db.exec(readFileSync("docs/overpayment-refunds-migration.sql","utf8"));
 await db.exec(readFileSync("docs/cancellation-refund-workflow-migration.sql","utf8"));
 await db.exec(migration);
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
 await actor(null);await db.exec("truncate public.reservations,public.audit_logs,public.notifications,storage.objects,public.maintenance_blocks cascade;");
 await db.query("insert into public.reservations(reservation_id,guest_id,reference_number,status,start_datetime,end_datetime,booking_policy_version) values($1,$2,'MV-TEST','confirmed',now()+interval '10 days',now()+interval '11 days',1)",[reservation,guest]);
 await db.query("insert into public.transactions(reservation_id,total_amount) values($1,3000)",[reservation]);
 await db.query("insert into public.payments(reservation_id,amount,status) values($1,3000,'verified')",[reservation]);
});
const refund=async()=>{
 await actor(guest);
 const {data:q}=await row("select public.get_cancellation_preview($1,'guest') data",[reservation]);
 return (await row("select public.cancel_reservation_evaluated($1,'Family plans changed','guest',$2) data",[reservation,q.quote])).data.refundId;
};
const transition=(id,action,verified=false,proof=null)=>db.query("select public.transition_refund_workflow($1,$2,'Verified provider records','1234567890123',$3,'GCash',$4)",[id,action,proof,verified]);
test("admin can browse operations but cannot insert, update, delete or use cancellation RPCs",async()=>{
 await actor(admin);
 assert.equal((await row("select count(*)::int n from public.reservations where status='confirmed'")).n,1);
 for(const sql of ["update public.reservations set status='cancelled'", "delete from public.payments", "insert into public.payments(reservation_id,amount,status) select reservation_id,1,'verified' from public.reservations"])
  await assert.rejects(db.exec(sql),denied);
 await assert.rejects(db.query("select public.get_cancellation_preview($1,'resort')",[reservation]),denied);
 assert.equal((await row("select status from public.reservations")).status,'confirmed');
 assert.equal((await row("select paid_amount from public.transactions")).paid_amount,'3000.00');
 await db.exec("insert into public.units values('New catalog unit');insert into public.business_settings values('Resort configuration');");
});
test("only a manager can approve refunds, even when a cashier grant is forged",async()=>{
 const id=await refund();await actor(cashier);await transition(id,'reviewed',true);
 await db.exec("update public.role_permissions set permissions=array_append(permissions,'refund_approval') where role='cashier'");
 await assert.rejects(transition(id,'approved'),denied);
 await actor(admin);await assert.rejects(transition(id,'approved'),denied);
 await actor(manager);await transition(id,'approved');
 assert.equal((await row("select reviewed_by from public.refund_requests")).reviewed_by,manager);
 assert.equal((await row("select paid_amount from public.transactions")).paid_amount,'3000.00');
});
test("manager approval preserves calculation and requires a separate payout verifier",async()=>{
 const id=await refund();await actor(cashier);await transition(id,'reviewed',true);
 await actor(manager);await transition(id,'approved');const path=id+'/proof.png';
 await db.query("insert into storage.objects values('refund-proofs',$1)",[path]);await transition(id,'payout_submitted',false,path);
 await assert.rejects(transition(id,'refunded',true),denied);
 await actor(cashier);await transition(id,'refunded',true);
 assert.equal((await row("select amount,status from public.refund_requests")).amount,'2400.00');
 assert.equal((await row("select paid_amount from public.transactions")).paid_amount,'600.00');
});
test("manager maintains blocked dates and may select resort-attributable cancellation",async()=>{
 await actor(admin);await assert.rejects(db.exec("select public.create_maintenance_block('Repairs','Pool repairs',current_date+20,current_date+21)"),denied);
 await actor(manager);const {data}=await row("select public.get_cancellation_preview($1,'resort') data",[reservation]);assert.equal(data.refundableAmount,3000);
 const {id}=await row("select public.create_maintenance_block('Repairs','Pool repairs',current_date+20,current_date+21) id");
 await db.query("select public.release_maintenance_block($1)",[id]);
 assert.equal((await row("select status from public.maintenance_blocks")).status,'released');
});
test("admin operational proof writes are denied while configuration assets remain writable",async()=>{
 await actor(null);await db.exec("insert into storage.objects values('refund-proofs','existing.png')");
 await actor(admin);
 await assert.rejects(db.exec("insert into storage.objects values('payment-proofs','new.png')"),denied);
 await assert.rejects(db.exec("update storage.objects set bucket_id='site-content'"),denied);
 await assert.rejects(db.exec("delete from storage.objects"),denied);
 await db.exec("insert into storage.objects values('site-content','hero.png'),('payment-qr-codes','catalog.png')");
});
test("migration can be reapplied and preserves existing manager grants",async()=>{
 await actor(null);await db.exec(migration);
 const {permissions}=await row("select permissions from public.role_permissions where role='staff'");
 for(const p of ['edit_reservation','cancel_reservation','transactions','refund_approval'])assert.ok(permissions.includes(p));
 assert.equal((await row("select count(*)::int n from public.reservations")).n,1);
});

test("a manager with approval and transaction access receives alerts and can read payout evidence", async () => {
 await actor(null);
 const {permissions}=await row("select permissions from public.role_permissions where role='staff'");
 try {
  await db.exec("update public.role_permissions set permissions=array['transactions','refund_approval'] where role='staff';insert into storage.objects values('refund-proofs','review.png');grant usage on schema storage,auth to authenticated;grant select on public.staff_users,public.role_permissions,storage.objects to authenticated;alter table storage.objects enable row level security;");
  await actor(guest);
  await db.query("select public.notify_refund_workflow($1,'Refund reviewed','Ready for manager approval','refund_request',$2)",[guest,reservation]);
  assert.equal((await row("select count(*)::int n from public.notifications where recipient_id=$1",[manager])).n,1);
  await actor(manager);await db.exec("set role authenticated");
  assert.equal((await row("select count(*)::int n from storage.objects where bucket_id='refund-proofs'")).n,1);
 } finally {
  await db.exec("reset role;alter table storage.objects disable row level security;");await actor(null);
  await db.query("update public.role_permissions set permissions=$1 where role='staff'",[permissions]);
 }
});
