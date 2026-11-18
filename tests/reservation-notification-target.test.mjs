import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const changeId = "22222222-2222-4222-8222-222222222222";
function harness({ role = "staff", permissions = ["reservations"], reservation = { reservation_id: id, start_datetime: "2027-02-28T16:30:00Z", status: "confirmed" }, legacy = false, error = null, signedIn = true } = {}) {
  const reads = [];
  const client = { from(table) {
    let column, value;
    const q = { select: () => q, eq: (key, target) => { column = key; value = target; return q; }, maybeSingle: async () => {
      reads.push({ table, column, value });
      return { data: table === "reservations" ? (value === reservation?.reservation_id ? reservation : null) : legacy && value === changeId ? { reservation_id: id } : null, error };
    } };
    return q;
  } };
  const { default: Page } = loadTsModule("app/admin/(portal)/reservations/page.tsx", {
    "@/components/admin/ReservationCalendar": { __esModule: true, default: () => null },
    "@/lib/server/admin-audit": { requireActiveStaff: async () => signedIn ? { staffUser: { role }, supabase: client } : null },
    "@/lib/server/role-permissions": { getRolePermissions: async () => permissions },
  });
  return { reads, page: params => Page({ searchParams: Promise.resolve(params) }) };
}

test("notification targets use the reservation's current Philippine date rather than a stale link date", async () => {
  for (const status of ["pending", "confirmed", "completed", "cancelled", "no_show"]) {
    const h = harness({ reservation: { reservation_id: id, start_datetime: "2027-02-28T16:30:00Z", status } });
    const result = await h.page({ reservation: id, highlight: "1", date: "2026-11-19" });
    assert.equal(result.props.initialReservationId, id);
    assert.equal(result.props.initialDate, "2027-03-01");
    assert.equal(result.props.highlightOnly, true);
    assert.equal(result.props.initialTargetError, undefined);
    assert.deepEqual(h.reads, [{ table: "reservations", column: "reservation_id", value: id }]);
  }
});

test("automatic and legacy reschedule notifications both resolve to the current reservation", async () => {
  for (const legacy of [false, true]) {
    const h = harness({ legacy });
    const result = await h.page({ reschedule: legacy ? changeId : id, highlight: "1" });
    assert.equal(result.props.initialReservationId, id);
    assert.equal(result.props.initialDate, "2027-03-01");
    assert.equal(h.reads.some(read => read.table === "reservation_reschedules"), legacy);
  }
});

test("malformed or unauthorized notification links never query a record", async () => {
  for (const options of [{ permissions: [] }, { signedIn: false }]) {
    const h = harness(options), result = await h.page({ reservation: id, highlight: "1" });
    assert.equal(result.props.initialReservationId, undefined); assert.equal(h.reads.length, 0);
  }
  for (const reservation of ["not-an-id", [id], "//example.com"]) {
    const h = harness(), result = await h.page({ reservation, highlight: "1" });
    assert.equal(result.props.initialReservationId, undefined); assert.equal(h.reads.length, 0);
    assert.match(result.props.initialTargetError, /invalid/);
  }
});

test("deleted, inaccessible, expired and failed targets show a message instead of focusing another entry", async () => {
  for (const options of [{ reservation: null }, { reservation: { reservation_id: id, status: "expired" } }, { reservation: { reservation_id: id, status: "pending", payment_deadline_at: "2000-01-01T00:00:00Z" } }, { error: Error("Database unavailable") }]) {
    const h = harness(options), result = await h.page({ reservation: id, highlight: "1" });
    assert.equal(result.props.initialReservationId, undefined); assert.equal(result.props.initialDate, undefined);
    assert.ok(result.props.initialTargetError); assert.doesNotMatch(result.props.initialTargetError, /Database unavailable/);
  }
});
