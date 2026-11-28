import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";

function loader(pending = false) {
  const data = {
    reservations: { reservation_id: "booking", commercial_type: "private_swimming", room_pricing: false, status: "confirmed", package_rate_version: 1, adult_count: 20, child_count: 0,
      start_datetime: "2030-06-01T08:00:00+08:00", end_datetime: "2030-06-01T16:00:00+08:00", swimming_room_choices: [{ classificationId: "room", quantity: 1, pricingVersion: 1, occupants: 2, durationHours: 3 }] },
    transactions: { total_amount: 10300, paid_amount: 2000 }, reservation_services: [], reservation_units: [], services: [], units: [], payments: pending ? [{ payment_id: "review" }] : [], reservation_reschedules: [],
  };
  const db = { from(table) { const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: data[table], error: null }), then: resolve => resolve({ data: data[table], error: null }) }; return q; } };
  return loadTsModule("lib/server/reservation-editor.ts", {
    "@/lib/supabase/admin": { createAdminClient: () => db },
    "@/lib/server/package-rates": { loadPackageRates: async () => ({ rates: legacyRates }) },
  }).loadReservationEditor;
}

test("guest swimming editors allow paid room add-ons while retaining review locks and the saved bill", async () => {
  const load = loader(), guest = await load("booking", { allowSwimmingRooms: true }), staff = await load("booking");
  assert.equal(guest.lockedReason, null); assert.equal(guest.canChangeDetails, true); assert.equal(guest.bill.total_amount, 10300);
  assert.match(staff.lockedReason, /paid room add-ons/);
  const reviewed = await loader(true)("booking", { allowSwimmingRooms: true });
  assert.match(reviewed.lockedReason, /pending payment/); assert.equal(reviewed.canChangeDetails, false);
});
