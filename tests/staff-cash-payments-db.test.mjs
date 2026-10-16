
import test,{before,beforeEach,after}from"node:test";
import assert from"node:assert/strict";
import{readFileSync}from"node:fs";
import{PGlite}from"@electric-sql/pglite";
let db;
const admin="11111111-1111-4111-8111-111111111111",guest="22222222-2222-4222-8222-222222222222",staff="33333333-3333-4333-8333-333333333333",session="44444444-4444-4444-8444-444444444444",reservation="55555555-5555-4555-8555-555555555555",gcash="66666666-6666-4666-8666-666666666666";
const actor=(id,sid=session)=>db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.session_id',$2,false)",[id??"",sid??""]);
const one=async(sql,args=[]) =>(await db.query(sql,args)).rows[0];
const record=(amount=2400,expected=2400,ref="CASH-TEST123456",received=true)=>one("select public.record_staff_cash_payment($1,$2,$3,$4,$5) data",[reservation,amount,ref,expected,received]).then(r=>r.data);
function fn(path,name){const text=readFileSync(path,"utf8"),start=text.indexOf("create or replace function public."+name+"(");assert.ok(start>=0,name);return text.slice(start,text.indexOf("$$;",start)+3);}
before(async()=>{
 db=new PGlite();
 await db.exec(`
 create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('session_id',nullif(current_setting('request.jwt.claim.session_id',true),''))$$;
 create table public.staff_users(id uuid primary key,role text,is_active boolean,active_session_id uuid);
 create table public.role_permissions(role text primary key,permissions text[]);
 create table public.guests(id uuid primary key,first_name text,last_name text);
 create table public.walk_in_guests(walk_in_guest_id uuid primary key,first_name text,last_name text);
 create table public.reservations(reservation_id uuid primary key,guest_id uuid,walk_in_guest_id uuid,reference_number text,status text,payment_deadline_at timestamptz,start_datetime timestamptz,end_datetime timestamptz);
 create table public.transactions(reservation_id uuid primary key,total_amount numeric,paid_amount numeric default 0,status text,
 balance numeric generated always as(greatest(total_amount-paid_amount,0))stored,overpaid_amount numeric generated always as(greatest(paid_amount-total_amount,0))stored);
 create table public.payment_methods(payment_method_id uuid primary key default gen_random_uuid(),name text,type text,is_active boolean,created_at timestamptz default now());
 create table public.payments(payment_id uuid primary key default gen_random_uuid(),reservation_id uuid,amount numeric,payment_method_id uuid,payment_type text,status text,
 reference_number text unique,account_name text,account_number text,proof_path text,ocr_status text,paid_at timestamptz,verified_by uuid,verified_at timestamptz,rejected_by uuid,rejected_at timestamptz);
 create table public.receipts(receipt_id uuid primary key default gen_random_uuid(),payment_id uuid unique,receipt_number text unique,amount_paid numeric,transaction_total_at_time numeric,balance_after_payment numeric,billed_to_name text,issued_at timestamptz default now());
 create table public.refund_requests(reservation_id uuid,amount numeric,status text);
 create table public.reservation_reschedules(reservation_id uuid,status text);
 create table public.invoices(invoice_id uuid primary key default gen_random_uuid(),reservation_id uuid unique,total_amount numeric,status text,created_at timestamptz default now());
 create table public.audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
 `);
 for(const name of["refresh_reservation_payment_totals","update_transaction_paid_amount"])await db.exec(fn("docs/overpayment-refunds-migration.sql",name));
 for(const name of["accept_payment_submission","finish_payment_review"])await db.exec(fn("docs/reservation-lifecycle-migration.sql",name));
 await db.exec(readFileSync("docs/staff-cash-payments-migration.sql","utf8"));
 await db.exec(`
 create trigger accept_submission after insert on public.payments for each row execute function public.accept_payment_submission();
 create trigger guard_review before update of status on public.payments for each row execute function public.guard_payment_review();
 create trigger finish_review after update of status on public.payments for each row execute function public.finish_payment_review();
 create trigger update_paid after insert or update or delete on public.payments for each row execute function public.update_transaction_paid_amount();
 insert into public.payment_methods values('${gcash}','GCash','ewallet',true,now());
 insert into public.guests values('${guest}','Guest','Tester');
 insert into public.walk_in_guests values('${guest}','Walk-in','Tester');
 insert into public.staff_users values('${admin}','admin',true,'${session}'),('${staff}','staff',true,'${session}');
 insert into public.role_permissions values('staff',array['payment_entry']);
 `);
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
 await actor(admin);
 await db.exec("truncate public.payments,public.receipts,public.reservations,public.transactions,public.invoices,public.audit_logs,public.refund_requests,public.reservation_reschedules;update public.payment_methods set is_active=true;update public.staff_users set is_active=true;update public.role_permissions set permissions=array['payment_entry'];");
 await db.query("insert into public.reservations values($1,$2,null,'MV-CASH','confirmed',now()+interval '1 hour',now(),now()+interval '8 hours')",[reservation,guest]);
 await db.query("insert into public.transactions(reservation_id,total_amount,paid_amount,status) values($1,3000,0,'unpaid')",[reservation]);
 await db.query("insert into public.invoices(reservation_id,total_amount,status) values($1,3000,'partially_paid')",[reservation]);
 await db.query("insert into public.payments(reservation_id,amount,payment_method_id,status,reference_number) values($1,600,$2,'verified','1234567890123')",[reservation,gcash]);
});
test("cash settles a GCash downpayment balance, creates a named receipt and updates the invoice",async()=>{
 const r=await record();assert.equal(r.remainingBalance,0);assert.equal(r.payment.status,"verified");assert.equal(r.payment.payment_type,"full");assert.equal(r.payment.verified_by,admin);
 assert.equal(r.receipt.billed_to_name,"Guest Tester");assert.equal(r.receipt.amount_paid,2400);assert.equal(r.receipt.balance_after_payment,0);
 assert.equal((await one("select paid_amount from public.transactions")).paid_amount,"3000");assert.equal((await one("select status from public.invoices")).status,"paid");
 assert.equal((await one("select count(*)::int n from public.audit_logs where action='Recorded cash payment'")).n,1);
});
test("the same reference is idempotent and a conflicting duplicate cannot credit a second payment",async()=>{
 await record();const again=await record();assert.equal(again.alreadyRecorded,true);assert.equal((await one("select count(*)::int n from public.payments")).n,2);
 await assert.rejects(()=>record(2000,2400),error=>error.code==="23505");
 assert.equal((await one("select count(*)::int n from public.receipts")).n,1);
});
test("partial cash payments and previous completed refunds use the net balance in receipts",async()=>{
 await db.query("insert into public.refund_requests values($1,100,'refunded')",[reservation]);await db.query("select public.refresh_reservation_payment_totals($1)",[reservation]);
 const r=await record(1000,2500);assert.equal(r.remainingBalance,1500);assert.equal(r.receipt.balance_after_payment,1500);assert.equal(r.payment.payment_type,"additional");
 assert.equal((await one("select status from public.invoices")).status,"partially_paid");
});
test("only an active staff session with payment-entry permission can record cash",async()=>{
 for(const id of[guest,null]){await actor(id);await assert.rejects(()=>record(),error=>error.code==="42501");}
 await actor(staff);assert.equal((await record()).remainingBalance,0);
 await db.query("update public.role_permissions set permissions='{}'");await assert.rejects(()=>record(),error=>error.code==="42501");
 await actor(admin,"77777777-7777-4777-8777-777777777777");await assert.rejects(()=>record(),error=>error.code==="42501");
});
test("cash requires acknowledgement and rejects stale totals, overpayments, closed reservations and pending reviews",async()=>{
 await assert.rejects(()=>record(2400,2400,"CASH-TEST123456",false),error=>error.code==="22023");
 await assert.rejects(()=>record(2500),error=>error.code==="22023");
 await assert.rejects(()=>record(2400,2300),error=>error.code==="40001");
 await db.query("insert into public.reservation_reschedules values($1,'pending')",[reservation]);await assert.rejects(()=>record(),error=>error.code==="40001");
 await db.exec("truncate public.reservation_reschedules");await db.query("update public.reservations set status='cancelled'");await assert.rejects(()=>record(),error=>error.code==="40001");
 assert.equal((await one("select count(*)::int n from public.payments")).n,1);
});
test("cash must be configured and audit failures roll back payment, receipt and balance together",async()=>{
 await db.query("update public.payment_methods set is_active=false where type='cash'");await assert.rejects(()=>record(),error=>error.code==="22023");
 await db.exec("update public.payment_methods set is_active=true;create function public.fail_cash_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable';end$$;create trigger fail_cash_audit before insert on public.audit_logs for each row execute function public.fail_cash_audit()");
 try{await assert.rejects(()=>record(),/audit unavailable/);}finally{await db.exec("drop trigger fail_cash_audit on public.audit_logs");}
 assert.equal((await one("select paid_amount from public.transactions")).paid_amount,"600");assert.equal((await one("select count(*)::int n from public.receipts")).n,0);
});
test("initial cash payments confirm pending bookings, enforce 20%, and support walk-in receipts",async()=>{
 await db.exec("truncate public.payments;update public.reservations set status='pending';");
 await assert.rejects(()=>record(100,3000),error=>error.code==="22023");
 await db.query("update public.reservations set guest_id=null,walk_in_guest_id=$1",[guest]);
 const r=await record(3000,3000);assert.equal(r.receipt.billed_to_name,"Walk-in Tester");assert.equal((await one("select status from public.reservations")).status,"confirmed");
});
test("guests cannot insert cash directly and reapplying the migration preserves payment history",async()=>{
 await actor(guest);
 const cash=(await one("select payment_method_id id from public.payment_methods where type='cash'")).id;
 await assert.rejects(()=>db.query("insert into public.payments(reservation_id,amount,payment_method_id,status,reference_number) values($1,2400,$2,'pending','CASH-BYPASS123')",[reservation,cash]),error=>error.code==="42501");
 await actor(admin);await record();await db.exec(readFileSync("docs/staff-cash-payments-migration.sql","utf8"));
 assert.equal((await one("select count(*)::int n from public.payments")).n,2);assert.equal((await one("select count(*)::int n from public.payment_methods where type='cash'")).n,1);
});

