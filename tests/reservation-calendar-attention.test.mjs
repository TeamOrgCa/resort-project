import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const { reservationAttention, calendarBookingKind } = loadTsModule("lib/booking/calendar-attention.ts");
const now = Date.parse("2026-10-15T16:30:00Z");
const reservation = { status: "confirmed", start_datetime: "2026-10-16T08:00:00+08:00", checked_in_at: null };
test("calendar distinguishes unpaid requests, confirmed stays and closed bookings", () => {
  for (const status of ["pending", "payment_submitted"]) assert.equal(calendarBookingKind(status), "booking");
  for (const status of ["confirmed", "reschedule_requested"]) assert.equal(calendarBookingKind(status), "reservation");
  for (const status of ["cancelled", "completed", "expired", "rejected"]) assert.equal(calendarBookingKind(status), "closed");
});
test("all five attention signals coexist on a confirmed reservation without replacing its status", () => {
  assert.deepEqual(reservationAttention(reservation, { payment: true, reschedule: true, refund: true, balance: 2400 }, now), ["payment", "reschedule", "refund", "balance", "arrival"]);
  assert.equal(reservation.status, "confirmed");
});
test("arrival uses Philippine dates and a recorded check-in removes only the arrival flag", () => {
  assert.deepEqual(reservationAttention(reservation, {}, now), ["arrival"]);
  assert.deepEqual(reservationAttention({ ...reservation, checked_in_at: "2026-10-16T08:05:00+08:00" }, { balance: 500 }, now), ["balance"]);
  assert.deepEqual(reservationAttention(reservation, {}, Date.parse("2026-10-16T16:00:00Z")), []);
});
test("cancelled bookings retain pending-refund flags but have no unpaid-stay or arrival flag", () => {
  assert.deepEqual(reservationAttention({ ...reservation, status: "cancelled" }, { refund: true, balance: 3000 }, now), ["refund"]);
  assert.deepEqual(reservationAttention({ ...reservation, status: "pending" }, { balance: 0 }, now), []);
});

const id = "11111111-1111-4111-8111-111111111111";
function harness({ active = true, allowed = true, error = null } = {}) {
  const calls = [];
  const route = loadTsModule("app/api/admin/reservations/check-in/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => active ? { supabase: {}, staffUser: { id: "staff", role: "staff" } } : null },
    "@/lib/server/role-permissions": { staffHasPermission: async () => allowed },
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { error }; } }) },
  });
  return { calls, post: (body = { reservationId: id, arrivalConfirmed: true }) => route.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) })) };
}
test("check-in rejects unauthorized staff and requires actual arrival acknowledgement", async () => {
  const inactive = harness({ active: false }); assert.equal((await inactive.post()).status, 401); assert.equal(inactive.calls.length, 0);
  const denied = harness({ allowed: false }); assert.equal((await denied.post()).status, 403); assert.equal(denied.calls.length, 0);
  const h = harness(); assert.equal((await h.post({ reservationId: id })).status, 400); assert.equal(h.calls.length, 0);
  assert.equal((await h.post({ reservationId: "bad", arrivalConfirmed: true })).status, 400);
  assert.equal((await h.post()).status, 200); assert.deepEqual(h.calls, [{ name: "check_in_reservation", args: { p_reservation: id, p_staff: "staff" } }]);
});
test("a check-in race returns conflict and a missing migration gives an actionable alert", async () => {
  assert.equal((await harness({ error: { code: "40001" } }).post()).status, 409);
  const response = await harness({ error: { code: "PGRST202" } }).post(); assert.equal(response.status, 500);
  assert.match((await response.json()).message, /migration/);
});
