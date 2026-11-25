import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";
const id = "11111111-1111-4111-8111-111111111111";
function staffRoute({ role = "staff", permissions = ["edit_reservation"], authenticated = true, rpcError = null, emailFails = false } = {}) {
  const calls = [];
  const route = loadTsModule("app/api/admin/booking-discounts/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => authenticated ? { staffUser: { role, id: "real-staff" }, supabase: {} } : null },
    "@/lib/server/role-permissions": { staffHasPermission: async (_client, r, permission) => r === "admin" || permissions.includes(permission) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { error: rpcError, data: { totalAmount: 10000, remainingBalance: 5000 } }; } }) },
    "@/lib/server/reservation-editor": { loadReservationEditor: async () => ({ reservation: { booking_mode: "day", start_datetime: "2027-06-14T00:00:00Z", end_datetime: "2027-06-14T08:00:00Z", adult_count: 15, child_count: 5 }, packageRates: legacyRates, bill: { total_amount: 11000, paid_amount: 5000 }, lockedReason: null }) },
    "@/lib/server/billing-email": { emailUpdatedBillingStatement: async () => { if (emailFails) throw Error("Unavailable"); return { sent: true }; } },
  });
  return { calls, post: body => route.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) })), get: () => route.GET(new Request(`http://localhost?reservationId=${id}`)) };
}
const request = { reservationId: id, eligibleGuests: 4, promoCode: "SAVE10", expectedTotal: 11000, reason: "Verified eligibility" };
test("manager and cashier discounts enforce role permissions and use the authenticated actor", async () => {
  for (const options of [{ authenticated: false }, { permissions: [] }, { role: "cashier", permissions: ["payment_entry"] }]) {
    const h = staffRoute(options); assert.equal((await h.post(request)).status, 403); assert.equal(h.calls.length, 0);
  }
  for (const options of [{}, { role: "admin", permissions: [] }, { role: "cashier", permissions: ["transactions", "payment_entry"] }]) {
    const h = staffRoute(options); assert.equal((await h.post({ ...request, actorId: "forged", discountAmount: 100000 })).status, 200);
    assert.equal(h.calls[0].name, "set_booking_discount"); assert.equal(h.calls[0].args.p_actor, "real-staff");
    assert.equal(h.calls[0].args.p_eligible, 4); assert.equal(h.calls[0].args.p_guest, false);
    assert.equal(h.calls[0].args.discountAmount, undefined);
  }
});
test("discount quotes use total head count and booked package rates; malformed counts cannot reach billing", async () => {
  const h = staffRoute(); const response = await h.get(); const detail = await response.json();
  assert.equal(detail.headCount, 20); assert.equal(detail.packagePrice, 7500); assert.equal(response.headers.get("Cache-Control"), "no-store");
  for (const eligibleGuests of [-1, 1.5, "2", 31, null]) assert.equal((await h.post({ ...request, eligibleGuests })).status, 400);
  assert.equal(h.calls.length, 0);
});

