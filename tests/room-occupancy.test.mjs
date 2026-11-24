import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const { occupancyIndicator, countdown, roomMatches, roomDate } = loadTsModule("lib/rooms/occupancy.ts");
test("countdowns derive expiring and overdue indicators without changing operational status", () => {
  const now = Date.parse("2026-11-24T10:00:00Z"), room = { status: "occupied", current: { expected_checkout: new Date(now + 1800000).toISOString() } };
  assert.equal(occupancyIndicator(room, now), "expiring");
  assert.equal(occupancyIndicator(room, now + 1800001), "overdue");
  assert.equal(room.status, "occupied");
  assert.equal(countdown(new Date(now + 19200000).toISOString(), now), "5h 20m left");
  assert.equal(countdown(new Date(now - 900000).toISOString(), now), "Overdue by 15m");
  assert.equal(countdown(new Date(now + 905000).toISOString(), now, true), "00:15:05 left");
});
test("search covers actual guest, reference, room name and occupancy records; occupied filter includes overdue", () => {
  const room = { status: "occupied", room_number: "S01", name: "Garden Room", classification: { name: "Standard Rooms" }, current: { guest_name: "River Guest", assignment_id: "assignment-123", reservation: { reference_number: "RM-123" }, expected_checkout: "2026-01-01T00:00:00Z" }, upcoming: [] };
  for (const q of ["s01", "garden", "river", "rm-123", "assignment-123"]) assert.equal(roomMatches(room, q, "occupied", Date.now()), true);
  assert.equal(roomMatches(room, "absent", "all", Date.now()), false);
  assert.match(roomDate("2026-11-24T00:00:00Z"), /8:00/);
});
