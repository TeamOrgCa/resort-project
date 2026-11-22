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
const workflowMigration=readFileSync("docs/manager-cashier-refund-workflow-migration.sql","utf8");
const fullAccessMigration=readFileSync("docs/admin-full-access-migration.sql","utf8");
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
 await db.exec("alter table public.reservation_reschedules add column reschedule_fee numeric default 0;create table public.reservation_reschedule_adjustments(reservation_id uuid references public.reservations,notice_fee numeric);");
 await db.exec(readFileSync("docs/non-refundable-reschedule-fees-migration.sql","utf8"));
 await db.exec(workflowMigration);

 await db.exec(`
   create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true))$$;
   create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
   alter table public.staff_users add column active_session_id text;
   alter table public.payment_methods add column type text;
   create table public.services(service_id uuid primary key);
   create table public.reservation_services(reservation_id uuid,service_id uuid,quantity integer,subtotal numeric);
   create table public.ocular_visits(visit_id uuid primary key,guest_id uuid,reference_number text,status text,scheduled_date date,time_slot_id uuid,cancellation_reason text,cancelled_at timestamptz,cancelled_by uuid);
   create table public.ocular_time_slots(slot_id uuid primary key,start_time time,end_time time);
   create table public.reviews(review_id uuid primary key);
   create trigger guard_review_admin_write before update on public.reviews for each row execute function public.guard_admin_operational_write();
   alter table public.reservations add column no_show_at timestamptz,add column no_show_by uuid,add column no_show_reason text,add column checked_out_at timestamptz;
 `);
 await db.exec(readFileSync("docs/public-access-sales-migration.sql","utf8"));
 await db.exec(fullAccessMigration);
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
 await actor(null);await db.exec(fullAccessMigration);await db.exec("update public.staff_users set is_active=true");await db.exec("truncate public.reservations,public.audit_logs,public.notifications,storage.objects,public.maintenance_blocks cascade;");
 await db.query("insert into public.reservations(reservation_id,guest_id,reference_number,status,start_datetime,end_datetime,booking_policy_version) values($1,$2,'MV-TEST','confirmed',now()+interval '10 days',now()+interval '11 days',1)",[reservation,guest]);
 await db.query("insert into public.transactions(reservation_id,total_amount) values($1,3000)",[reservation]);
 await db.query("insert into public.payments(reservation_id,amount,status) values($1,3000,'verified')",[reservation]);
});
const request=async()=>{
 await actor(guest);
 const {data:q}=await row("select public.get_cancellation_preview($1,'guest') data",[reservation]);
 return (await row("select public.cancel_reservation_evaluated($1,'Family plans changed','guest',$2) data",[reservation,q.quote])).data.refundId;
};
const transition=(id,action,verified=false,proof=null,notes="Checked provider records",reference="1234567890123")=>db.query(
 "select public.transition_refund_workflow($1,$2,$3,$4,$5,'GCash',$6)",[id,action,notes,reference,proof,verified]);
const payout=async id=>{
 await actor(cashier);const path=id+'/proof.png';
 await db.query("insert into storage.objects values('refund-proofs',$1)",[path]);
 await transition(id,'payout_submitted',false,path);return path;
};
const invalid=e=>e.code==='22023',conflict=e=>e.code==='40001';


test("full access migration is repeatable and removes admin-specific table and proof vetoes",async()=>{
 await db.exec(fullAccessMigration);
 assert.equal((await row("select count(*)::int n from pg_trigger where tgname in ('guard_admin_operational_write','guard_admin_operational_proof_write','guard_review_admin_write')")).n,0);
 await actor(admin);await db.query("update public.reservations set cancellation_reason='Admin note' where reservation_id=$1",[reservation]);
 await db.exec("insert into storage.objects values('payment-proofs','admin/proof.png')");
 for(const permission of ['cancel_reservation','edit_reservation','refund_approval','refund_payout','refund_verify']){
  assert.equal((await row("select public.refund_staff_permission($1) allowed",[permission])).allowed,true);
 }
 await db.exec("update public.staff_users set is_active=false where role='admin'");
 assert.equal((await row("select public.refund_staff_permission('refund_approval') allowed")).allowed,false);
});

test("admins approve and pay refunds; a different authorized actor verifies the transfer",async()=>{
 const id=await request();
 await actor(admin);await transition(id,'approved');
 const path=id+'/proof.png';await db.query("insert into storage.objects values('refund-proofs',$1)",[path]);
 await transition(id,'payout_submitted',false,path);
 await assert.rejects(transition(id,'refunded',true),denied);
 await actor(manager);await transition(id,'refunded',true);
 assert.equal((await row("select status from public.refund_requests where refund_id=$1",[id])).status,'refunded');
});

