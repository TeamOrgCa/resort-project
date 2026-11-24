import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRefundDatabase } from "./helpers/refund-database.mjs";
import { readFileSync } from "node:fs";
const workflowMigration=readFileSync("docs/manager-cashier-refund-workflow-migration.sql","utf8");
let db;
const guest="11111111-1111-4111-8111-111111111111", other="33333333-3333-4333-8333-333333333333";
const admin="44444444-4444-4444-8444-444444444444", cashier="55555555-5555-4555-8555-555555555555";
const manager="66666666-6666-4666-8666-666666666666", reservation="22222222-2222-4222-8222-222222222222";
const actor=id=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??""]);
const row=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const denied=e=>e.code==="42501";
before(async()=>{db=await createRefundDatabase();});
after(async()=>{await db?.close();});
beforeEach(async()=>{
 await actor(null);await db.exec(workflowMigration);await db.exec("update public.staff_users set is_active=true");await db.exec("truncate public.reservations,public.audit_logs,public.notifications,storage.objects,public.maintenance_blocks cascade;");
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

test("pending cancellation goes directly to manager approval, cashier payout and manager verification",async()=>{
 const id=await request();
 assert.equal((await row("select status from public.refund_requests")).status,'pending');
 await actor(manager);await transition(id,'approved');
 let refund=await row("select * from public.refund_requests");
 assert.equal(refund.reviewed_by,manager);assert.equal(refund.payment_reviewed_at,null);
 assert.equal((await row("select paid_amount from public.transactions")).paid_amount,'3000.00');
 await payout(id);
 assert.equal((await row("select status from public.refund_requests")).status,'payout_submitted');
 assert.equal((await row("select paid_amount from public.transactions")).paid_amount,'3000.00');
 await actor(manager);await transition(id,'refunded',true);
 refund=await row("select * from public.refund_requests");
 assert.equal(refund.status,'refunded');assert.equal(refund.amount,'2400.00');assert.equal(refund.refunded_by,manager);
 assert.equal((await row("select paid_amount from public.transactions")).paid_amount,'600.00');
 assert.deepEqual((await db.query("select action from public.audit_logs where entity_type='refund_request' and action like 'Refund %' order by ctid")).rows.map(r=>r.action),['Refund approved','Refund payout_submitted','Refund refunded']);
});

test("role restrictions survive forged grants and block the retired review action",async()=>{
 const id=await request();
 await actor(null);await db.exec("update public.role_permissions set permissions=permissions||array['refund_review','refund_approval','refund_payout','refund_verify']");
 for(const staffId of [cashier,manager]){
  await actor(staffId);await assert.rejects(transition(id,'reviewed',true),invalid);
 }
 await actor(cashier);await assert.rejects(transition(id,'approved'),denied);await assert.rejects(transition(id,'rejected'),denied);
 await actor(admin);await assert.rejects(transition(id,'approved'),denied);
 await actor(manager);await transition(id,'approved');
 await assert.rejects(transition(id,'payout_submitted'),denied);
 await payout(id);
 await actor(cashier);await assert.rejects(transition(id,'refunded',true),denied);
 await actor(admin);await assert.rejects(transition(id,'refunded',true),denied);
 await actor(manager);await transition(id,'refunded',true);
});

test("cashier cannot pay before approval and manager verification requires notes, acknowledgement and proof",async()=>{
 const id=await request();await actor(cashier);await assert.rejects(transition(id,'payout_submitted'),invalid);
 await actor(manager);await assert.rejects(transition(id,'refunded',true),invalid);await transition(id,'approved');
 const path=await payout(id);await actor(manager);
 await assert.rejects(transition(id,'refunded',false),invalid);
 await assert.rejects(transition(id,'refunded',true,null,'no'),invalid);
 await db.query("delete from storage.objects where name=$1",[path]);
 await assert.rejects(transition(id,'refunded',true),invalid);
 assert.equal((await row("select status from public.refund_requests")).status,'payout_submitted');
 assert.equal((await row("select paid_amount from public.transactions")).paid_amount,'3000.00');
});

test("a pending refund can be rejected directly by a manager with a documented reason",async()=>{
 const id=await request();await actor(manager);
 await assert.rejects(transition(id,'rejected',false,null,'no'),invalid);
 await transition(id,'rejected',false,null,'Payment evidence does not support this request');
 assert.equal((await row("select status from public.refund_requests")).status,'rejected');
 assert.equal((await row("select paid_amount from public.transactions")).paid_amount,'3000.00');
 await actor(cashier);await assert.rejects(transition(id,'payout_submitted'),invalid);
});

test("legacy reviewed requests keep their historical review notes and can be approved without another review",async()=>{
 const id=await request();await actor(null);
 await db.query("update public.refund_requests set status='reviewed',payment_reviewed_by=$1,payment_reviewed_at=now(),payment_review_notes='Historic cashier review' where refund_id=$2",[cashier,id]);
 const before=await row("select amount,calculation_snapshot,payment_review_notes,payment_reviewed_at from public.refund_requests");
 await db.exec(workflowMigration);await db.exec(workflowMigration);
 assert.deepEqual(await row("select amount,calculation_snapshot,payment_review_notes,payment_reviewed_at from public.refund_requests"),before);
 await actor(manager);await transition(id,'approved');
 assert.equal((await row("select payment_review_notes from public.refund_requests")).payment_review_notes,'Historic cashier review');
});

test("excess payment requests use the same direct approval and verification workflow",async()=>{
 await actor(null);await db.query("insert into public.payments(reservation_id,amount,status) values($1,500,'verified')",[reservation]);
 await actor(guest);const {id}=await row("select public.request_overpayment_refund($1) id",[reservation]);
 await actor(manager);await transition(id,'approved');await payout(id);await actor(manager);await transition(id,'refunded',true);
 const refund=await row("select request_kind,amount,status from public.refund_requests");
 assert.deepEqual(refund,{request_kind:'overpayment',amount:'500.00',status:'refunded'});
 assert.equal((await row("select paid_amount from public.transactions")).paid_amount,'3000.00');
});

test("cancellation deductions remain unchanged through direct approval and manager verification",async()=>{
 await actor(null);await db.query("insert into public.reservation_reschedules(reservation_id,status,reschedule_fee) values($1,'approved',300)",[reservation]);
 const id=await request();assert.equal((await row("select amount from public.refund_requests")).amount,'2100.00');
 await actor(manager);await transition(id,'approved');await payout(id);await assert.rejects(transition(id,'refunded',true),denied);
 await actor(manager);await transition(id,'refunded',true);
 assert.equal((await row("select paid_amount from public.transactions")).paid_amount,'900.00');
});

test("pending payments and a changed bill block excess refund approval",async()=>{
 await actor(null);await db.query("insert into public.payments(reservation_id,amount,status) values($1,500,'verified')",[reservation]);
 await actor(guest);const {id}=await row("select public.request_overpayment_refund($1) id",[reservation]);
 await actor(null);await db.query("insert into public.payments(reservation_id,amount,status) values($1,1,'pending')",[reservation]);
 await actor(manager);await assert.rejects(transition(id,'approved'),conflict);
 await actor(null);await db.exec("delete from public.payments where status='pending';update public.transactions set total_amount=3400");
 await actor(manager);await assert.rejects(transition(id,'approved'),conflict);
 assert.equal((await row("select status from public.refund_requests")).status,'pending');
 assert.equal((await row("select amount from public.refund_requests")).amount,'500.00');
});

test("migration preserves completed refunds and only changes the appropriate permission grants",async()=>{
 const id=await request();await actor(manager);await transition(id,'approved');await payout(id);await actor(manager);await transition(id,'refunded',true);
 const before=await row("select * from public.refund_requests");
 await actor(null);await db.exec(workflowMigration);await db.exec(workflowMigration);
 assert.deepEqual(await row("select * from public.refund_requests"),before);
 const managerGrants=(await row("select permissions from public.role_permissions where role='staff'")).permissions;
 const cashierGrants=(await row("select permissions from public.role_permissions where role='cashier'")).permissions;
 for(const grant of ['transactions','refund_approval','refund_verify','edit_reservation'])assert.ok(managerGrants.includes(grant));
 for(const grant of ['transactions','refund_payout','payment_approval'])assert.ok(cashierGrants.includes(grant));
 for(const grant of ['refund_review','refund_approval','refund_verify'])assert.equal(cashierGrants.includes(grant),false);
 assert.equal(managerGrants.includes('refund_payout'),false);
});
