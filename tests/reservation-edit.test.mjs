import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";

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
const detail = () => ({ reservation, bill, packageRates: legacyRates, services: existing, units: [{ unit_id: id, quantity: 1, price_per_night: 9000 }],
  catalogServices: catalog, catalogUnits: [{ unit_id: id, name: "Resort", is_active: true, archived_at: null }],
  version: edit.version, snapshot: { updatedAt: reservation.updated_at }, lockedReason: null, canChangeDetails: true });

test("service additions retain a negotiated package, fees, historical prices and payments", () => {
  const p = helper.previewReservationEdit(reservation, bill, existing, catalog, { ...edit,
    services: [{ serviceId, quantity: 2 }, { serviceId: newServiceId, quantity: 3 }] }, legacyRates);
  assert.deepEqual(p, { packageDelta: 0, rescheduleFee: 0, dateRateAdjustment: 0, servicesTotal: 950, total: 9450, paid: 8000, balance: 1450, overpaid: 0 });
});
test("a schedule or guest-count edit applies only the package price difference", () => {
  const p = helper.previewReservationEdit(reservation, bill, existing, catalog, { ...edit, adultCount: 22 }, legacyRates);
  assert.equal(p.packageDelta, 250); assert.equal(p.total, 8850);
});
test("removing a future service exposes an overpayment without reducing paid amount", () => {
  const p = helper.previewReservationEdit(reservation, { ...bill, paid_amount: 8600 }, existing, catalog, { ...edit, services: [] }, legacyRates);
  assert.equal(p.total, 8500); assert.equal(p.paid, 8600); assert.equal(p.balance, 0); assert.equal(p.overpaid, 100);
});
test("unavailable new services cannot enter the bill", () => {
  assert.throws(() => helper.previewReservationEdit(reservation, bill, [], catalog, edit, legacyRates), /no longer available/);
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

function routeHarness({ grant = true, approveLate = true, active = true, loaded = detail(), rpcError = null, conflict = false, availabilityError = null } = {}) {
  const calls = [];
  const checks = [];
  const routes = loadTsModule("app/api/admin/reservations/[id]/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => active ? { staffUser: { id, role: "staff" }, supabase: {} } : null },
    "@/lib/server/role-permissions": { staffHasPermission: async (_db, _role, permission) => grant && (permission !== "reschedule_approval" || approveLate) },
    "@/lib/notifications": { createNotifications: async () => ({ error: null }) },
    "@/lib/server/reservation-editor": { loadReservationEditor: async () => loaded },
    "@/lib/server/reservation-availability": { checkReservationOverlap: async (...args) => { checks.push(args); return { conflict, error: availabilityError }; } },
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (name, args) => {
      calls.push({ name, args }); return { data: { totalAmount: 8600 }, error: rpcError };
    } }) },
  });
  const patch = body => routes.PATCH(new Request("http://localhost/api/admin/reservations/" + id, {
    method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  }), { params: Promise.resolve({ id }) });
  return { patch, calls, checks, routes };
}

test("schedule edits recheck availability excluding the current reservation before making changes", async () => {
  const moved = { ...edit, startDatetime: "2027-06-15T08:00:00+08:00", endDatetime: "2027-06-15T16:00:00+08:00", expectedTotal: 8650 };
  const available = routeHarness(); assert.equal((await available.patch(moved)).status, 200);
  assert.equal(available.checks.length, 1); assert.equal(available.checks[0][3], id);
  assert.equal(available.checks[0][0], "2027-06-15T00:00:00.000Z");
  const booked = routeHarness({ conflict: true }); const blocked = await booked.patch(moved);
  assert.equal(blocked.status, 409); assert.match((await blocked.json()).message, /reserved or closed for maintenance/); assert.equal(booked.calls.length, 0);
  const failed = routeHarness({ availabilityError: { message: "Database unavailable" } });
  assert.equal((await failed.patch(moved)).status, 503); assert.equal(failed.calls.length, 0);
  const servicesOnly = routeHarness({ availabilityError: { message: "Unavailable" } });
  assert.equal((await servicesOnly.patch(edit)).status, 200); assert.equal(servicesOnly.checks.length, 0);
});

test("package changes, whole-day variant changes and edited start times or durations are rejected by the server", async () => {
  for (const change of [
    { bookingMode: "night", startDatetime: "2027-06-14T18:00:00+08:00", endDatetime: "2027-06-15T06:00:00+08:00" },
    { bookingMode: "whole_day", endDatetime: "2027-06-15T06:00:00+08:00" },
    { bookingMode: "custom" },
    { startDatetime: "2027-06-14T09:00:00+08:00", endDatetime: "2027-06-14T17:00:00+08:00" },
    { endDatetime: "2027-06-14T17:00:00+08:00" },
  ]) {
    const h = routeHarness(); const response = await h.patch({ ...edit, ...change });
    assert.equal(response.status, 400); assert.match((await response.json()).message, /booked package/); assert.equal(h.calls.length, 0);
  }
  const h = routeHarness({ loaded: { ...detail(), reservation: { ...reservation, booking_mode: "whole_day", start_datetime: "2027-06-14T18:00:00+08:00", end_datetime: "2027-06-15T16:00:00+08:00" } } });
  assert.equal((await h.patch({ ...edit, bookingMode: "whole_day", endDatetime: "2027-06-15T06:00:00+08:00" })).status, 400);
  assert.equal(h.calls.length, 0);
});

