import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTsModule} from './helpers/load-ts-module.mjs';
const policy=loadTsModule('lib/booking/public-swimming.ts');

test('public window uses Manila calendar days across midnight, leap days and year changes',()=>{
 for(const [now,expected] of [
  ['2030-11-24T15:59:59Z',['2030-11-24','2030-11-25','2030-11-26']],
  ['2030-11-24T16:00:00Z',['2030-11-25','2030-11-26','2030-11-27']],
  ['2028-02-28T00:00:00+08:00',['2028-02-28','2028-02-29','2028-03-01']],
  ['2030-12-31T00:00:00+08:00',['2030-12-31','2031-01-01','2031-01-02']],
 ])assert.deepEqual(policy.publicSwimmingDates(new Date(now)),expected);
});

test('public one-hour lead applies to absolute instants with inclusive cutoffs',()=>{
 const day='2030-11-25T08:00:00+08:00',night='2030-11-25T18:00:00+08:00';
 assert.equal(policy.isPublicSwimmingStartAllowed(day,Date.parse('2030-11-25T07:00:00+08:00')),true);
 assert.equal(policy.isPublicSwimmingStartAllowed(day,Date.parse('2030-11-25T07:00:00.001+08:00')),false);
 assert.equal(policy.isPublicSwimmingStartAllowed(night,Date.parse('2030-11-25T17:00:00+08:00')),true);
 assert.equal(policy.isPublicSwimmingStartAllowed(night,Date.parse('2030-11-25T17:00:00.001+08:00')),false);
 assert.equal(policy.isPublicSwimmingStartAllowed('invalid'),false);
});

test('date labels keep a date bookable when either session is eligible and distinguish unavailable reasons',()=>{
 const day={eligibility:'eligible',availability:'available',remainingCapacity:20},night={...day};
 assert.equal(policy.publicSwimmingDateLabel([day,night]),'Available');
 assert.equal(policy.publicSwimmingDateLabel([{...day,eligibility:'cutoff'},night]),'Partially Available');
 assert.equal(policy.publicSwimmingDateLabel([day,{...night,availability:'private'}]),'Partially Available');
 for(const [patch,expected] of [
  [{eligibility:'past'},'Past Date'],[{eligibility:'not_open'},'Not Yet Open for Booking'],
  [{eligibility:'cutoff'},'Booking Cutoff Passed'],[{availability:'private'},'Unavailable — Private Reservation'],
  [{availability:'maintenance'},'Unavailable — Maintenance'],[{availability:'full',remainingCapacity:0},'Fully Booked'],
 ]) assert.equal(policy.publicSwimmingDateLabel([{...day,...patch},{...night,...patch}]),expected);
});
