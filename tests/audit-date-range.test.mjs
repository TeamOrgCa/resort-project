import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const {auditDateRange}=loadTsModule("lib/admin/audit-date-range.ts");

function route({ authorized = true, count = 0 } = {}) {
  const calls = [];
  const q = {
    select: () => q,
    gte: (...args) => { calls.push(["gte", ...args]); return q; },
    lt: (...args) => { calls.push(["lt", ...args]); return q; },
    order: (...args) => { calls.push(["order", ...args]); return q; },
    limit: async n => { calls.push(["limit", n]); return { data: Array.from({ length: Math.min(n, count) }, (_, i) => ({ log_id: `log-${i}`, action: "System event", created_at: "2026-10-17T00:00:00Z" })), error: null }; },
  };
  const supabase = { from: table => { calls.push(["from", table]); return q; } };
  const { GET } = loadTsModule("app/api/admin/audit/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => authorized ? { supabase } : null },
    "@/lib/supabase/admin": { tryCreateAdminClient: () => null },
  });
  return { calls, get: query => GET(new Request(`http://localhost/api/admin/audit${query ?? ""}`)) };
}

test("audit dates include complete Philippine days and filter in the database before the result limit", async () => {
  const h = route();
  const response = await h.get("?startDate=2026-10-16&endDate=2026-10-17");
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls, [["from", "audit_logs"], ["gte", "created_at", "2026-10-15T16:00:00.000Z"], ["lt", "created_at", "2026-10-17T16:00:00.000Z"], ["order", "created_at", { ascending: false }], ["limit", 301]]);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("invalid or incomplete audit ranges fail without reading any records", async () => {
  for (const query of ["?startDate=2026-10-17", "?endDate=2026-10-17", "?startDate=2026-02-30&endDate=2026-03-01", "?startDate=2026-10-18&endDate=2026-10-17", "?startDate=not-a-date&endDate=2026-10-17"]) {
    const h = route(); const response = await h.get(query);
    assert.equal(response.status, 400, query); assert.deepEqual(h.calls, []);
  }
  const denied = route({ authorized: false }); assert.equal((await denied.get()).status, 401); assert.deepEqual(denied.calls, []);
});

test("unfiltered audit requests retain recent activity and report when the 300-entry limit is reached", async () => {
  const h = route({ count: 301 }); const response = await h.get(); const data = await response.json();
  assert.equal(data.rows.length, 300); assert.equal(data.hasMore, true); assert.equal(data.limit, 300);
  assert.equal(h.calls.some(call => ["gte", "lt"].includes(call[0])), false);
});

test("audit presets use full Philippine days, current Monday-Sunday and complete calendar months",()=>{
  const cases=[
    ["today","2026-11-12T16:00:00Z","2026-11-13","2026-11-13"],
    ["this-week","2026-11-13T04:00:00Z","2026-11-09","2026-11-15"],
    ["this-week","2026-11-09T00:00:00Z","2026-11-09","2026-11-15"],
    ["this-week","2026-11-08T00:00:00Z","2026-11-02","2026-11-08"],
    ["this-week","2026-01-01T00:00:00Z","2025-12-29","2026-01-04"],
    ["this-week","2026-11-08T16:00:00Z","2026-11-09","2026-11-15"],
    ["this-month","2028-02-10T00:00:00Z","2028-02-01","2028-02-29"],
    ["this-month","2026-11-30T16:00:00Z","2026-12-01","2026-12-31"],
  ];
  for(const [period,now,start,end] of cases){
    const range=auditDateRange(period,null,null,new Date(now));assert.equal(range.startDate,start);assert.equal(range.endDate,end);
    assert.equal(range.start.toISOString(),new Date(`${start}T00:00:00+08:00`).toISOString());
    assert.equal(range.end.getTime(),Date.parse(`${end}T00:00:00+08:00`)+86400000);
  }
});
test("preset API requests filter before limiting and reject invalid selections or custom dates",async()=>{
  for(const period of ["today","this-week","this-month"]){
    const h=route();const expected=auditDateRange(period);const response=await h.get(`?period=${period}`);assert.equal(response.status,200);
    assert.deepEqual(h.calls[1],["gte","created_at",expected.start.toISOString()]);assert.deepEqual(h.calls[2],["lt","created_at",expected.end.toISOString()]);
    assert.deepEqual((await response.json()).dateRange,{startDate:expected.startDate,endDate:expected.endDate});
  }
  for(const query of ["?period=overall","?period=custom","?period=custom&startDate=2026-11-13&endDate=2026-11-12"]){
    const h=route();assert.equal((await h.get(query)).status,400);assert.deepEqual(h.calls,[]);
  }
});
