import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

function maintenance(role = "admin") {
  const calls = [];
  const supabase = { rpc: async (name, args) => { calls.push({ name, args }); return { data: "block", error: null }; } };
  const route = loadTsModule("app/api/admin/maintenance-blocks/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => ({ staffUser: { id: "staff", role }, supabase }) },
    "@/lib/server/role-permissions": { staffHasPermission: async () => true },
  });
  return { calls, post: body => route.POST(new Request("http://localhost/api/admin/maintenance-blocks", { method: "POST", body: JSON.stringify(body) })) };
}
const body = { name: "Pool", reason: "Internal repair details", startDate: "2035-01-05", endDate: "2035-01-05", startTime: "09:00", endTime: "11:00" };
test("maintenance API accepts admin/manager PHT time windows, expands whole days and rejects invalid times or cashier writes", async () => {
  for (const role of ["admin", "staff"]) {
    const h = maintenance(role); assert.equal((await h.post(body)).status, 201);
    assert.equal(h.calls[0].name, "create_timed_maintenance_block");
    assert.equal(h.calls[0].args.p_start, "2035-01-05T09:00:00+08:00");
    assert.equal(h.calls[0].args.p_end, "2035-01-05T11:00:00+08:00");
    assert.equal((await h.post({ ...body, allDay: true })).status, 201);
    assert.equal(h.calls[1].args.p_start, "2035-01-05T00:00:00+08:00");
    assert.equal(h.calls[1].args.p_end, "2035-01-05T16:00:00.000Z");
    assert.equal((await h.post({ ...body, endTime: "08:00" })).status, 400);
    assert.equal((await h.post({ ...body, startTime: "25:00" })).status, 400);
    assert.equal((await h.post({ ...body, startDate: "2035-02-30" })).status, 400);
    assert.equal(h.calls.length, 2);
  }
  assert.equal((await maintenance("cashier").post(body)).status, 403);
});

test("public ocular availability respects capacity and exact maintenance windows without returning guest identities or internal reasons", async () => {
  const queried = [];
  const rows = {
    ocular_visits: [{ scheduled_date: "2035-01-05", time_slot_id: "slot" }],
    maintenance_blocks: [{ start_date: "2035-01-06", end_date: "2035-01-06", start_datetime: "2035-01-06T09:30:00+08:00", end_datetime: "2035-01-06T10:30:00+08:00" }],
  };
  const slots = [{ slot_id: "slot", start_time: "09:00:00", end_time: "10:00:00", max_capacity: 2 }, { slot_id: "later", start_time: "11:00:00", end_time: "12:00:00", max_capacity: 1 }];
  const route = loadTsModule("app/api/ocular-time-slots/route.ts", {
    "@/lib/supabase/server": { createClient: async () => ({}) },
    "@/repositories/catalogRepository": { getActiveOcularSlots: async () => slots },
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: table => {
      const q = { select: fields => { queried.push(fields); return q; }, in: () => q, eq: () => q, gte: () => q, lt: () => q, limit: () => q,
        then: (yes, no) => Promise.resolve({ data: rows[table], error: null }).then(yes, no) }; return q;
    } }) },
  });
  const response = await route.GET(new Request("http://localhost/api/ocular-time-slots?month=2035-01"));
  assert.equal(response.status, 200); const result = await response.json();
  assert.deepEqual(result.unavailableByDate["2035-01-05"], []);
  assert.deepEqual(result.unavailableByDate["2035-01-06"], ["09:00-10:00"]);
  assert.doesNotMatch(queried.join(","), /guest_id|reason|name/);
  rows.ocular_visits.push({ scheduled_date: "2035-01-05", time_slot_id: "slot" });
  const full = await (await route.GET(new Request("http://localhost/api/ocular-time-slots?month=2035-01"))).json();
  assert.deepEqual(full.unavailableByDate["2035-01-05"], ["09:00-10:00"]);
});
