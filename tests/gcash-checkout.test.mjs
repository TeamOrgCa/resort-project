import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const guest = "11111111-1111-4111-8111-111111111111";
const account = "22222222-2222-4222-8222-222222222222";
const body = { bookingMode: "day", packageRateVersion: 1, phoneNumber: "+639171234567", startDatetime: "2027-06-14T08:00:00+08:00", endDatetime: "2027-06-14T16:00:00+08:00", unitId: "unit", adultCount: 2, childCount: 0,
  payment: { paymentMethodId: "gcash", receivingAccountId: account, type: "downpayment", amount: 1500, referenceNumber: "1234-5678 90123", accountName: "Guest", accountNumber: "09171231234", proofPath: `${guest}/proof.png` } };
function harness({ status = "consistent", method = "GCash", insertError = null, notificationFails = false } = {}) {
  const writes = [], inspected = [], accountFilters = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: guest } }, error: null }) },
    from: table => {
      let operation = "select";
      const result = () => ({ error: null, data: table === "payment_methods" ? { name: method, type: "ewallet", is_active: true }
        : table === "payment_accounts" ? { account_name: "Displayed Resort Account", account_number: "09171231234" }
        : table === "units" ? { unit_id: "unit", base_price: 1, is_active: true, archived_at: null }
        : table === "reservations" && operation === "insert" ? { reservation_id: "reservation", reference_number: "MV-TEST", status: "pending", payment_deadline_at: new Date(Date.now() + 100000).toISOString() } : null });
      const query = { select: () => query, eq: (field, value) => { if (table === "payment_accounts") accountFilters.push({ field, value }); return query; }, not: () => query, order: () => query, limit: () => query,
        insert: payload => { operation = "insert"; writes.push({ table, operation, payload }); return query; },
        upsert: payload => { operation = "upsert"; writes.push({ table, operation, payload }); return query; },
        update: payload => { operation = "update"; writes.push({ table, operation, payload }); return query; },
        delete: () => { operation = "delete"; writes.push({ table, operation }); return query; },
        maybeSingle: async () => result(), single: async () => result(), then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject) };
      return query;
    },
  };
  const { POST } = loadTsModule("app/api/reservations/checkout/route.ts", {
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: table => ({ insert: payload => { writes.push({ table, operation: "insert", payload }); return { select: () => ({ single: async () => ({ error: insertError, data: insertError ? null : { payment_id: "payment", status: "pending", ocr_status: payload.ocr_status } }) }) }; } }) }) },
    "@/lib/server/reservation-availability": { checkReservationOverlap: async () => ({ conflict: false, error: null }) },
    "@/lib/server/package-rates": { loadQuotedPackageRates: async () => ({ version: 1, rates: {} }), PackageRatesError: class extends Error {} },
    "@/lib/booking/pricing": { computeBookingPricing: () => ({ total: 5000 }) },
    "@/lib/server/gcash-ocr": { inspectPaymentProof: async (_client, input) => { inspected.push(input); return { status, notes: "Checked", amount: input.amount, reference: input.reference, paidAt: "2026-10-13T01:00:00Z" }; } },
    "@/lib/notifications": { createNotifications: async () => { if (notificationFails) throw new Error("Unavailable"); return { error: null }; }, NOTIFICATION_AUDIENCES: { checkout: [] } },
  });
  return { writes, inspected, accountFilters, post: data => POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(data) })) };
}
test("legacy checkout enforces GCash and blocks all failed field checks before creating a booking", async () => {
  for (const [options, expected] of [[{ status: "mismatch" }, 422], [{ status: "unreadable" }, 422], [{ status: "not_applicable" }, 422], [{ status: "screening_unavailable" }, 503], [{ method: "Bank" }, 400]]) {
    const h = harness(options); assert.equal((await h.post(body)).status, expected); assert.equal(h.writes.length, 0);
  }
  const low = harness(); assert.equal((await low.post({ ...body, payment: { ...body.payment, amount: 999.99 } })).status, 400); assert.equal(low.writes.length, 0);
});
test("legacy checkout uses the displayed recipient account, server minimum and actual receipt amount", async () => {
  const h = harness(); const response = await h.post(body); assert.equal(response.status, 201);
  assert.ok(h.accountFilters.some(f => f.field === "account_id" && f.value === account));
  assert.equal(h.inspected[0].minimumAmount, 1000); assert.equal(h.inspected[0].recipientName, "Displayed Resort Account");
  const payment = h.writes.find(w => w.table === "payments").payload;
  assert.equal(payment.amount, 1500); assert.equal(payment.reference_number, "1234567890123"); assert.equal(payment.receipt_paid_at, "2026-10-13T01:00:00Z");
  assert.equal((await response.json()).payment.amount, 1500);
});

test("legacy checkout rejects alphanumeric GCash references without reading a receipt or creating records", async () => {
  for (const referenceNumber of ["ABC1234567890123", "123456789012A", "1e12345678"]) {
    const h = harness();
    const response = await h.post({ ...body, payment: { ...body.payment, referenceNumber } });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /numeric GCash reference/);
    assert.equal(h.inspected.length, 0); assert.equal(h.writes.length, 0);
  }
});
test("reference reuse cleans up only the newly created reservation and returns conflict", async () => {
  const h = harness({ insertError: { code: "23505", message: "Reference used" } });
  assert.equal((await h.post(body)).status, 409); assert.equal(h.writes.filter(w => w.operation === "delete").length, 1);
});
test("notification failure cannot roll back a saved checkout payment", async () => {
  const h = harness({ notificationFails: true }); assert.equal((await h.post(body)).status, 201);
  assert.equal(h.writes.filter(w => w.operation === "delete").length, 0);
});
