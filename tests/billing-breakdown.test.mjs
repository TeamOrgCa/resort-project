import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const { buildBillingBreakdown } = loadTsModule("lib/booking/billing-breakdown.ts");

const booking = {
  bookingMode: "day",
  startDatetime: "2026-10-10T00:00:00+08:00",
  endDatetime: "2026-10-10T08:00:00+08:00",
  adultCount: 2,
  childCount: 0,
  adultRate: 100,
  childRate: 0,
  units: [{ name: "Pool Villa", quantity: 1, pricePerPeriod: 7500 }],
  services: [{ name: "Extra mattress", quantity: 2, priceAtBooking: 300 }],
};

test("room accommodation, extra guests and extension charges reconcile with the existing bill", () => {
  const result = buildBillingBreakdown({ ...booking, units: [], services: [], adultRate: null,
    roomCharges: [{ description: "F01 accommodation", amount: 1500 }, { description: "F01 additional guests", amount: 400 }, { description: "F01 extension (2 hours)", amount: 200 }],
    recordedTotal: 2100,
  });
  assert.equal(result.total, 2100);
  assert.equal(result.lines.length, 3);
  assert.equal(result.lines.reduce((sum, line) => sum + line.amount, 0), 2100);
  assert.ok(result.lines.some(line => line.description.includes("extension") && line.amount === 200));
});

test('historical room descriptions display clean hour durations in receipts without changing the saved charges or totals',()=>{
  const roomCharges=[{description:'S03 - extra Standard Rooms for swimming session (5.0000000000000000 hours)',amount:900},
    {description:'S04 - extra Standard Rooms for swimming session (5.2500000000000000 hours)',amount:900}];
  const result=buildBillingBreakdown({...booking,units:[],services:[],adultRate:null,roomCharges,recordedTotal:1800});
  assert.deepEqual(result.lines.map(line=>line.description),['S03 - extra Standard Rooms for swimming session (5 hours)','S04 - extra Standard Rooms for swimming session (5.25 hours)']);
  assert.equal(result.total,1800);assert.equal(result.lines.reduce((sum,line)=>sum+line.amount,0),1800);
  assert.match(roomCharges[0].description,/5\.0000000000000000 hours/);
});

test("hourly service statements show rental hours and multiply the hourly rate", () => {
  const result = buildBillingBreakdown({ ...booking, services: [{ name: "Karaoke", quantity: 3, priceAtBooking: 200, billingType: "duration" }], recordedTotal: 8300 });
  const line = result.lines.find(line => line.description === "Karaoke");
  assert.equal(line.quantity, 3); assert.equal(line.unitPrice, 200); assert.equal(line.amount, 600);
  assert.match(line.detail, /Duration \(Hours\): 3; charged per hour/);
});

test("shows stored unit, guest, and service charges when they match the bill", () => {
  const breakdown = buildBillingBreakdown({ ...booking, recordedTotal: 8300 });
  assert.deepEqual(breakdown.lines.map(({ description, amount }) => [description, amount]), [
    ["Pool Villa", 7500],
    ["Adult guest charges", 200],
    ["Extra mattress", 600],
  ]);
  assert.equal(breakdown.lines.reduce((sum, line) => sum + line.amount, 0), breakdown.total);
});

test("uses the recorded package amount when snapshot rates do not match the bill", () => {
  const breakdown = buildBillingBreakdown({ ...booking, recordedTotal: 8000 });
  assert.equal(breakdown.lines[0].description, "Private pool package and guest charges");
  assert.match(breakdown.lines[0].detail, /Pool Villa/);
  assert.deepEqual(breakdown.lines.map(({ amount }) => amount), [7400, 600]);
  assert.equal(breakdown.lines.reduce((sum, line) => sum + line.amount, 0), breakdown.total);
});

test("the winning discount is itemized and the bill still reconciles with services and fees", () => {
  const result = buildBillingBreakdown({ ...booking, recordedTotal: 8500, rescheduleFees: 500, dateRateAdjustment: 200, discountAmount: 500, discountKind: "pwd_senior" });
  assert.equal(result.lines.at(-1).kind, "discount");
  assert.equal(result.lines.at(-1).amount, -500);
  assert.equal(result.lines.reduce((sum, line) => sum + line.amount, 0), 8500);
  assert.doesNotMatch(result.lines[0].detail, /adults|children/);
});

test("uses the booking period count for longer stays", () => {
  const breakdown = buildBillingBreakdown({
    ...booking,
    endDatetime: "2026-10-11T16:00:00+08:00",
    recordedTotal: 16000,
  });
  assert.deepEqual(breakdown.lines.map(({ amount }) => amount), [15000, 400, 600]);
  assert.equal(breakdown.total, 16000);
});

test("the winning promo includes its saved code and rate without listing the competing PWD discount", () => {
  const result = buildBillingBreakdown({ ...booking, recordedTotal: 7000, discount: {
    amount: 1000, kind: "promo", promoCode: "SAVE10", promoType: "percent", promoValue: 10,
    headCount: 10, eligibleGuests: 2, packagePrice: 10000,
  } });
  const line = result.lines.find(line => line.kind === "discount");
  assert.equal(line.description, "Promo discount (SAVE10)"); assert.match(line.detail, /10% off the package price/);
  assert.doesNotMatch(line.detail, /2 of 10|PWD/); assert.equal(line.amount, -1000);
  assert.equal(result.lines.reduce((sum, line) => sum + line.amount, 0), 7000);
});

test("PWD statements show the eligible headcount and proportional calculation", () => {
  const result = buildBillingBreakdown({ ...booking, recordedTotal: 7600, discount: {
    amount: 400, kind: "pwd_senior", promoCode: "SMALL", promoType: "fixed", promoValue: 100,
    headCount: 10, eligibleGuests: 2, packagePrice: 10000,
  } });
  const line = result.lines.find(line => line.kind === "discount");
  assert.match(line.description, /PWD \/ senior discount \(20%\)/); assert.match(line.detail, /2 of 10 guests eligible/);
  assert.match(line.detail, /10,000\.00.*\/ 10 guests x 20% x 2/); assert.doesNotMatch(line.description + line.detail, /SMALL/);
});

test("reschedule fees and date-rate adjustments are separate additions, not hidden in package charges", () => {
  const breakdown = buildBillingBreakdown({ ...booking, recordedTotal: 9000, rescheduleFees: 500, dateRateAdjustment: 200 });
  assert.deepEqual(breakdown.lines.map(({ description, amount }) => [description, amount]), [
    ["Pool Villa", 7500], ["Adult guest charges", 200], ["Extra mattress", 600],
    ["Reschedule fees (non-refundable)", 500], ["Higher-date-rate adjustments", 200],
  ]);
  const fallback = buildBillingBreakdown({ ...booking, recordedTotal: 8700, rescheduleFees: 500, dateRateAdjustment: 200 });
  assert.deepEqual(fallback.lines.map(line => line.amount), [7400, 600, 500, 200]);
  assert.equal(fallback.lines.reduce((sum, line) => sum + line.amount, 0), fallback.total);
});
