import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const helper = loadTsModule("lib/booking/reservation-edit.ts");
const id = "11111111-1111-4111-8111-111111111111";
const serviceId = "22222222-2222-4222-8222-222222222222";
const newServiceId = "33333333-3333-4333-8333-333333333333";
const reservation = { reservation_id: id, reference_number: "TEST", status: "confirmed", booking_mode: "day",
  start_datetime: "2027-06-14T08:00:00+08:00", end_datetime: "2027-06-14T16:00:00+08:00",
  adult_count: 20, child_count: 0, special_requests: "", updated_at: "2026-10-12T00:00:00.000Z", payment_deadline_at: null };
const edit = { bookingMode: "day", startDatetime: reservation.start_datetime, endDatetime: reservation.end_datetime,
  adultCount: 20, childCount: 0, unitId: id, specialRequests: "", services: [{ serviceId, quantity: 1 }],
  reason: "Guest request by phone", version: "a".repeat(64), expectedTotal: 8600 };
const existing = [{ service_id: serviceId, quantity: 1, price_at_time: 100 }];
const catalog = [{ service_id: serviceId, name: "Old service", price: 999, is_active: false },
  { service_id: newServiceId, name: "New service", price: 250, is_active: true }];
const bill = { total_amount: 8600, paid_amount: 8000, status: "partial" };
const detail = () => ({ reservation, bill, services: existing, units: [{ unit_id: id, quantity: 1, price_per_night: 9000 }],
  catalogServices: catalog, catalogUnits: [{ unit_id: id, name: "Resort", is_active: true, archived_at: null }],
  version: edit.version, snapshot: { updatedAt: reservation.updated_at }, lockedReason: null, canChangeDetails: true });

test("service additions retain a negotiated package, fees, historical prices and payments", () => {
  const p = helper.previewReservationEdit(reservation, bill, existing, catalog, { ...edit,
    services: [{ serviceId, quantity: 2 }, { serviceId: newServiceId, quantity: 3 }] });
  assert.deepEqual(p, { packageDelta: 0, servicesTotal: 950, total: 9450, paid: 8000, balance: 1450, overpaid: 0 });
});
test("a schedule or guest-count edit applies only the package price difference", () => {
  const p = helper.previewReservationEdit(reservation, bill, existing, catalog, { ...edit, adultCount: 22 });
  assert.equal(p.packageDelta, 250); assert.equal(p.total, 8850);
});
test("removing a future service exposes an overpayment without reducing paid amount", () => {
  const p = helper.previewReservationEdit(reservation, { ...bill, paid_amount: 8600 }, existing, catalog, { ...edit, services: [] });
  assert.equal(p.total, 8500); assert.equal(p.paid, 8600); assert.equal(p.balance, 0); assert.equal(p.overpaid, 100);
});
test("unavailable new services cannot enter the bill", () => {
  assert.throws(() => helper.previewReservationEdit(reservation, bill, [], catalog, edit), /no longer available/);
});
test("payload rejects duplicate service IDs, fractions, excessive guests, untrusted prices and missing reason", () => {
  assert.ok(helper.parseReservationEdit(edit));
  for (const change of [{ services: [edit.services[0], edit.services[0]] }, { adultCount: 31 }, { childCount: 0.5 },
    { services: [{ serviceId, quantity: 0 }] }, { reason: " " }, { expectedTotal: "8600" }, { version: "bad" }]) {
    assert.equal(helper.parseReservationEdit({ ...edit, ...change }), null);
  }
  const parsed = helper.parseReservationEdit({ ...edit, services: [{ serviceId, quantity: 1, price: 0 }] });
  // The API always rebuilds prices from stored rows and the catalog.
  assert.equal(parsed.services[0].serviceId, serviceId);
  assert.equal(parsed.services[0].price, undefined);
});
test("access closes ended stays and expired holds and blocks pending reviews", () => {
  const now = Date.parse("2027-06-14T10:00:00+08:00");
  assert.equal(helper.reservationEditAccess(reservation, false, false, now).canChangeDetails, false);
  assert.equal(helper.reservationEditAccess(reservation, false, false, now).lockedReason, null);
  assert.match(helper.reservationEditAccess(reservation, true, false, now).lockedReason, /pending payment/);
  assert.match(helper.reservationEditAccess(reservation, false, true, now).lockedReason, /reschedule/);
  assert.match(helper.reservationEditAccess({ ...reservation, end_datetime: "2027-06-13T16:00:00+08:00" }, false, false, now).lockedReason, /ended/);
  assert.match(helper.reservationEditAccess({ ...reservation, status: "pending", payment_deadline_at: "2027-06-13T00:00:00Z" }, false, false, now).lockedReason, /expired/);
  assert.match(helper.reservationEditAccess({ ...reservation, status: "cancelled" }, false, false, now).lockedReason, /pending or confirmed/);
});
test("schedule validation rejects incorrect package duration and invalid custom windows", () => {
  assert.equal(helper.validateEditWindow(edit).valid, true);
  assert.equal(helper.validateEditWindow({ ...edit, endDatetime: "2027-06-14T12:00:00+08:00" }).valid, false);
  assert.equal(helper.validateEditWindow({ ...edit, bookingMode: "custom", startDatetime: "2027-06-14T07:00:00+08:00" }).valid, false);
});

