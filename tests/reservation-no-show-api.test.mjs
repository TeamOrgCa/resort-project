import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const id = "11111111-1111-4111-8111-111111111111";
function harness({ role = "staff", signedIn = true, allowed = true, error = null, missingResult = false } = {}) {
  const calls = [];
  const { POST } = loadTsModule("app/api/admin/reservations/no-show/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => signedIn ? { staffUser: { id: "authenticated-manager", role }, supabase: {} } : null },
    "@/lib/server/role-permissions": { staffHasPermission: async () => allowed },
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: error || missingResult ? null : { reservation_id: id, status: "no_show" }, error }; } }) },
  });
  return { calls, post: (body = { reservationId: id, reason: "Guest did not arrive", noShowConfirmed: true }) => POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) })) };
}

test("only authenticated managers with reservation-edit permission can mark a no-show", async () => {
  for (const [options, status] of [[{ signedIn: false }, 401], [{ role: "admin" }, 403], [{ role: "cashier" }, 403], [{ allowed: false }, 403]]) {
    const h = harness(options); assert.equal((await h.post()).status, status); assert.equal(h.calls.length, 0);
  }
  const h = harness(); const response = await h.post({ reservationId: id, reason: "  Guest did not arrive  ", noShowConfirmed: true, staffId: "forged", no_show_at: "1900-01-01", amount: 0 });
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls, [{ name: "mark_reservation_no_show", args: { p_reservation: id, p_staff: "authenticated-manager", p_reason: "Guest did not arrive" } }]);
});

test("a no-show needs a valid reservation, explicit acknowledgement and a meaningful bounded reason", async () => {
  for (const body of [null, {}, { reservationId: id, reason: "Guest absent" }, { reservationId: "bad", reason: "Guest absent", noShowConfirmed: true },
    ...[null, " ", "four", "A".repeat(2001)].map(reason => ({ reservationId: id, reason, noShowConfirmed: true }))]) {
    const h = harness(); assert.equal((await h.post(body)).status, 400); assert.equal(h.calls.length, 0);
  }
});

test("no-show API reports timing/attendance conflicts, missing records and migration requirements", async () => {
  for (const [code, status] of [["42501", 403], ["P0002", 404], ["40001", 409], ["23514", 409], ["22023", 400], ["PGRST202", 503]]) {
    const h = harness({ error: { code, message: "The scheduled stay has not ended." } }); const response = await h.post();
    assert.equal(response.status, status);
    if (code === "PGRST202") assert.match((await response.json()).message, /reservation-no-show-migration/);
  }
  assert.equal((await harness({ missingResult: true }).post()).status, 503);
});

test("the no-show API uses reservation-edit middleware permission rather than admin-only user access", () => {
  const { apiPermission, isAdminReadOnlyRequest } = loadTsModule("lib/auth/role-access.ts");
  assert.equal(apiPermission("/api/admin/reservations/no-show", "POST"), "edit_reservation");
  assert.equal(isAdminReadOnlyRequest("admin", "/api/admin/reservations/no-show", "POST"), true);
});