for(const setup of["missing","disabled","wrong event"]){
 test(`reapplying the migration repairs a ${setup} receipt trigger without duplicating payments or receipts`,async()=>{
   if(setup==="disabled")await db.exec("alter table public.payments disable trigger trigger_create_receipt");
   else{
     await db.exec("drop trigger trigger_create_receipt on public.payments");
     if(setup==="wrong event")await db.exec("create trigger trigger_create_receipt after insert on public.payments for each row execute function public.create_receipt_on_payment()");
   }
   try{
     await assert.rejects(()=>record(),error=>error.code==="55000");
     assert.equal((await one("select count(*)::int n from public.payments")).n,1,"failed settlement must roll back");
     assert.equal((await one("select paid_amount from public.transactions")).paid_amount,"600");
     await db.exec(readFileSync("docs/staff-cash-payments-migration.sql","utf8"));
     const result=await record();assert.equal(result.remainingBalance,0);assert.equal(result.receipt.amount_paid,2400);
     await db.exec(readFileSync("docs/staff-cash-payments-migration.sql","utf8"));
     const replay=await record();assert.equal(replay.alreadyRecorded,true);assert.equal(replay.receipt.receipt_id,result.receipt.receipt_id);
     assert.equal((await one("select count(*)::int n from public.receipts")).n,1);
     assert.equal((await one("select count(*)::int n from public.payments")).n,2);
   }finally{await db.exec(readFileSync("docs/staff-cash-payments-migration.sql","utf8"));}
 });
}