function transactionDiscountRoute({ reservation = {}, bill = {}, pendingPayment = false, roomCharges = [] } = {}) {
  const reads = [], packageReads = [];
  const source = {
    reservations: { reservation_id: id, reference_number: 'PS-TEST', commercial_type: 'public_swimming', room_pricing: false,
      public_admission_amount: '420.00', public_pricing_snapshot: { adult_rate: 150, child_rate: 120 }, package_rate_version: null,
      booking_mode: 'night', start_datetime: '2030-11-25T18:00:00+08:00', end_datetime: '2030-11-25T23:00:00+08:00',
      adult_count: 2, child_count: 1, status: 'confirmed', guest_id: null, walk_in_guest_id: null, updated_at: '2030-11-01T00:00:00Z', ...reservation },
    transactions: { total_amount: '620.00', paid_amount: '0.00', status: 'unpaid', discount_amount: 0, ...bill },
    reservation_services: [], reservation_units: [], services: [], units: [], reservation_reschedules: [],
    payments: pendingPayment ? [{ payment_id: 'pending-proof' }] : [], room_charges: roomCharges,
  };
  const admin = { from: table => {
    reads.push(table);
    const result = { data: source[table], error: null };
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => result, then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
    return q;
  } };
  // Exercise the real shared reservation loader, rather than mocking away its
  // former dependency on private package_rate_version for public admissions.
  const route = loadTsModule('app/api/admin/booking-discounts/route.ts', {
    '@/lib/server/admin-audit': { requireActiveStaff: async () => ({ staffUser: { role: 'staff', id: 'manager' }, supabase: {} }) },
    '@/lib/server/role-permissions': { staffHasPermission: async () => true },
    '@/lib/supabase/admin': { createAdminClient: () => admin },
    '@/lib/server/package-rates': { loadPackageRates: async (_db, version) => { packageReads.push(version); return { rates: legacyRates }; } },
    '@/lib/server/billing-email': {},
  });
  return { reads, packageReads, get: () => route.GET(new Request('http://localhost?reservationId='+id)) };
}

test('transaction discounts load public admission without a private rate version or room-charge basis', async () => {
  for (const package_rate_version of [null, 1]) {
    const h = transactionDiscountRoute({ reservation: { package_rate_version } });
    const response = await h.get(), detail = await response.json();
    assert.equal(response.status, 200); assert.equal(detail.packagePrice, 420); assert.equal(detail.headCount, 3);
    assert.equal(detail.packagePriceLabel, 'Public swimming admission'); assert.equal(detail.locked, false);
    assert.equal(detail.bill.total_amount, 620); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(h.packageReads, []); assert.ok(!h.reads.includes('room_charges'));
  }
});

test('paid swimming room choices lock legacy editors while staff can still verify admission discounts',async()=>{
 const reservation={swimming_room_choices:[{classificationId:'standard',quantity:1,pricingVersion:1}]};
 const response=await transactionDiscountRoute({reservation,bill:{total_amount:1320}}).get(),detail=await response.json();
 assert.equal(response.status,200);assert.equal(detail.packagePrice,420);assert.equal(detail.locked,false);
 const held=await (await transactionDiscountRoute({reservation,pendingPayment:true}).get()).json();assert.equal(held.locked,true);
});

test('public discount loading retains review locks and rejects missing admission instead of inventing a zero basis', async () => {
  const locked = await (await transactionDiscountRoute({ pendingPayment: true }).get()).json();
  assert.equal(locked.packagePrice, 420); assert.equal(locked.locked, true);
  for (const public_admission_amount of [null, undefined, -1, 'invalid']) {
    const response = await transactionDiscountRoute({ reservation: { public_admission_amount } }).get();
    assert.equal(response.status, 503); assert.match((await response.json()).message, /saved public swimming admission amount/);
  }
});

test('room-priced public records use accommodation charges and private bookings still require their historical version', async () => {
  const room = transactionDiscountRoute({ reservation: { room_pricing: true, package_rate_version: 1 }, roomCharges: [{ amount: '300.00' }, { amount: '150.00' }] });
  const response = await room.get(), detail = await response.json();
  assert.equal(response.status, 200); assert.equal(detail.packagePrice, 450); assert.equal(detail.packagePriceLabel, 'Accommodation');
  assert.ok(room.reads.includes('room_charges'));
  const privateMissing = transactionDiscountRoute({ reservation: { commercial_type: 'private_swimming', package_rate_version: null } });
  assert.equal((await privateMissing.get()).status, 503); assert.deepEqual(privateMissing.packageReads, []);
});

