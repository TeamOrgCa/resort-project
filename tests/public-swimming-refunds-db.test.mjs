import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRefundDatabase } from "./helpers/refund-database.mjs";
let db;
const guest="11111111-1111-4111-8111-111111111111",reservation="22222222-2222-4222-8222-222222222222",manager="66666666-6666-4666-8666-666666666666",cashier="55555555-5555-4555-8555-555555555555";
const row=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const actor=id=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
before(async()=>{
  db=await createRefundDatabase();
  await db.exec("alter table reservations add column commercial_type text default 'private_swimming',add column room_pricing boolean default false;");
  await db.exec(readFileSync("docs/public-swimming-refunds-migration.sql","utf8"));
  await db.exec(readFileSync("docs/public-swimming-refunds-migration.sql","utf8"));
});
after(async()=>db?.close());
beforeEach(async()=>{
  await actor(guest);
  await db.exec("truncate public.reservations cascade;truncate public.notifications,public.audit_logs,storage.objects;");
  await db.query("insert into reservations(reservation_id,guest_id,reference_number,status,start_datetime,end_datetime,booking_policy_version,commercial_type) values($1,$2,'PS-TEST','confirmed',now()+interval '1 day',now()+interval '1 day 8 hours',1,'public_swimming')",[reservation,guest]);
  await db.query("insert into transactions(reservation_id,total_amount) values($1,1000)",[reservation]);
  await db.query("insert into payments(reservation_id,amount,status) values($1,1000,'verified')",[reservation]);
});
async function cancel() {
  const q=(await row("select get_cancellation_preview($1,'guest') q",[reservation])).q;
  return (await row("select cancel_reservation_evaluated($1,'Family plans changed','guest',$2) q",[reservation,q.quote])).q;
}
test("public cancellation within the three-day window refunds 80% of verified funds and preserves the existing approval queue",async()=>{
  const preview=(await row("select get_cancellation_preview($1,'guest') q",[reservation])).q;
  assert.equal(preview.allowed,true);assert.equal(Number(preview.deduction),200);assert.equal(Number(preview.refundableAmount),800);
  const result=await cancel();assert.ok(result.refundId);
  const refund=await row("select * from refund_requests");assert.equal(Number(refund.amount),800);assert.equal(refund.status,'pending');
  assert.equal((await row("select status from reservations")).status,'cancelled');
});
test("100% exception needs a manager and valid reason, records its audit, and still requires cashier payout and independent verification",async()=>{
  const {refundId}=await cancel();
  await assert.rejects(()=>db.query("select approve_public_full_refund($1,'Valid special circumstances')",[refundId]),e=>e.code==='42501');
  await actor(cashier);await assert.rejects(()=>db.query("select approve_public_full_refund($1,'Valid special circumstances')",[refundId]),e=>e.code==='42501');
  await actor(manager);await assert.rejects(()=>db.query("select approve_public_full_refund($1,'No')",[refundId]),e=>e.code==='22023');
  await db.query("select approve_public_full_refund($1,'Documented valid family emergency')",[refundId]);
  const refund=await row("select * from refund_requests");assert.equal(Number(refund.amount),1000);assert.equal(refund.status,'approved');assert.equal(refund.calculation_snapshot.managerFullRefund,true);assert.equal(Number(refund.calculation_snapshot.deduction),0);
  assert.equal((await row("select count(*)::int n from audit_logs where action='Approved public swimming 100% refund exception'")).n,1);
  assert.equal(refund.refunded_at,null);assert.equal(Number((await row("select paid_amount from transactions")).paid_amount),1000);
});
