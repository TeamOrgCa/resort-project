import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { dashboardDatabase } from "./helpers/dashboard-database.mjs";

const id = "11111111-1111-4111-8111-111111111111";
function harness({ signedIn = true, allowed = true, error = null, notificationFails = false, already = false } = {}) {
  const calls = [], notifications = [];
  const mocks = {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => signedIn ? { supabase: {}, staffUser: { id, role: "staff" } } : null },
    "@/lib/server/role-permissions": { staffHasPermission: async () => allowed },
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (name, args) => {
      calls.push({ name, args }); return { data: error ? null : { reservation_id: id, visit_id: id, guest_id: id, reference_number: "MV-TEST", scheduled_date: "2026-12-01", status: name === "check_out_reservation" ? "completed" : args.p_action === "reject" ? "rejected" : "confirmed", alreadyCheckedOut: already, alreadyReviewed: already }, error };
    }, from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { email: "guest@example.com", first_name: "Guest" } }) }; return q; } }) },
    "@/lib/notifications": { createNotifications: async data => { notifications.push(data); if (notificationFails) throw new Error("Offline"); return { error: null }; } },
    "@/lib/email": { sendOcularVisitReviewedEmail: async () => true },
  };
  return { calls, notifications, route: filename => loadTsModule(filename, mocks) };
}
const request = body => new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("checkout requires staff authorization, reservation-edit permission and an explicit departure acknowledgement", async () => {
  for (const [options, status] of [[{ signedIn: false }, 401], [{ allowed: false }, 403], [{}, 400]]) {
    const h = harness(options), response = await h.route("app/api/admin/reservations/check-out/route.ts").POST(request({ reservationId: id }));
    assert.equal(response.status, status); assert.equal(h.calls.length, 0);
  }
});

test("checkout surfaces unpaid-balance conflicts and does not notify or claim completion", async () => {
  const h = harness({ error: { code: "40001", message: "Settle the full reservation bill before checkout" } });
  const response = await h.route("app/api/admin/reservations/check-out/route.ts").POST(request({ reservationId: id, departureConfirmed: true }));
  assert.equal(response.status, 409); assert.match((await response.json()).message, /Settle/); assert.equal(h.notifications.length, 0);
});

test("a completed checkout is not undone by notification delivery failure and replay skips duplicate notifications", async () => {
  for (const already of [false, true]) {
    const h = harness({ notificationFails: true, already });
    const response = await h.route("app/api/admin/reservations/check-out/route.ts").POST(request({ reservationId: id, departureConfirmed: true }));
    const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.reservation.status, "completed");
    assert.equal(h.calls[0].name, "check_out_reservation"); assert.equal(h.calls[0].args.p_staff, id);
    assert.equal(h.notifications.length, already ? 0 : 1); if (!already) assert.equal(data.notificationSent, false);
  }
});

test("both ocular decisions require a reason, use the guarded RPC and notify the guest of the saved outcome", async () => {
  for (const action of ["approve", "reject"]) {
    const h = harness(), route = h.route(`app/api/admin/ocular-visits/${action}/route.ts`);
    assert.equal((await route.POST(request({ visitId: id }))).status, 400); assert.equal(h.calls.length, 0);
    const response = await route.POST(request({ visitId: id, reviewReason: "Requested schedule was reviewed" }));
    assert.equal(response.status, 200); assert.equal(h.calls[0].args.p_action, action);
    assert.match(h.notifications[0].message, /Requested schedule was reviewed/);
  }
  const denied = harness({ allowed: false }); assert.equal((await denied.route("app/api/admin/ocular-visits/reject/route.ts").POST(request({ visitId: id, reviewReason: "Not available" }))).status, 403); assert.equal(denied.calls.length, 0);
});

test("ocular review conflicts stay actionable and notification failure does not turn a saved decision into an error", async () => {
  const conflict = harness({ error: { code: "40001", message: "This visit was already reviewed" } });
  assert.equal((await conflict.route("app/api/admin/ocular-visits/reject/route.ts").POST(request({ visitId: id, reviewReason: "Schedule unavailable" }))).status, 409);
  assert.equal(conflict.notifications.length, 0);
  const saved = harness({ notificationFails: true });
  const response = await saved.route("app/api/admin/ocular-visits/reject/route.ts").POST(request({ visitId: id, reviewReason: "Schedule unavailable" }));
  const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.success, true); assert.equal(data.notificationSent, false);
});

test("one permission save validates both roles before a single atomic upsert", async () => {
  const writes = [], audits = [];
  const { PUT } = loadTsModule("app/api/admin/permissions/route.ts", {
    "@/lib/server/admin-audit": { requireAdminStaff: async () => ({ staffUser: { id } }), createAuditLog: async (_staff, data) => audits.push(data) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: () => ({ upsert: async rows => { writes.push(rows); return { error: null }; } }) }) },
  });
  const roles = [{ role: "staff", permissions: ["reservations", "edit_reservation"] }, { role: "cashier", permissions: ["transactions"] }];
  assert.equal((await PUT(request({ roles: [roles[0], { role: "cashier", permissions: ["users"] }] }))).status, 400); assert.equal(writes.length, 0);
  assert.equal((await PUT(request({ roles }))).status, 200); assert.equal(writes.length, 1); assert.equal(writes[0].length, 2); assert.equal(audits.length, 1);
});

test("review eligibility exposes only an active guest's own completed stays", async () => {
  for (const ownCompleted of [false, true]) {
    const db = dashboardDatabase({ guests: [{ id, is_active: true }], reservations: [
      { reservation_id: "pending", guest_id: id, status: "confirmed" },
      { reservation_id: "other", guest_id: "someone-else", status: "completed", reference_number: "PRIVATE" },
      ...(ownCompleted ? [{ reservation_id: "own", guest_id: id, status: "completed", reference_number: "MV-OWN", end_datetime: "2026-10-17T00:00:00Z" }] : []),
    ] });
    db.client.auth.getUser = async () => ({ data: { user: { id } } });
    const { GET } = loadTsModule("app/api/reviews/eligibility/route.ts", { "@/lib/supabase/server": { createClient: async () => db.client } });
    const response = await GET(), data = await response.json();
    assert.equal(data.eligible, ownCompleted); assert.equal(data.reservations.length, ownCompleted ? 1 : 0);
    assert.equal(JSON.stringify(data).includes("PRIVATE"), false); assert.match(response.headers.get("cache-control"), /no-store/);
  }
});

test("review eligibility fails closed when completed-stay records cannot be read", async () => {
  const db = dashboardDatabase({ guests: [{ id, is_active: true }] }, { reservations: "Read failed" });
  db.client.auth.getUser = async () => ({ data: { user: { id } } });
  const { GET } = loadTsModule("app/api/reviews/eligibility/route.ts", { "@/lib/supabase/server": { createClient: async () => db.client } });
  assert.equal((await GET()).status, 503);
});
