import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

let db;
const guest='11111111-1111-4111-8111-111111111111';
const manager='22222222-2222-4222-8222-222222222222';
const reservation='33333333-3333-4333-8333-333333333333';
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql as $$select current_setting('fixture.uid')::uuid$$;
    create function refund_staff_permission(text) returns boolean language sql as $$select auth.uid()='${manager}'::uuid$$;
    create table staff_users(id uuid,role text,is_active boolean);
    insert into staff_users values('${manager}','staff',true);
    create table reservations(reservation_id uuid,guest_id uuid,reference_number text,status text,
      start_datetime timestamptz,booking_policy_version bigint,checked_in_at timestamptz);
    create table transactions(reservation_id uuid,total_amount numeric,cancellation_deposit_base numeric);
    create table booking_policy_versions(version bigint,guest_cancellation_notice_hours integer);
    insert into booking_policy_versions values(1,48);
    create table payments(reservation_id uuid,amount numeric,status text);
    create table refund_requests(reservation_id uuid,amount numeric,status text);
    create table reservation_reschedules(reservation_id uuid,reschedule_fee numeric,rate_adjustment numeric,status text);
    create table reservation_reschedule_adjustments(reservation_id uuid,notice_fee numeric,rate_adjustment numeric);`);
  await db.exec(readFileSync('docs/non-refundable-reschedule-fees-migration.sql','utf8'));
});
after(async()=>db?.close());
beforeEach(async()=>{
  await db.exec(`truncate reservations,transactions,payments,refund_requests,reservation_reschedules,reservation_reschedule_adjustments;
    insert into reservations values('${reservation}','${guest}','MV-TEST','confirmed',now()+interval '10 days',1,null);
    insert into transactions values('${reservation}',3500,3000);
    insert into payments values('${reservation}',3500,'verified');`);
  await db.query("select set_config('fixture.uid',$1,false)",[guest]);
});
const preview=async(initiator='guest')=>(await db.query('select get_cancellation_preview($1,$2) q',[reservation,initiator])).rows[0].q;
const fee=async(amount,status='approved',rate=0)=>db.query('insert into reservation_reschedules values($1,$2,$3,$4)',[reservation,amount,rate,status]);

test('approved guest and staff reschedule fees are retained separately from the initial deposit',async()=>{
  await fee(300); await fee(100);
  await db.query('insert into reservation_reschedule_adjustments values($1,100,0)',[reservation]);
  const q=await preview();
  assert.equal(q.rescheduleFees,500);assert.equal(q.retainedRescheduleFees,500);
  assert.equal(q.retainedDeposit,600);assert.equal(q.deduction,1100);assert.equal(q.refundableAmount,2400);
});
test('resort cancellation also retains reschedule fees but refunds the deposit',async()=>{
  await fee(500);await db.query("select set_config('fixture.uid',$1,false)",[manager]);
  const q=await preview('resort');
  assert.equal(q.retainedDeposit,0);assert.equal(q.deduction,500);assert.equal(q.refundableAmount,3000);
});
test('pending/rejected requests and higher-date-rate adjustments are not retained as fees',async()=>{
  await fee(500,'pending');await fee(500,'rejected');await fee(0,'approved',500);
  const q=await preview();assert.equal(q.rescheduleFees,0);assert.equal(q.refundableAmount,2900);
});
test('retained amounts cannot exceed remaining verified payments after previous refunds',async()=>{
  await fee(500);await db.query('insert into refund_requests values($1,3200,\'refunded\')',[reservation]);
  const q=await preview();assert.equal(q.netPaid,300);assert.equal(q.deduction,300);
  assert.equal(q.retainedRescheduleFees,300);assert.equal(q.retainedDeposit,0);assert.equal(q.refundableAmount,0);
});
test('new fees invalidate cancellation quotes and guest/resort authorization is preserved',async()=>{
  const original=await preview();await fee(500);assert.notEqual((await preview()).quote,original.quote);
  await assert.rejects(preview('resort'),/Cancellation permission required/);
});
