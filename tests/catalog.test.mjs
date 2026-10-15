import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { catalogDatabase, uuid } from "./helpers/catalog-database.mjs";

const { catalogResources } = loadTsModule("lib/catalog/catalog.ts");
const samples = {
  services: { name: "Extra mattress", description: "A comfortable extra", price: "500.25" },
  units: { name: "Family unit", description: "Pool view", capacity: "6", base_price: "7500.00", unit_img: "/website_photo.jpg" },
  unit_rates: { unit_id: uuid(1), price: "8000.00", effective_from: "2026-10-12", effective_to: "2026-12-31" },
  guest_rates: { adult_rate: "125.50", child_rate: "0", effective_from: "2026-10-12", effective_to: "2026-12-31" },
  payment_methods: { name: "Bank transfer", type: "bank" },
  payment_accounts: { payment_method_id: uuid(2), account_name: "Resort account", account_number: "0012345678", instructions: "Use your booking reference" },
  reservation_policies: { title: "Pool rules", content: "Please supervise children.", display_order: "0" },
  ocular_time_slots: { start_time: "08:00", end_time: "09:00", max_capacity: "3" },
};
const seed = () => ({
  units: [{ unit_id: uuid(1), name: "Pool villa", capacity: 6, base_price: 7500, is_active: true, archived_at: null }],
  payment_methods: [{ payment_method_id: uuid(2), name: "GCash", type: "ewallet", is_active: true }],
});

function harness(database = catalogDatabase(seed())) {
  database.storage = { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) };
  const audit = [];
  const auth = { allowed: true };
  const route = loadTsModule("app/api/admin/catalog/route.ts", {
    "@/lib/supabase/admin": { createAdminClient: () => database },
    "@/lib/server/admin-audit": { requireAdminStaff: async () => auth.allowed ? { supabase: {}, staffUser: { role: "admin" } } : null, createAuditLog: async (_staff, event) => audit.push(event) },
  });
  const request = (method, body, query = "") => {
    let init = body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    if (method === "POST" && body?.resource === "payment_accounts") {
      const form = new FormData(); form.set("payload", JSON.stringify(body));
      form.set("file", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "qr.png", { type: "image/png" }));
      init = { body: form };
    }
    return route[method](new Request(`https://example.com/api/admin/catalog${query}`, { method, ...init }));
  };
  return { database, audit, auth, request };
}

for (const [resource, record] of Object.entries(samples)) {
  test(`${resource}: create, edit, archive, and restore retain the same record`, async () => {
    const { request, database, audit } = harness();
    const created = await request("POST", { resource, record });
    assert.equal(created.status, 201);
    const original = (await created.json()).record;
    const id = original[catalogResources[resource].id];
    assert.equal(original.is_active, true);
    const field = catalogResources[resource].fields.find((field) => field.kind === "money" || field.kind === "text" || field.kind === "integer");
    const value = field.kind === "money" ? "555.55" : field.kind === "integer" ? 4 : "Updated name";
    const edited = await request("PATCH", { resource, id, record: { [field.key]: value } });
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).record[field.key], field.kind === "money" ? Number(value) : value);
    const beforeArchive = database.tables[resource].length;
    const archived = await request("DELETE", undefined, `?resource=${resource}&id=${id}`);
    assert.equal(archived.status, 200);
    const archivedRecord = (await archived.json()).record;
    assert.equal(archivedRecord.is_active, false);
    if (resource === "units") assert.ok(Date.parse(archivedRecord.archived_at));
    const restored = await request("PATCH", { resource, id, action: "restore" });
    assert.equal(restored.status, 200);
    const restoredRecord = (await restored.json()).record;
    assert.equal(restoredRecord.is_active, true);
    assert.equal(restoredRecord[catalogResources[resource].id], id);
    if (resource === "units") assert.equal(restoredRecord.archived_at, null);
    assert.equal(database.tables[resource].length, beforeArchive);
    assert.ok(audit.every((event) => event.entityId === id));
    assert.equal(audit.length, 4);
  });
}

test("edit clears nullable text and end dates while preserving other values and archive status", async () => {
  const database = catalogDatabase({ ...seed(), services: [{ service_id: uuid(3), ...samples.services, is_active: false }], unit_rates: [{ unit_rate_id: uuid(4), ...samples.unit_rates, is_active: true }] });
  const { request } = harness(database);
  const service = await request("PATCH", { resource: "services", id: uuid(3), record: { description: "" } });
  const serviceRecord = (await service.json()).record;
  assert.equal(serviceRecord.description, null);
  assert.equal(serviceRecord.is_active, false);
  assert.equal(serviceRecord.name, "Extra mattress");
  const rate = await request("PATCH", { resource: "unit_rates", id: uuid(4), record: { effective_to: "" } });
  const rateRecord = (await rate.json()).record;
  assert.equal(rateRecord.effective_to, null);
  assert.equal(rateRecord.effective_from, "2026-10-12");
});

test("missing records and failed writes return errors without a success audit", async () => {
  const { request, audit, database } = harness();
  for (const action of [{ record: { name: "Missing" } }, { action: "restore" }]) {
    assert.equal((await request("PATCH", { resource: "units", id: uuid(99), ...action })).status, 404);
  }
  assert.equal((await request("DELETE", undefined, `?resource=units&id=${uuid(99)}`)).status, 404);
  assert.equal(audit.length, 0);
  database.failNextWrite();
  assert.equal((await request("PATCH", { resource: "units", id: uuid(1), record: { name: "Changed" } })).status, 500);
  assert.equal(database.tables.units[0].name, "Pool villa");
  assert.equal(audit.length, 0);
});

