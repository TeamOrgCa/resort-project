import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

function harness({ max = 5, used = 2, pending = 1, available = 2, error = null, activePromo = true } = {}) {
  const reads = [];
  const client = { from: table => {
    reads.push(table);
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: activePromo ? { code: "LIMIT5", discount_type: "percent", discount_value: 10, max_uses: max, usage_count: used, pending_uses: pending, remaining_uses: available } : null, error }) };
    return q;
  } };
  const { POST } = loadTsModule("app/api/promos/quote/route.ts", { "@/lib/supabase/admin": { createAdminClient: () => client } });
  return { reads, quote: code => POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ code }) })) };
}

test("customer quotes return current availability without reserving or consuming a use", async () => {
  const h = harness(); const response = await h.quote("limit5");
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual((await response.json()).promo, { code: "LIMIT5", discount_type: "percent", discount_value: 10, remainingUses: 2 });
  assert.deepEqual(h.reads, ["promo_code_availability"]);
  const unlimited = await harness({ max: null, available: null }).quote("LIMIT5");
  assert.equal((await unlimited.json()).promo.remainingUses, undefined);
});

test("exhausted codes and codes held by pending bookings have actionable customer messages", async () => {
  const exhausted = await harness({ used: 5, pending: 0, available: 0 }).quote("LIMIT5");
  assert.equal(exhausted.status, 409); assert.match((await exhausted.json()).message, /maximum number of successful reservations/);
  const held = await harness({ used: 2, pending: 3, available: 0 }).quote("LIMIT5");
  assert.equal(held.status, 409); assert.match((await held.json()).message, /held by pending bookings/);
  assert.equal((await harness({ activePromo: false }).quote("LIMIT5")).status, 400);
  assert.equal((await harness({ error: { code: "42P01" } }).quote("LIMIT5")).status, 503);
});

test("a last-slot conflict during reservation save remains a retryable conflict", async () => {
  const calls = [];
  const { applyNewBookingPromo, BookingPromoError } = loadTsModule("lib/server/booking-discounts.ts", {
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { error: { code: "40001", message: "This promo has no remaining uses" } }; } }) },
  });
  await assert.rejects(applyNewBookingPromo("booking", "owner", "LIMIT5", 10000, true, 9000), error => error instanceof BookingPromoError && error.status === 409);
  assert.equal(calls.length, 1); assert.equal(calls[0].name, "apply_new_booking_promo");
  assert.equal(calls[0].args.p_expected_net, 9000);
});
