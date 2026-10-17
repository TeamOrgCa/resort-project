import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const walkIn = "22222222-2222-4222-8222-222222222222";
const registered = "33333333-3333-4333-8333-333333333333";
function harness({ signedIn = true, permitted = true, online = false, missing = false, failure = null, noBill = false } = {}) {
  const reads = [], permissionChecks = []; let clients = 0;
  const rows = {
    reservations: { reservation_id: id, reference_number: "MV-RECORD", guest_id: online ? registered : null,
      walk_in_guest_id: online ? null : walkIn, status: "completed", booking_type: online ? "online" : "walk_in",
      start_datetime: "2027-06-14T08:00:00+08:00", end_datetime: "2027-06-14T16:00:00+08:00", adult_count: 20, child_count: 2 },
    walk_in_guests: { first_name: "Walk-in", last_name: "Tester", email: "walkin@example.com", phone_number: "09123456789", address: "Taytay" },
    guests: { first_name: "Online", last_name: "Tester", email: "online@example.com" },
    reservation_units: [{ quantity: 1, price_per_night: 8000, units: { name: "Archived cottage" } }],
    reservation_services: [{ quantity: 2, price_at_time: 300, services: [{ name: "Mattress rental" }] }],
    transactions: { total_amount: "8900.00", paid_amount: "8900.00", balance: "0.00", status: "paid" },
  };
  const client = { from(table) {
    const read = { table, filters: [], fields: null }; reads.push(read);
    const result = () => ({ data: missing && table === "reservations" || noBill && table === "transactions" ? null : rows[table], error: failure === table ? { message: "Read failed" } : null });
    const q = { select: fields => { read.fields = fields; return q; }, eq: (key, value) => { read.filters.push([key, value]); return q; },
      maybeSingle: async () => result(), then: (yes, no) => Promise.resolve(result()).then(yes, no) };
    return q;
  } };
  const { GET } = loadTsModule("app/api/admin/records/reservations/[id]/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => signedIn ? { supabase: {}, staffUser: { role: "staff" } } : null },
    "@/lib/server/role-permissions": { staffHasPermission: async (_client, _role, permission) => { permissionChecks.push(permission); return permitted; } },
    "@/lib/supabase/admin": { createAdminClient: () => { clients++; return client; } },
  });
  return { reads, permissionChecks, clients: () => clients, get: (recordId = id) => GET(new Request("http://localhost"), { params: Promise.resolve({ id: recordId }) }) };
}

test("Records permission opens a completed walk-in reservation with its own profile and historical charges", async () => {
  const h = harness(); const response = await h.get();
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const { detail } = await response.json();
  assert.equal(detail.guest.first_name, "Walk-in");
  assert.equal(detail.reservation.status, "completed");
  assert.deepEqual(detail.units, [{ name: "Archived cottage", quantity: 1, price: 8000 }]);
  assert.deepEqual(detail.services, [{ name: "Mattress rental", quantity: 2, price: 300 }]);
  assert.deepEqual(detail.bill, { total: 8900, paid: 8900, balance: 0, status: "paid" });
  assert.deepEqual(h.permissionChecks, ["records"]);
  assert.deepEqual(h.reads.find(read => read.table === "walk_in_guests").filters, [["walk_in_guest_id", walkIn]]);
  assert.equal(h.reads.some(read => ["package_rate_versions", "guests"].includes(read.table)), false);
  assert.equal(h.reads.some(read => read.filters.some(([key]) => key === "is_active")), false);
});

test("registered guest reservations use the registered profile and missing bills remain explicit", async () => {
  const h = harness({ online: true, noBill: true }); const { detail } = await (await h.get()).json();
  assert.equal(detail.guest.first_name, "Online"); assert.equal(detail.bill, null);
  assert.deepEqual(h.reads.find(read => read.table === "guests").filters, [["id", registered]]);
  assert.equal(h.reads.some(read => read.table === "walk_in_guests"), false);
});

test("record read enforces sign-in, module permission and identifiers before privileged queries", async () => {
  for (const [settings, recordId, status] of [[{ signedIn: false }, id, 401], [{ permitted: false }, id, 403], [{}, "bad-id", 400]]) {
    const h = harness(settings); assert.equal((await h.get(recordId)).status, status); assert.equal(h.clients(), 0);
  }
  const { apiPermission } = loadTsModule("lib/auth/role-access.ts");
  assert.equal(apiPermission(`/api/admin/records/reservations/${id}`, "GET"), "records");
});

test("missing reservations and failed guest/billing reads do not produce misleading details", async () => {
  const missing = harness({ missing: true }); assert.equal((await missing.get()).status, 404); assert.equal(missing.reads.length, 1);
  for (const failure of ["reservations", "walk_in_guests", "transactions"]) {
    const response = await harness({ failure }).get(); assert.equal(response.status, 503);
    assert.equal((await response.json()).detail, undefined);
  }
});
