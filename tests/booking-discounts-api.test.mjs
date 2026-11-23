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
