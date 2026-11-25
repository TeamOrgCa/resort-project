import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const id = "11111111-1111-4111-8111-111111111111";
function harness({ authenticated = true, role = "staff", permissions = ["rooms", "room_operations", "create_reservation"], rpcError = null } = {}) {
  const calls = [];
  const { POST } = loadTsModule("app/api/admin/rooms/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => authenticated ? { supabase: {}, staffUser: { id: "authenticated-actor", role } } : null },
    "@/lib/server/role-permissions": { staffHasPermission: async (_db, r, p) => r === "admin" || permissions.includes(p) && !(r === "cashier" && p === "room_operations") },
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: { success: true }, error: rpcError }; } }) },
    "@/lib/server/rooms": {},
  });
  return { calls, post: body => POST(new Request("http://localhost/api/admin/rooms", { method: "POST", body: JSON.stringify(body) })) };
}
const operation = { roomId: id, action: "extend", input: { hours: 2, assignment_id: id, expected_checkout: "2027-01-01T12:00:00Z", hourly_rate: 100 }, confirmed: true };
test("room mutations require active staff, explicit confirmation and operation grants before accessing the database", async () => {
  for (const [options, expected] of [[{ authenticated: false }, 401], [{ role: "cashier" }, 403], [{ permissions: ["rooms"] }, 403]]) {
    const h = harness(options); assert.equal((await h.post(operation)).status, expected); assert.equal(h.calls.length, 0);
  }
  const h = harness(); for (const body of [{ ...operation, confirmed: false }, { ...operation, roomId: "bad" }, { ...operation, action: "vacant" }, { ...operation, input: [] }]) assert.equal((await h.post(body)).status, 400);
  assert.equal(h.calls.length, 0);
});
test("the server supplies the validated actor and delegates atomic revalidation to the room RPC", async () => {
  const h = harness(); assert.equal((await h.post({ ...operation, staffId: "forged", input: { ...operation.input, amount: 1 } })).status, 200);
  assert.equal(h.calls[0].name, "room_operate"); assert.equal(h.calls[0].args.p_staff, "authenticated-actor"); assert.equal(h.calls[0].args.p_action, "extend");
});
test("database conflicts, permissions, validation and missing migrations return actionable failure statuses", async () => {
  for (const [code, status] of [["40001", 409], ["40P01", 409], ["42501", 403], ["22023", 400], ["PGRST202", 503]]) assert.equal((await harness({ rpcError: { code, message: "Rejected" } }).post(operation)).status, status);
});
test("room reservation creation needs the existing reservation grant and normalizes real guest input", async () => {
  const body = { roomId: id, action: "reserve", confirmed: true, input: { first_name: "Guest", last_name: "Example", phone: "09171234567", address: "Example address", occupants: 2, duration_hours: 12, extension_hours: 0, pricing_version: 1, eligible_guests: 0, expected_total: 900, starts_at: "2027-01-01T00:00:00Z", ends_at: "2027-01-01T12:00:00Z", commercial_type: "room_accommodation" } };
  const denied = harness({ permissions: ["rooms", "room_operations"] }); assert.equal((await denied.post(body)).status, 403);
  const h = harness(); assert.equal((await h.post(body)).status, 200); assert.equal(h.calls[0].args.p_input.phone, "+639171234567");
});

const multiRoomReservation = { roomId: id, action: "reserve", confirmed: true, input: {
  first_name: "Guest", last_name: "Example", phone: "09171234567", address: "Example address", occupants: 4,
  duration_hours: 12, extension_hours: 0, pricing_version: 1, eligible_guests: 0, expected_total: 1800,
  starts_at: "2027-01-01T00:00:00Z", ends_at: "2027-01-01T12:00:00Z", commercial_type: "room_accommodation",
  rooms: [{ room_id: id, occupants: 2, pricing_version: 1 }, { room_id: "22222222-2222-4222-8222-222222222222", occupants: 2, pricing_version: 3 }],
} };