function routeHarness({ grant = true, active = true, loaded = detail(), rpcError = null } = {}) {
  const calls = [];
  const routes = loadTsModule("app/api/admin/reservations/[id]/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => active ? { staffUser: { id, role: "staff" }, supabase: {} } : null },
    "@/lib/server/role-permissions": { staffHasPermission: async () => grant },
    "@/lib/server/reservation-editor": { loadReservationEditor: async () => loaded },
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (name, args) => {
      calls.push({ name, args }); return { data: { totalAmount: 8600 }, error: rpcError };
    } }) },
  });
  const patch = body => routes.PATCH(new Request("http://localhost/api/admin/reservations/" + id, {
    method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  }), { params: Promise.resolve({ id }) });
  return { patch, calls, routes };
}
test("unauthenticated and unprivileged staff cannot invoke the mutation", async () => {
  for (const [opts, status] of [[{ active: false }, 401], [{ grant: false }, 403]]) {
    const h = routeHarness(opts); assert.equal((await h.patch(edit)).status, status); assert.equal(h.calls.length, 0);
  }
});
test("stale versions and changed catalog quotes require review before saving", async () => {
  const h = routeHarness();
  assert.equal((await h.patch({ ...edit, version: "b".repeat(64) })).status, 409);
  assert.equal((await h.patch({ ...edit, expectedTotal: 1 })).status, 409);
  assert.equal(h.calls.length, 0);
});
test("in-stay schedule changes and service reductions are blocked; additions are allowed", async () => {
  const h = routeHarness({ loaded: { ...detail(), canChangeDetails: false } });
  assert.equal((await h.patch({ ...edit, adultCount: 21 })).status, 409);
  assert.equal((await h.patch({ ...edit, services: [], expectedTotal: 8500 })).status, 400);
  assert.equal((await h.patch({ ...edit, services: [{ serviceId, quantity: 2 }], expectedTotal: 8700 })).status, 200);
  assert.equal(h.calls.length, 1);
});
test("saving uses one atomic RPC with server-derived prices and actor", async () => {
  const h = routeHarness();
  assert.equal((await h.patch({ ...edit, services: [{ serviceId, quantity: 1, price: 0 }] })).status, 200);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, "edit_staff_reservation");
  assert.equal(h.calls[0].args.p_staff, id); assert.equal(h.calls[0].args.p_patch.services[0].price, 100);
  assert.equal(h.calls[0].args.p_patch.packageDelta, 0);
});
test("database concurrency, date conflicts and missing migration produce actionable errors", async () => {
  for (const [code, status] of [["40001", 409], ["23P01", 409], ["42501", 403], ["PGRST202", 503]]) {
    const h = routeHarness({ rpcError: { code, message: "Database conflict" } });
    const response = await h.patch(edit); assert.equal(response.status, status);
    const body = await response.json(); assert.equal(body.success, false);
  }
});
test("detail response never exposes the internal mutation snapshot", async () => {
  const h = routeHarness();
  const response = await h.routes.GET(new Request("http://localhost"), { params: Promise.resolve({ id }) });
  const body = await response.json(); assert.equal(body.canEdit, true); assert.equal(body.snapshot, undefined);
});
test("calendar APIs map reads and edits to separate role permissions", () => {
  const { apiPermission, hasPermission } = loadTsModule("lib/auth/role-access.ts");
  assert.equal(apiPermission(`/api/admin/reservations/${id}`, "GET"), "reservations");
  assert.equal(apiPermission(`/api/admin/reservations/${id}`, "PATCH"), "edit_reservation");
  assert.equal(hasPermission("staff", ["reservations"], "edit_reservation"), false);
  assert.equal(hasPermission("staff", ["reservations", "edit_reservation"], "edit_reservation"), true);
});