test("moving the booked window preserves its clock times, exact duration and fractional seconds across month boundaries", () => {
  const booked = { ...reservation, booking_mode: "whole_day", start_datetime: "2027-06-14T18:12:34.567+08:00", end_datetime: "2027-06-15T16:12:34.567+08:00" };
  const moved = helper.moveReservationToDate(booked, "2028-02-29");
  assert.equal(moved.startDatetime, "2028-02-29T10:12:34.567Z"); assert.equal(moved.endDatetime, "2028-03-01T08:12:34.567Z");
  assert.equal(helper.bookedPackageChangeReason(booked, { bookingMode: "whole_day", ...moved }), null);
});
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

test("staff date edits use the policy RPC and fees cannot be supplied by the browser", async () => {
  const moved = { ...edit, startDatetime: "2027-06-15T08:00:00+08:00", endDatetime: "2027-06-15T16:00:00+08:00", expectedTotal: 8650, rescheduleFee: 0 };
  const h = routeHarness(); assert.equal((await h.patch(moved)).status, 200);
  assert.equal(h.calls[0].name, "edit_staff_reservation_reschedule"); assert.equal(h.calls[0].args.p_patch.rescheduleFee, 50);
  const missing = routeHarness({ rpcError: { code: "PGRST202" } });
  const response = await missing.patch(moved); assert.equal(response.status, 503); assert.match((await response.json()).message, /reschedule-policy migration/);
});

test("late and ended confirmed reservations require explicit approval and retain accommodation and guest counts", async () => {
  const originalNow = Date.now; Date.now = () => Date.parse("2027-06-13T10:00:00+08:00");
  try {
    const loaded = { ...detail(), lateRescheduleEligible: true };
    const moved = { ...edit, startDatetime: "2027-06-21T08:00:00+08:00", endDatetime: "2027-06-21T16:00:00+08:00", expectedTotal: 8900 };
    assert.equal((await routeHarness({ loaded }).patch(moved)).status, 400);
    assert.equal((await routeHarness({ loaded, approveLate: false }).patch({ ...moved, lateRescheduleAcknowledged: true })).status, 400);
    assert.equal((await routeHarness({ loaded }).patch({ ...moved, lateRescheduleAcknowledged: "true" })).status, 400);
    const authorized = routeHarness({ loaded });
    assert.equal((await authorized.patch({ ...moved, lateRescheduleAcknowledged: true })).status, 200);
    assert.equal(authorized.calls[0].args.p_patch.rescheduleFee, 300);
    Date.now = () => Date.parse("2027-06-15T10:00:00+08:00");
    const ended = { ...loaded, canChangeDetails: false, lockedReason: "This stay has ended." };
    const newEdit = { ...moved, lateRescheduleAcknowledged: true, expectedTotal: 9100 };
    assert.equal((await routeHarness({ loaded: ended }).patch(newEdit)).status, 200);
    assert.equal((await routeHarness({ loaded: ended }).patch({ ...newEdit, adultCount: 21 })).status, 400);
    assert.equal((await routeHarness({ loaded: { ...ended, reservation: { ...reservation, status: "completed" } } }).patch(newEdit)).status, 400);
  } finally { Date.now = originalNow; }
});

test("date-rate reductions retain the bill and date-rate increases are charged using booked prices", () => {
  const monday = { ...edit, startDatetime: "2027-06-14T08:00:00+08:00", endDatetime: "2027-06-14T16:00:00+08:00" };
  const saturday = { ...reservation, start_datetime: "2027-06-19T08:00:00+08:00", end_datetime: "2027-06-19T16:00:00+08:00" };
  const lower = helper.previewReservationEdit(saturday, bill, existing, catalog, monday, legacyRates, Date.parse("2027-05-01"));
  assert.equal(lower.packageDelta, 0); assert.equal(lower.dateRateAdjustment, 0); assert.equal(lower.total, 8650);
  const higher = helper.previewReservationEdit(reservation, bill, existing, catalog, { ...edit, startDatetime: saturday.start_datetime, endDatetime: saturday.end_datetime }, legacyRates, Date.parse("2027-05-01"));
  assert.equal(higher.dateRateAdjustment, 500); assert.equal(higher.total, 9150); assert.equal(higher.paid, 8000);
});
