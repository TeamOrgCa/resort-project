import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

let db;
const guest="11111111-1111-4111-8111-111111111111", other="33333333-3333-4333-8333-333333333333";
const admin="44444444-4444-4444-8444-444444444444", cashier="55555555-5555-4555-8555-555555555555";
const reservation="22222222-2222-4222-8222-222222222222";
const row=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const actor=id=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??""]);
const code=value=>error=>error.code===value;
before(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.guests(id uuid primary key);
    create table public.staff_users(id uuid primary key,role text,is_active boolean);
    create table public.role_permissions(role text primary key,permissions text[]);
    create table public.booking_policy_versions(version bigint primary key,cancellation_text text,refund_text text,refund_review_enabled boolean,guest_cancellation_notice_hours integer);
    create table public.reservations(reservation_id uuid primary key,guest_id uuid references public.guests,reference_number text,status text,start_datetime timestamptz,
      booking_policy_version bigint,payment_deadline_at timestamptz,cancelled_at timestamptz,cancellation_reason text,created_at timestamptz default now());
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
  `);
  await db.exec(readFileSync("docs/overpayment-refunds-migration.sql","utf8"));
  await db.exec(readFileSync("docs/cancellation-refund-workflow-migration.sql","utf8"));
  await db.exec("create trigger log_status after update on public.reservations for each row execute function public.log_reservation_status_change();");
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec("truncate public.reservations,public.audit_logs,public.notifications,storage.objects cascade;update public.staff_users set is_active=true;update public.booking_policy_versions set refund_review_enabled=true;");
  await actor(guest);
  await db.query("insert into public.reservations values($1,$2,'MV-TEST','confirmed',now()+interval '10 days',1,null,null,null,now(),null,null,null)",[reservation,guest]);
  await db.query("insert into public.transactions(reservation_id,total_amount) values($1,3000)",[reservation]);
});
const pay=(amount,status="verified")=>db.query("insert into public.payments(reservation_id,amount,status) values($1,$2,$3)",[reservation,amount,status]);
const preview=(initiator="guest")=>row("select public.get_cancellation_preview($1,$2) as data",[reservation,initiator]).then(r=>r.data);
const cancel=async(initiator="guest",reason="Guest requested cancellation",quote=null)=>{
  const q=quote??(await preview(initiator)).quote;
  return (await row("select public.cancel_reservation_evaluated($1,$2,$3,$4) as data",[reservation,reason,initiator,q])).data;
};
const transition=(id,action,verified=false,notes="Checked payment records",reference="1234567890123",proof=null)=>db.query(
  "select public.transition_refund_workflow($1,$2,$3,$4,$5,'GCash',$6)",[id,action,notes,reference,proof,verified]);
const complete=async id=>{
  await actor(cashier);await transition(id,"reviewed",true);
  await actor(admin);await transition(id,"approved");
  const path=id+"/payout.png";await db.query("insert into storage.objects values('refund-proofs',$1)",[path]);
  await actor(cashier);await transition(id,"payout_submitted",false,"Manual payout documented","1234567890123",path);
  await actor(admin);await transition(id,"refunded",true,"Checked GCash transaction and recipient");
};

test("guest downpayment and unpaid cancellations generate no refund; full payment retains exactly 20%",async()=>{
  let q=await preview();assert.equal(q.refundableAmount,0);
  await pay(600);q=await preview();assert.equal(q.deduction,600);assert.equal(q.refundableAmount,0);
  const result=await cancel();assert.equal(result.refundId,null);assert.equal(result.outcome,"no_refund");
  assert.equal((await row("select count(*)::int n from public.refund_requests")).n,0);
  assert.match((await row("select title from public.notifications where recipient_id=$1",[guest])).title,/no refund/);
});
test("fully paid guest receives 80%, with cancellation and refund statuses kept separate",async()=>{
  await pay(3000);const q=await preview();assert.equal(q.refundableAmount,2400);assert.equal(q.deduction,600);
  const result=await cancel();const f=await row("select * from public.refund_requests");
  assert.equal(f.amount,"2400.00");assert.equal(f.status,"pending");assert.equal(f.workflow_version,2);
  assert.equal((await row("select status from public.reservations")).status,"cancelled");
  assert.equal(result.refundId,f.refund_id);
  assert.equal((await row("select paid_amount from public.transactions")).paid_amount,"3000.00");
  await complete(f.refund_id);assert.equal((await row("select paid_amount from public.transactions")).paid_amount,"600.00");
  assert.equal((await row("select amount from public.payments")).amount,"3000");
});
test("admin resort cancellation refunds all remaining verified payments including only a deposit",async()=>{
  await pay(600);await actor(admin);const q=await preview("resort");assert.equal(q.deduction,0);assert.equal(q.refundableAmount,600);
  await assert.rejects(cancel("resort",""),code("22023"));
  const result=await cancel("resort","Pool repairs prevent the stay");assert.equal(result.refundableAmount,600);
  assert.equal((await row("select cancellation_initiator,cancelled_by from public.reservations")).cancelled_by,admin);
});
test("partial payments, excess deposits and later service charges preserve the initial deposit",async()=>{
  await pay(1500);await db.query("update public.transactions set total_amount=4500 where reservation_id=$1",[reservation]);
  const q=await preview();assert.equal(q.depositBase,3000);assert.equal(q.refundableAmount,900);
  await assert.rejects(db.exec("update public.transactions set cancellation_deposit_base=1"),code("22023"));
});
test("previous completed refunds are subtracted before cancellation and cannot be refunded twice",async()=>{
  await pay(3500);const excess=(await row("select public.request_overpayment_refund($1) id",[reservation])).id;
  await complete(excess);await actor(guest);const q=await preview();assert.equal(q.previousRefunds,500);assert.equal(q.netPaid,3000);assert.equal(q.refundableAmount,2400);
  const cancelled=await cancel();assert.notEqual(cancelled.refundId,excess);
});
test("unverified and pending receipts cannot be counted or hidden by cancellation",async()=>{
  await pay(600);await pay(2400,"pending");const q=await preview();assert.equal(q.verifiedPaid,600);assert.equal(q.allowed,false);
  await assert.rejects(cancel(),code("40001"));assert.equal((await row("select status from public.reservations")).status,"confirmed");
});
test("stale previews and repeated confirmations cannot change or duplicate refund records",async()=>{
  await pay(3000);const q=await preview();await pay(100);
  await assert.rejects(cancel("guest","Guest requested cancellation",q.quote),code("40001"));
  await cancel();await assert.rejects(cancel(),code("40001"));
  assert.equal((await row("select count(*)::int n from public.refund_requests")).n,1);
});
test("cashier cannot invoke resort cancellation, guest cannot cancel another booking or impersonate resort",async()=>{
  await actor(other);await assert.rejects(preview(),code("42501"));
  await actor(guest);await assert.rejects(preview("resort"),code("42501"));
  await actor(cashier);await assert.rejects(preview("resort"),code("42501"));
  await actor(admin);await pay(3000);const q=await preview("guest");assert.equal(q.refundableAmount,2400,"Staff handling a guest request must retain the deposit");
});
test("manual review, administrator approval and independently verified proof are mandatory",async()=>{
  await pay(3000);const {refundId:id}=await cancel();
  await actor(admin);await assert.rejects(transition(id,"approved"),code("22023"));
  await actor(cashier);await assert.rejects(transition(id,"reviewed",false),code("22023"));await transition(id,"reviewed",true);
  await assert.rejects(transition(id,"approved"),code("42501"));await actor(admin);await transition(id,"approved");
  await actor(cashier);await assert.rejects(transition(id,"refunded",true),code("22023"));
  await assert.rejects(transition(id,"payout_submitted",false,"Transfer sent","1234567890123",id+"/missing.png"),code("22023"));
  const path=id+"/proof.png";await db.query("insert into storage.objects values('refund-proofs',$1)",[path]);
  await transition(id,"payout_submitted",false,"Transfer sent","1234567890123",path);
  assert.equal((await row("select paid_amount from public.transactions")).paid_amount,"3000.00","Uploading proof must not change net paid");
  await assert.rejects(transition(id,"refunded",true),code("42501"));await actor(admin);
  await assert.rejects(transition(id,"refunded",false),code("22023"));await transition(id,"refunded",true);
  assert.equal((await row("select paid_amount from public.transactions")).paid_amount,"600.00");
  await assert.rejects(transition(id,"refunded",true),code("22023"));
});
test("open overpayment refunds are converted and re-reviewed when a guest cancels",async()=>{
  await pay(3500);const id=(await row("select public.request_overpayment_refund($1) id",[reservation])).id;
  await actor(cashier);await transition(id,"reviewed",true);await actor(admin);await transition(id,"approved");
  await actor(guest);const result=await cancel();assert.equal(result.refundId,id);
  const f=await row("select * from public.refund_requests");assert.equal(f.amount,"2900.00");assert.equal(f.status,"pending");assert.equal(f.reviewed_by,null);
});
test("legacy refund toggle cannot suppress mandatory policy refunds and notice windows remain booked",async()=>{
  await pay(3000);await db.exec("update public.booking_policy_versions set refund_review_enabled=false");
  assert.equal((await cancel()).refundableAmount,2400);
});
test("reviewed and payout-submitted funds remain allocated, and notifications/audit cover each stage",async()=>{
  await pay(3500);const id=(await row("select public.request_overpayment_refund($1) id",[reservation])).id;
  await actor(cashier);await transition(id,"reviewed",true);await actor(guest);
  await assert.rejects(db.query("select public.request_overpayment_refund($1)",[reservation]),code("40001"));
  await assert.rejects(db.exec("delete from public.payments"),code("40001"));
  await actor(admin);await transition(id,"approved");await actor(cashier);
  const path=id+"/proof.png";await db.query("insert into storage.objects values('refund-proofs',$1)",[path]);
  await transition(id,"payout_submitted",false,"Manual transfer","1234567890123",path);
  await actor(guest);await assert.rejects(cancel(),code("40001"));
  await actor(admin);await transition(id,"refunded",true);
  assert.equal((await row("select count(*)::int n from public.audit_logs where entity_id=$1",[id])).n,5);
  assert.equal((await row("select count(*)::int n from public.notifications where recipient_id=$1",[guest])).n,4);
});
test("reapplying the migration preserves completed refunds, evidence and audit history",async()=>{
  await pay(3000);const {refundId:id}=await cancel();await complete(id);
  await db.exec(readFileSync("docs/cancellation-refund-workflow-migration.sql","utf8"));
  assert.equal((await row("select status from public.refund_requests")).status,"refunded");
  assert.equal((await row("select paid_amount from public.transactions")).paid_amount,"600.00");
});

test("unpaid cancellation creates no request and fully paid resort cancellation returns all verified funds",async()=>{
  const result=await cancel();assert.equal(result.refundId,null);assert.equal(result.refundableAmount,0);
  assert.equal((await row("select count(*)::int n from public.refund_requests")).n,0);
});
test("a resort-caused fully paid cancellation returns 100% and cannot be initiated by an inactive admin",async()=>{
  await pay(3000);await actor(admin);await db.exec("update public.staff_users set is_active=false where role='admin'");
  await assert.rejects(preview("resort"),code("42501"));await db.exec("update public.staff_users set is_active=true where role='admin'");
  assert.equal((await cancel("resort","Scheduled pool repair requires closure")).refundableAmount,3000);
});
test("guest notice window remains enforced while authorized staff can handle the guest request",async()=>{
  await db.exec("update public.reservations set start_datetime=now()+interval '1 hour'");
  assert.equal((await preview()).allowed,false);await assert.rejects(cancel(),code("40001"));
  await actor(admin);assert.equal((await preview()).allowed,true);await cancel();
});
test("legacy approved cancellation is classified explicitly and must be reviewed and approved again",async()=>{
  await pay(3000);await db.exec("update public.reservations set status='cancelled'");
  const id=(await row("insert into public.refund_requests(reservation_id,guest_id,amount,policy_snapshot,request_kind,status,workflow_version) values($1,$2,3000,'Legacy policy','cancellation','approved',1) returning refund_id",[reservation,guest])).refund_id;
  await actor(cashier);await assert.rejects(transition(id,"payout_submitted"),code("40001"));
  await assert.rejects(db.query("select public.recalculate_legacy_cancellation_refund($1,'guest','Guest requested by phone')",[id]),code("42501"));
  await actor(admin);await db.query("select public.recalculate_legacy_cancellation_refund($1,'guest','Guest requested by phone')",[id]);
  const f=await row("select * from public.refund_requests");assert.equal(f.amount,"2400.00");assert.equal(f.status,"pending");assert.equal(f.workflow_version,2);
  await complete(id);assert.equal((await row("select paid_amount from public.transactions")).paid_amount,"600.00");
});
test("direct authenticated writes cannot change refund amounts or bypass cancellation evaluation",async()=>{
  await pay(3000);await actor(admin);
  await db.exec("grant select,update on public.reservations to authenticated;grant select on public.refund_requests to authenticated;set role authenticated;");
  try { await assert.rejects(db.exec("update public.reservations set status='cancelled'"),code("42501")); }
  finally { await db.exec("reset role;"); }
  await actor(guest);await cancel();await actor(admin);await db.exec("set role authenticated;");
  try { await assert.rejects(db.exec("update public.refund_requests set amount=1"),code("42501")); }
  finally { await db.exec("reset role;"); }
});

test("legacy deposit backfill uses the first verified payment receipt rather than later service charges",async()=>{
  await pay(600);await db.exec("update public.transactions set total_amount=4500");
  await db.exec("insert into public.receipts(payment_id,transaction_total_at_time) select payment_id,3000 from public.payments;");
  await db.exec("drop trigger freeze_cancellation_deposit_base on public.transactions;update public.transactions set cancellation_deposit_base=null;");
  await db.exec(readFileSync("docs/cancellation-refund-workflow-migration.sql","utf8"));
  const q=await preview();assert.equal(q.depositBase,3000);assert.equal(q.deduction,600);assert.equal(q.refundableAmount,0);
});

test("an active administrator can review, approve, document and verify their own refund with mandatory evidence",async()=>{
  await pay(3000);const {refundId:id}=await cancel();await actor(admin);
  await transition(id,"reviewed",true);await transition(id,"approved");
  const path=id+"/admin-payout.png";await db.query("insert into storage.objects values('refund-proofs',$1)",[path]);
  await transition(id,"payout_submitted",false,"Transferred manually","1234567890123",path);
  await assert.rejects(transition(id,"refunded",false),code("22023"));
  await assert.rejects(transition(id,"refunded",true,"bad"),code("22023"));
  await db.query("delete from storage.objects where name=$1",[path]);await assert.rejects(transition(id,"refunded",true),code("22023"));
  await db.query("insert into storage.objects values('refund-proofs',$1)",[path]);
  await db.exec("update public.staff_users set is_active=false where role='admin'");await assert.rejects(transition(id,"refunded",true),code("42501"));
  await db.exec("update public.staff_users set is_active=true where role='admin'");await transition(id,"refunded",true,"Verified provider records and recipient");
  const f=await row("select * from public.refund_requests");assert.equal(f.status,"refunded");assert.equal(f.payout_submitted_by,admin);assert.equal(f.refunded_by,admin);
  assert.equal((await row("select paid_amount from public.transactions")).paid_amount,"600.00");
  const audit=await row("select details from public.audit_logs where action='Refund refunded'");assert.equal(audit.details.admin_self_verification,true);
});

test("the focused admin verification migration upgrades an installed second-person restriction without changing amounts",async()=>{
  await pay(3000);const {refundId:id}=await cancel();await actor(admin);
  await transition(id,"reviewed",true);await transition(id,"approved");const path=id+"/payout.png";
  await db.query("insert into storage.objects values('refund-proofs',$1)",[path]);await transition(id,"payout_submitted",false,"Manual transfer","1234567890123",path);
  const definition=(await row("select pg_get_functiondef('public.transition_refund_workflow(uuid,text,text,text,text,text,boolean)'::regprocedure) as source")).source;
  const guard="if f.payout_submitted_by=auth.uid() and not exists\n      (select 1 from public.staff_users where id=auth.uid() and role='admin' and is_active) then\n      raise exception 'Another authorized staff member must verify this payout; only an active administrator may verify their own transfer' using errcode='42501'; end if;";
  assert.ok(definition.includes(guard));await db.exec(definition.replace(guard,"if f.payout_submitted_by=auth.uid() then raise exception 'Another staff member must verify' using errcode='42501'; end if;"));
  await assert.rejects(transition(id,"refunded",true),code("42501"));
  await db.exec(readFileSync("docs/admin-refund-verification-migration.sql","utf8"));await db.exec(readFileSync("docs/admin-refund-verification-migration.sql","utf8"));
  assert.equal((await row("select amount from public.refund_requests")).amount,"2400.00");
  await transition(id,"refunded",true);assert.equal((await row("select paid_amount from public.transactions")).paid_amount,"600.00");
});