test("admins can verify cashier payouts and cancel for resort-attributable reasons",async()=>{
 await actor(admin);
 const {data:q}=await row("select public.get_cancellation_preview($1,'resort') data",[reservation]);
 assert.equal(q.allowed,true);assert.equal(q.refundableAmount,3000);
 const {data:r}=await row("select public.cancel_reservation_evaluated($1,'Pool closed for repairs','resort',$2) data",[reservation,q.quote]);
 await transition(r.refundId,'approved');await payout(r.refundId);await actor(admin);await transition(r.refundId,'refunded',true);
 assert.equal((await row("select refunded_by from public.refund_requests")).refunded_by,admin);
});

test("manager and cashier grants retain their refund role boundaries",async()=>{
 await db.exec("update public.role_permissions set permissions=array['refund_approval','refund_payout','refund_verify']");
 for(const [who,permission,allowed]of [[cashier,'refund_approval',false],[cashier,'refund_verify',false],[cashier,'refund_payout',true],[manager,'refund_payout',false],[manager,'refund_approval',true]]){
  await actor(who);assert.equal((await row("select public.refund_staff_permission($1) allowed",[permission])).allowed,allowed);
 }
 await actor(guest);assert.equal((await row("select public.refund_staff_permission('refund_approval') allowed")).allowed,false);
});

test("admins record public cash collections without role grants, with a matching active session",async()=>{
 await actor(admin);
 await db.exec("update public.staff_users set active_session_id='admin-session' where role='admin';select set_config('request.jwt.claim.session_id','admin-session',false)");
 const {id}=await row("insert into public.payment_methods(name,type,is_active) values('Cash','cash',true) returning payment_method_id id");
 const {data}=await row("select public.record_public_access_sale(gen_random_uuid(),'Ana Santos','+639171234567','swimming','Swimming admission',300,$1,null,null,true) data",[id]);
 assert.equal(data.sale.cashier_id,admin);assert.equal(data.sale.amount,300);
 await db.exec("select set_config('request.jwt.claim.session_id','wrong-session',false)");
 await assert.rejects(row("select public.record_public_access_sale(gen_random_uuid(),'Ana Santos','+639171234567','swimming','Swimming admission',300,$1,null,null,true)",[id]),denied);
});

test("admins can cancel ocular visits, record attendance and mark no-shows without manager grants",async()=>{
 await actor(null);await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
 const visit="77777777-7777-4777-8777-777777777777",slot="88888888-8888-4888-8888-888888888888";
 await db.query("insert into public.ocular_time_slots values($1,'08:00','09:00')",[slot]);
 await db.query("insert into public.ocular_visits(visit_id,status,scheduled_date,time_slot_id) values($1,'confirmed',current_date-1,$2)",[visit,slot]);
 await row("select public.complete_ocular_visit($1,$2)",[visit,admin]);
 assert.equal((await row("select status from public.ocular_visits where visit_id=$1",[visit])).status,'completed');
 await db.query("update public.ocular_visits set status='confirmed' where visit_id=$1",[visit]);
 await row("select public.cancel_manager_ocular_visit($1,'Resort closed for maintenance',$2)",[visit,admin]);
 assert.equal((await row("select cancelled_by from public.ocular_visits where visit_id=$1",[visit])).cancelled_by,admin);
 await db.query("update public.reservations set start_datetime=now()-interval '2 days',end_datetime=now()-interval '1 day' where reservation_id=$1",[reservation]);
 await row("select public.mark_reservation_no_show($1,$2,'Guest did not arrive')",[reservation,admin]);
 assert.equal((await row("select no_show_by from public.reservations")).no_show_by,admin);
});

test("admin edit access reaches reservation validation and maintenance actions remain available",async()=>{
 await actor(admin);
 await assert.rejects(row("select public.edit_staff_reservation(gen_random_uuid(),$1,'{}','{}')",[admin]),error=>error.code==='22023'&&/Reservation not found/.test(error.message));
 const {id}=await row("select public.create_maintenance_block('Pool repairs','Scheduled repairs',current_date+20,current_date+21) id");
 assert.equal((await row("select created_by from public.maintenance_blocks where block_id=$1",[id])).created_by,admin);
});