test("the repaired receipt trigger still issues one receipt when an existing GCash payment is verified",async()=>{
 const inserted=await one("insert into public.payments(reservation_id,amount,payment_method_id,status,reference_number) values($1,2400,$2,'pending','9876543210123') returning payment_id",[reservation,gcash]);
 await db.query("update public.payments set status='verified' where payment_id=$1",[inserted.payment_id]);
 assert.equal((await one("select count(*)::int n from public.receipts")).n,1);
 assert.equal((await one("select billed_to_name from public.receipts")).billed_to_name,"Guest Tester");
 await db.query("update public.payments set paid_at=now() where payment_id=$1",[inserted.payment_id]);
 assert.equal((await one("select count(*)::int n from public.receipts")).n,1);
});

test("the new permission/rejection migration preserves authorized cash settlement and named receipts",async()=>{
 await db.exec("create table if not exists public.notifications(recipient_role text,recipient_id uuid,actor_id uuid,title text,message text,action_url text,entity_type text,entity_id uuid);drop trigger if exists guard_review on public.payments;drop trigger if exists finish_review on public.payments;");
 await db.exec(readFileSync("docs/payment-review-and-notifications-migration.sql","utf8"));
 await actor(staff);const result=await record();assert.equal(result.remainingBalance,0);assert.equal(result.receipt.billed_to_name,"Guest Tester");assert.equal(result.payment.verified_by,staff);
 assert.equal((await record()).alreadyRecorded,true);assert.equal((await one("select count(*)::int n from public.receipts")).n,1);
});
