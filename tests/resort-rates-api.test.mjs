import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

function route(fail = null) {
  const calls = [], rows = {
    public_swimming_types: [{ type_id: "day", name: "Edited day admission", adult_rate: 175, child_rate: 95 }],
    room_classifications: [{ classification_id: "standard", rate_3_hours: 345 }, { classification_id: "private-only", rate_3_hours: 400 }, { classification_id: "inactive", rate_3_hours: 500 }],
    physical_rooms: [{ classification_id: "standard" }],
  };
  const db = { from(table) {
    const query = {
      select(fields) { calls.push([table, "select", fields]); return query; },
      eq(field, value) { calls.push([table, "eq", field, value]); return query; },
      order() { return query; },
      then(resolve) { resolve({ data: rows[table], error: fail === table ? { message: "Private database details" } : null }); },
    };
    return query;
  } };
  return { calls, GET: loadTsModule("app/api/resort-rates/route.ts", { "@/lib/supabase/admin": { createAdminClient: () => db } }).GET };
}

test("public resort rates use current prices, active sessions and general room classifications without reservation data", async () => {
  const { calls, GET } = route(), response = await GET(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.publicSwimming[0].adult_rate, 175);
  assert.deepEqual(body.rooms, [{ classification_id: "standard", rate_3_hours: 345 }]);
  assert.ok(calls.some(c => c.join() === "public_swimming_types,eq,is_active,true"));
  assert.ok(calls.some(c => c.join() === "physical_rooms,eq,is_active,true"));
  assert.ok(calls.some(c => c.join() === "physical_rooms,eq,private_swimming_only,false"));
  assert.ok(!calls.some(c => /reservation|guest_id|phone|contact|\*/.test(c.join())));
});

test("missing rate data fails without substituting invented prices or exposing database errors", async () => {
  for (const table of ["public_swimming_types", "room_classifications", "physical_rooms"]) {
    const response = await route(table).GET(), body = await response.json();
    assert.equal(response.status, 503); assert.equal(body.success, false);
    assert.match(body.message, /temporarily unavailable/); assert.doesNotMatch(JSON.stringify(body), /Private database/);
  }
});
