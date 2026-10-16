import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const guest = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const rows = Array.from({ length: 23 }, (_, index) => ({ reservation_id: `booking-${index}`, guest_id: guest, reference_number: `MV-${index}`, status: ["confirmed", "completed", "cancelled"][index % 3], booking_mode: "day",
  start_datetime: "2027-06-15T08:00:00+08:00", end_datetime: "2027-06-15T16:00:00+08:00", adult_count: 20, child_count: 0, created_at: new Date(Date.UTC(2027, 0, 30 - index)).toISOString(), checked_in_at: null, checked_out_at: null }));
function harness({ authorized = true, missing = false, failure = null, bookings = rows, missingBill = false } = {}) {
  const reads = [];
  const client = { from(table) {
    const read = { table, filters: [], orders: [] }; reads.push(read);
    const q = { select: (columns, options) => { read.columns = columns; read.options = options; return q; },
      eq: (key, value) => { read.filters.push([key, value]); return q; }, in: (key, value) => { read.filters.push([key, value]); return q; },
      order: (key, options) => { read.orders.push([key, options]); return q; }, range: (first, last) => { read.range = [first, last]; return q; },
      maybeSingle: async () => ({ data: missing ? null : { id: guest }, error: failure === table ? Error("Offline") : null }),
      then(resolve, reject) {
        const scoped = bookings.filter(row => row.guest_id === read.filters.find(([key]) => key === "guest_id")?.[1]);
        const ids = read.filters.find(([key]) => key === "reservation_id")?.[1] ?? [];
        const data = table === "reservations" ? scoped.slice(read.range[0], read.range[1] + 1) : missingBill ? [] : ids.map(id => ({ reservation_id: id, total_amount: "3000.00", paid_amount: "600", balance: "2400" }));
        return Promise.resolve({ data, count: scoped.length, error: failure === table ? Error("Offline") : null }).then(resolve, reject);
      } };
    return q;
  } };
  const { GET } = loadTsModule("app/api/admin/users/guests/[guestId]/reservations/route.ts", { "@/lib/server/admin-audit": { requireAdminStaff: async () => authorized ? { supabase: client } : null } });
  return { reads, get: (query = "", id = guest) => GET(new Request(`http://localhost/api/admin/users/guests/${id}/reservations${query}`), { params: Promise.resolve({ guestId: id }) }) };
}

test("guest history is administrator-only and validates account IDs and bounded pagination before querying", async () => {
  const blocked = harness({ authorized: false }); assert.equal((await blocked.get()).status, 403); assert.equal(blocked.reads.length, 0);
  const h = harness();
  for (const query of ["?page=-1", "?page=1.5", "?page=1000001", "?page=no", "?page="]) assert.equal((await h.get(query)).status, 400);
  assert.equal((await h.get("", "not-an-id")).status, 400); assert.equal(h.reads.length, 0);
  assert.equal((await harness({ missing: true }).get()).status, 404);
});

test("account history includes every reservation status and paginates only that guest's records with scoped billing", async () => {
  const h = harness({ bookings: [...rows, { ...rows[0], reservation_id: "private-other", guest_id: other }] });
  const response = await h.get(); const result = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(result.total, 23); assert.equal(result.rows.length, 20); assert.equal(result.pageSize, 20);
  assert.deepEqual(new Set(result.rows.map(row => row.status)), new Set(["confirmed", "completed", "cancelled"]));
  assert.equal(result.rows[0].totalAmount, 3000); assert.equal(result.rows[0].paidAmount, 600); assert.equal(result.rows[0].balance, 2400);
  const reservations = h.reads.find(read => read.table === "reservations"), bills = h.reads.find(read => read.table === "transactions");
  assert.deepEqual(reservations.filters, [["guest_id", guest]]); assert.deepEqual(reservations.range, [0, 19]);
  assert.deepEqual(reservations.orders, [["created_at", { ascending: false }], ["reservation_id", { ascending: false }]]);
  assert.deepEqual(bills.filters, [["reservation_id", rows.slice(0, 20).map(row => row.reservation_id)]]);
  const second = await (await h.get("?page=1")).json(); assert.equal(second.rows.length, 3); assert.equal(second.total, 23);
  assert.equal(second.rows[0].id, "booking-20"); assert.equal(second.rows.some(row => row.id === "private-other"), false);
});

test("empty history and missing billing are explicit, while database failures never return incomplete financial data", async () => {
  const empty = harness({ bookings: [] }); const result = await (await empty.get()).json();
  assert.deepEqual(result.rows, []); assert.equal(result.total, 0); assert.equal(empty.reads.some(read => read.table === "transactions"), false);
  const missing = await (await harness({ missingBill: true }).get()).json();
  assert.equal(missing.rows[0].totalAmount, null); assert.equal(missing.rows[0].paidAmount, null); assert.equal(missing.rows[0].balance, null);
  for (const failure of ["guests", "reservations", "transactions"]) {
    const response = await harness({ failure }).get(); assert.equal(response.status, 500); assert.equal((await response.json()).success, false);
  }
});
