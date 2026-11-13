import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const { reservationAttention, calendarBookingKind } = loadTsModule("lib/booking/calendar-attention.ts");
const reservation = { status: "confirmed", start_datetime: "2026-10-16T08:00:00+08:00", checked_in_at: null };
test("calendar distinguishes pending payments, paid reservations including completed stays, and closed bookings", () => {
  for (const status of ["pending", "payment_submitted"]) assert.equal(calendarBookingKind(status), "booking");
  for (const status of ["confirmed", "reschedule_requested", "completed"]) assert.equal(calendarBookingKind(status), "reservation");
  for (const status of ["cancelled", "expired", "rejected", "no_show"]) assert.equal(calendarBookingKind(status), "closed");
});

test("verified payments retain reservation classification during later payment reviews and unpaid reschedules remain bookings", () => {
  assert.equal(calendarBookingKind("payment_submitted", 600), "reservation");
  assert.equal(calendarBookingKind("payment_submitted", 0), "booking");
  assert.equal(calendarBookingKind("reschedule_requested", 0), "booking");
  assert.equal(calendarBookingKind("reschedule_requested", 600), "reservation");
  assert.equal(calendarBookingKind("cancelled", 600), "closed");
});
test("only refunds need attention on an active reservation, independent of payment and arrival signals", () => {
  assert.deepEqual(reservationAttention(reservation, { payment: true, reschedule: true, refund: true, balance: 2400 }), ["refund"]);
  assert.equal(reservation.status, "confirmed");
});
test("unpaid balances, pending payments, reschedules and arrivals do not create attention flags", () => {
  for (const status of ["pending", "payment_submitted", "confirmed", "reschedule_requested", "completed", "rejected"]) {
    assert.deepEqual(reservationAttention({ ...reservation, status }, { payment: true, reschedule: true, balance: 500 }), []);
  }
});
test("cancellations need attention even without an outstanding refund", () => {
  assert.deepEqual(reservationAttention({ status: "cancelled" }, { refund: true, balance: 3000 }), ["cancelled", "refund"]);
  assert.deepEqual(reservationAttention({ status: "cancelled" }), ["cancelled"]);
});

test("no-shows need attention and calendar colors preserve saved booking and reservation colors", () => {
  assert.deepEqual(reservationAttention({ status: "no_show" }, { balance: 3000 }), ["no_show"]);
  const { readCalendarColors } = loadTsModule("lib/booking/calendar-appearance.ts");
  assert.equal(readCalendarColors({ confirmed: "#123456", pending: "#654321", no_show: "#ffffff" }).confirmed, "#123456");
  assert.equal(readCalendarColors({ pending: "#654321" }).pending, "#654321");
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
