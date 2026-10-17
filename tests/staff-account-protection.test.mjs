import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { catalogDatabase } from "./helpers/catalog-database.mjs";

const actorId = "admin-self", targetId = "admin-other";
const profile = { id: targetId, full_name: "Other Admin", email: "other@example.com", role: "admin", is_active: true,
  active_session_id: "active-session", last_logout_at: null };
const payload = { fullName: "Updated Name", role: "admin", isActive: true };

function harness({ target = {}, allowed = true, race = false } = {}) {
  const database = catalogDatabase({ staff_users: [{ ...profile, ...target }] });
  const audits = []; let clients = 0;
  if (race) {
    const from = database.from;
    database.from = table => {
      const query = from(table), update = query.update;
      query.update = values => {
        // Another request promotes this account between the read and the write.
        database.tables.staff_users[0].role = "admin";
        return update(values);
      };
      return query;
    };
  }
  const { PATCH } = loadTsModule("app/api/admin/users/[staffId]/route.ts", {
    "@/lib/server/admin-audit": {
      requireAdminStaff: async () => allowed ? { staffUser: { id: actorId, role: "admin" } } : null,
      createAuditLog: async (_actor, event) => { audits.push(event); return true; },
    },
    "@/lib/supabase/admin": { tryCreateAdminClient: () => { clients++; return database; } },
  });
  return { database, audits, clients: () => clients, patch: (values = payload, id = targetId) => PATCH(
    new Request("http://localhost/api/admin/users/" + id, { method: "PATCH", body: JSON.stringify(values) }),
    { params: Promise.resolve({ staffId: id }) },
  ) };
}

test("admins cannot disable another admin or themselves, including a combined role and status change", async () => {
  for (const id of [targetId, actorId]) {
    for (const role of ["admin", "staff", "cashier"]) {
      const h = harness({ target: { id } });
      const response = await h.patch({ ...payload, role, isActive: false }, id);
      assert.ok([400, 403].includes(response.status));
      assert.equal(h.database.writes.length, 0); assert.equal(h.audits.length, 0);
      assert.equal(h.database.tables.staff_users[0].is_active, true);
      assert.equal(h.database.tables.staff_users[0].active_session_id, "active-session");
    }
  }
});

test("an admin cannot be demoted first to bypass disable protection", async () => {
  for (const role of ["staff", "cashier"]) {
    const h = harness();
    const response = await h.patch({ ...payload, role });
    assert.equal(response.status, 403); assert.match((await response.json()).message, /Admin roles cannot be removed/);
    assert.equal(h.database.writes.length, 0); assert.equal(h.audits.length, 0);
  }
});

test("admin profiles can still be edited and inactive admins reactivated", async () => {
  for (const is_active of [true, false]) {
    const h = harness({ target: { is_active } });
    assert.equal((await h.patch()).status, 200);
    const updated = h.database.tables.staff_users[0];
    assert.equal(updated.full_name, "Updated Name"); assert.equal(updated.role, "admin"); assert.equal(updated.is_active, true);
    assert.equal(h.audits[0].action, is_active ? "Staff edited" : "Staff enabled");
  }
});

test("manager and cashier accounts can still be disabled and enabled with the existing session and audit behavior", async () => {
  for (const role of ["staff", "cashier"]) {
    const h = harness({ target: { role } });
    assert.equal((await h.patch({ ...payload, role, isActive: false })).status, 200);
    const updated = h.database.tables.staff_users[0];
    assert.equal(updated.is_active, false); assert.equal(updated.active_session_id, null);
    assert.match(updated.last_logout_at, /\+08:00$/); assert.equal(h.audits[0].action, "Staff disabled");
    assert.equal((await h.patch({ ...payload, role, isActive: true })).status, 200);
    assert.equal(updated.is_active, true); assert.equal(updated.active_session_id, null);
    assert.equal(h.audits[1].action, "Staff enabled");
  }
});

test("an account promoted to admin during a status update cannot be disabled by stale data", async () => {
  const h = harness({ target: { role: "staff" }, race: true });
  const response = await h.patch({ ...payload, role: "staff", isActive: false });
  assert.equal(response.status, 409); assert.match((await response.json()).message, /Reload staff accounts/);
  assert.equal(h.database.tables.staff_users[0].is_active, true);
  assert.equal(h.database.tables.staff_users[0].role, "admin"); assert.equal(h.audits.length, 0);
});

test("missing or malformed status cannot silently disable an account and authorization stays enforced", async () => {
  const h = harness({ target: { role: "staff" } });
  for (const isActive of [undefined, null, "false", 0]) {
    assert.equal((await h.patch({ ...payload, role: "staff", isActive })).status, 400);
  }
  assert.equal(h.clients(), 0); assert.equal(h.database.writes.length, 0);
  const unauthorized = harness({ allowed: false });
  assert.equal((await unauthorized.patch()).status, 401); assert.equal(unauthorized.clients(), 0);
});