test('public bill edits use the saved admission rates without private rates while private edits reject missing rates', () => {
  const { previewReservationEdit } = loadTsModule('lib/booking/reservation-edit.ts');
  const r = { commercial_type: 'public_swimming', public_admission_amount: 420, public_pricing_snapshot: { adult_rate: 150, child_rate: 120 },
    booking_mode: 'day', start_datetime: '2030-11-25T08:00:00+08:00', end_datetime: '2030-11-25T16:00:00+08:00', adult_count: 2, child_count: 1 };
  const edit = { bookingMode: 'day', startDatetime: r.start_datetime, endDatetime: r.end_datetime, adultCount: 3, childCount: 1, services: [] };
  const preview = previewReservationEdit(r, { total_amount: 420, paid_amount: 0 }, [], [], edit, null);
  assert.equal(preview.total, 570); assert.equal(preview.packageDelta, 150);
  assert.throws(() => previewReservationEdit({ ...r, commercial_type: 'private_swimming' }, { total_amount: 420, paid_amount: 0 }, [], [], edit, null), /private package rates are missing/);
});
test("stale bills, forbidden actions and bad discounts are reported without claiming success", async () => {
  for (const [code, status] of [["40001", 409], ["42501", 403], ["22023", 400], ["PGRST202", 503]]) {
    assert.equal((await staffRoute({ rpcError: { code, message: "Denied" } }).post(request)).status, status);
  }
  const h = staffRoute({ emailFails: true }); const response = await h.post(request);
  assert.equal(response.status, 200); assert.equal((await response.json()).billingEmail.sent, false); assert.equal(h.calls.length, 1);
});

test("refund payment details are submitted through the owner-checked RPC with no supplied guest identity", async () => {
  const calls = [];
  const { PATCH } = loadTsModule("app/api/reservations/refund/route.ts", {
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) }, rpc: async (name, args) => { calls.push({ name, args }); return { error: null }; } }) },
    "@/lib/notifications": {},
  });
  const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ refundId: id, method: "GCash", accountName: " Guest Name ", accountNumber: "09171234567", guestId: "forged" }) }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ name: "submit_refund_destination", args: { p_refund: id, p_method: "GCash", p_name: "Guest Name", p_number: "09171234567" } }]);
});

test("discount previews handle guest-share rounding, promo comparison and edits without accumulation", () => {
  const { calculateBookingDiscount } = loadTsModule("lib/booking/discounts.ts");
  assert.equal(calculateBookingDiscount(10000, 20, 5).amount, 500);
  assert.equal(calculateBookingDiscount(10000, 20, 5, { code: "PROMO", discount_type: "percent", discount_value: 10 }).amount, 1000);
  assert.equal(calculateBookingDiscount(10000, 20, 15, { code: "PROMO", discount_type: "fixed", discount_value: 1000 }).amount, 1500);
  assert.equal(calculateBookingDiscount(10000, 3, 1).amount, 666.67);
  assert.equal(calculateBookingDiscount(0.15, 2, 1).amount, 0.02);
  assert.equal(calculateBookingDiscount(100.05, 20, 0, { code: "PROMO", discount_type: "percent", discount_value: 10 }).amount, 10.01);
  assert.throws(() => calculateBookingDiscount(10000, 20, 21));
  const { previewReservationEdit } = loadTsModule("lib/booking/reservation-edit.ts");
  const r = { booking_mode: "day", start_datetime: "2027-06-14T00:00:00Z", end_datetime: "2027-06-14T08:00:00Z", adult_count: 20, child_count: 0 };
  const next = { bookingMode: "day", startDatetime: r.start_datetime, endDatetime: r.end_datetime, adultCount: 10, childCount: 0, services: [] };
  const preview = previewReservationEdit(r, { total_amount: 7125, paid_amount: 7500, discount_amount: 375, discount_eligible_guests: 5 }, [], [], next, legacyRates);
  assert.equal(preview.discountAmount, 750); assert.equal(preview.total, 6750); assert.equal(preview.overpaid, 750);
  assert.throws(() => previewReservationEdit(r, { total_amount: 7125, paid_amount: 7500, discount_amount: 375, discount_eligible_guests: 5 }, [], [], { ...next, adultCount: 4 }, legacyRates));
});