test("validation rejects unsafe fields, invalid prices, dates, times, and capacities before writing", async () => {
  const { request, database } = harness();
  for (const [resource, record] of [
    ["services", { ...samples.services, price: -1 }], ["services", { ...samples.services, price: 1.234 }],
    ["services", { ...samples.services, name: " " }], ["services", { ...samples.services, is_active: false }],
    ["units", { ...samples.units, capacity: 1.5 }], ["units", { ...samples.units, unit_img: "javascript:alert(1)" }],
    ["unit_rates", { ...samples.unit_rates, effective_from: "2026-02-30" }], ["unit_rates", { ...samples.unit_rates, effective_to: "2026-01-01" }],
    ["ocular_time_slots", { ...samples.ocular_time_slots, end_time: "07:00" }], ["ocular_time_slots", { ...samples.ocular_time_slots, max_capacity: 0 }],
    ["services", []], ["services", null], ["constructor", {}], ["__proto__", {}],
  ]) assert.equal((await request("POST", { resource, record })).status, 400);
  assert.equal((await request("PATCH", { resource: "units", id: uuid(1), record: { unit_id: uuid(9) } })).status, 400);
  assert.equal(database.writes.length, 0);
});

test("all catalog actions require admin access", async () => {
  const { request, auth, database } = harness(); auth.allowed = false;
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) assert.equal((await request(method, method === "POST" || method === "PATCH" ? {} : undefined, "?resource=units")).status, 401);
  assert.equal(database.writes.length, 0);
});

test("inactive parent references can be viewed and edited but cannot be newly selected or restored", async () => {
  const rows = seed(); rows.units[0].is_active = false; rows.units[0].archived_at = "2026-10-12T00:00:00Z";
  rows.unit_rates = [{ unit_rate_id: uuid(3), ...samples.unit_rates, is_active: false }];
  const { request } = harness(catalogDatabase(rows));
  const refs = await request("GET", undefined, "?resource=references");
  assert.equal((await refs.json()).references.units[0].name, "Pool villa");
  assert.equal((await request("POST", { resource: "unit_rates", record: samples.unit_rates })).status, 400);
  assert.equal((await request("PATCH", { resource: "unit_rates", id: uuid(3), record: { price: 1000 } })).status, 200);
  assert.equal((await request("PATCH", { resource: "unit_rates", id: uuid(3), action: "restore" })).status, 400);
  assert.equal((await request("PATCH", { resource: "units", id: uuid(1), action: "restore" })).status, 200);
  assert.equal((await request("PATCH", { resource: "unit_rates", id: uuid(3), action: "restore" })).status, 200);
});

test("catalog lists filter by status and return stable pages and counts", async () => {
  const rows = seed(); rows.services = Array.from({ length: 17 }, (_, index) => ({ service_id: uuid(index + 10), name: `Service ${String(index).padStart(2, "0")}`, price: 100, is_active: index !== 16 }));
  const { request } = harness(catalogDatabase(rows));
  const page = await request("GET", undefined, "?resource=services&status=active&page=2&pageSize=15");
  const data = await page.json();
  assert.equal(data.records.length, 1);
  assert.equal(data.records[0].name, "Service 15");
  assert.equal(data.total, 16);
  assert.deepEqual(data.counts, { active: 16, archived: 1 });
  const archived = await request("GET", undefined, "?resource=services&status=archived");
  assert.equal((await archived.json()).records[0].name, "Service 16");
  const search = await request("GET", undefined, "?resource=services&status=all&search=Service%2001");
  assert.equal((await search.json()).total, 1);
  for (const value of ["NaN", "0", "-1", "1.5", "Infinity"]) assert.equal((await request("GET", undefined, `?resource=services&page=${value}`)).status, 400);
});

test("archived payment methods hide linked accounts from guests without deleting them", async () => {
  const rows = seed(); rows.payment_methods.push({ payment_method_id: uuid(5), name: "Old bank", is_active: false });
  rows.payment_accounts = [{ account_id: uuid(3), payment_method_id: uuid(2), account_name: "Current", is_active: true }, { account_id: uuid(4), payment_method_id: uuid(5), account_name: "Old", is_active: true }];
  const database = catalogDatabase(rows);
  const { getActiveCatalog } = loadTsModule("repositories/catalogRepository.ts");
  const catalog = await getActiveCatalog(database);
  assert.deepEqual(catalog.paymentAccounts.map((account) => account.account_name), ["Current"]);
  assert.equal(database.tables.payment_accounts.length, 2);
});


test("cash methods and their linked accounts stay out of the online catalog", async () => {
  const rows=seed();rows.payment_methods.push({payment_method_id:uuid(6),name:"Cash",type:"cash",is_active:true});
  rows.payment_accounts=[{account_id:uuid(3),payment_method_id:uuid(2),account_name:"GCash account",is_active:true},{account_id:uuid(7),payment_method_id:uuid(6),account_name:"Cash desk",is_active:true}];
  const {getActiveCatalog}=loadTsModule("repositories/catalogRepository.ts");const catalog=await getActiveCatalog(catalogDatabase(rows));
  assert.deepEqual(catalog.paymentMethods.map(method=>method.name),["GCash"]);assert.deepEqual(catalog.paymentAccounts.map(account=>account.account_name),["GCash account"]);
  const {isGcashMethod}=loadTsModule("lib/booking/gcash-receipt.ts");assert.equal(isGcashMethod({name:"GCash",type:"cash"}),false);
});
