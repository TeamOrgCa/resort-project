import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const { positiveRateAdjustment, rescheduleNoticeFee, reschedulePolicy } = loadTsModule("lib/booking/reschedule-charge-policy.ts");

test("notice fee follows the original booking's remaining notice", () => {
  const originalStart = "2026-10-20T08:00:00+08:00";
  const start = Date.parse(originalStart);
  assert.equal(rescheduleNoticeFee(originalStart, start - 6 * 86_400_000), 50);
  assert.equal(rescheduleNoticeFee(originalStart, start - 3 * 86_400_000), 100);
  assert.equal(rescheduleNoticeFee(originalStart, start - 2 * 86_400_000), 300);
  assert.equal(rescheduleNoticeFee(originalStart, start - 2 * 3_600_000), 500);
});

test("higher chosen-date rates add a charge without creating an automatic refund", () => {
  assert.equal(positiveRateAdjustment(7500, 8000), 500);
  assert.equal(positiveRateAdjustment(8000, 7500), 0);
});


test("peak notice is 14 days in March-May and September-December; other months require 7", () => {
  for (let month=1;month<=12;month++) {
    const date=`2027-${String(month).padStart(2,"0")}-20T08:00:00+08:00`;
    const required=[3,4,5,9,10,11,12].includes(month)?14:7;
    const accepted=reschedulePolicy(date,Date.parse(date)-required*86400000);
    assert.equal(accepted.minimumNoticeDays,required);assert.equal(accepted.allowed,true);
    assert.equal(reschedulePolicy(date,Date.parse(date)-(required-1)*86400000).allowed,false);
  }
});

test("fees and deadlines use Philippine calendar days, including same-day and past-date notices",()=>{
  const original="2027-10-20T08:00:00+08:00";
  for(const [notice,fee] of [[20,50],[14,50],[6,50],[5,100],[4,100],[3,100],[2,300],[1,300],[0,500],[-1,500]]) {
    assert.equal(rescheduleNoticeFee(original,Date.parse(original)-notice*86400000),fee);
  }
  assert.equal(rescheduleNoticeFee(original,Date.parse("2027-10-19T23:59:59+08:00")),300);
  assert.equal(rescheduleNoticeFee(original,Date.parse("2027-10-20T00:00:00+08:00")),500);
  assert.equal(reschedulePolicy(original,Date.parse("2027-10-06T23:59:59+08:00")).allowed,true);
  assert.equal(reschedulePolicy(original,Date.parse("2027-10-07T00:00:00+08:00")).allowed,false);
});