test("manual multiple-room reservations use one atomic RPC with the authenticated actor and all selected rooms", async () => {
  const h = harness(); assert.equal((await h.post(multiRoomReservation)).status, 200);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, "room_reserve_multiple_priced");
  assert.equal(h.calls[0].args.p_staff, "authenticated-actor");
  assert.deepEqual(h.calls[0].args.p_input.rooms, multiRoomReservation.input.rooms);
  assert.equal(h.calls[0].args.p_input.phone, "+639171234567");
  const denied = harness({ permissions: ["rooms", "room_operations"] });
  assert.equal((await denied.post(multiRoomReservation)).status, 403); assert.equal(denied.calls.length, 0);
});

test("invalid or duplicate room selections and inconsistent guest totals never reach the database", async () => {
  const original = multiRoomReservation.input;
  for (const change of [
    { rooms: null }, { rooms: {} }, { rooms: [] }, { rooms: [null] }, { rooms: [{ ...original.rooms[0], room_id: "bad" }] },
    { rooms: [original.rooms[0], original.rooms[0]] }, { rooms: [{ ...original.rooms[0], occupants: 1.5 }, original.rooms[1]] },
    { rooms: [original.rooms[0], { ...original.rooms[1], pricing_version: 0 }] },
    { rooms: [...original.rooms].reverse() }, { occupants: 3 }, { commercial_type: "private_swimming" },
  ]) {
    const h = harness(); assert.equal((await h.post({ ...multiRoomReservation, input: { ...original, ...change } })).status, 400, JSON.stringify(change));
    assert.equal(h.calls.length, 0);
  }
  const missing = await harness({ rpcError: { code: "PGRST202", message: "Missing function" } }).post(multiRoomReservation);
  assert.equal(missing.status, 503); assert.match((await missing.json()).message, /manual-multi-room-reservation-migration.sql/);
});
test("cashiers cannot acquire operational access through configurable permission strings", () => {
  const access = loadTsModule("lib/auth/role-access.ts");
  assert.equal(access.hasPermission("cashier", ["rooms", "room_operations", "room_export"], "rooms"), true);
  assert.equal(access.hasPermission("cashier", ["room_operations"], "room_operations"), false);
  assert.equal(access.hasPermission("cashier", ["room_export"], "room_export"), false);
  assert.equal(access.routePermission("/admin/rooms"), "rooms");
  assert.equal(access.apiPermission("/api/admin/rooms/history", "GET"), "rooms");
});
test("room history exports fetch every matching database page and neutralize CSV formulas", async () => {
  const ranges = [], audits = [];
  const rows = Array.from({ length: 1200 }, (_, n) => ({ activity_id: String(n), room_id: id, activity_type: "extension", reference_number: "RM-EXPORT", description: n === 0 ? "=HYPERLINK(unsafe)" : "Stay extended", staff_name: "Manager", created_at: "2026-11-24T00:00:00Z" }));
  const { GET } = loadTsModule("app/api/admin/rooms/history/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => ({ supabase: {}, staffUser: { id, role: "staff" } }), createAuditLog: async (_staff, data) => audits.push(data) },
    "@/lib/server/role-permissions": { staffHasPermission: async () => true },
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: () => {
      const q = { select: () => q, order: () => q, lte: () => q, eq: () => q, range: async (from, to) => { ranges.push([from, to]); return { data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null, count: rows.length }; } }; return q;
    } }) },
  });
  const response = await GET(new Request("http://localhost/api/admin/rooms/history?export=csv"));
  assert.equal(response.status, 200);
  const csv = await response.text(); assert.equal(csv.split("\r\n").length, 1201); assert.match(csv, /'=HYPERLINK/);
  assert.deepEqual(ranges, [[0, 999], [1000, 1199]]); assert.equal(audits[0].action, "Exported room history");
});
