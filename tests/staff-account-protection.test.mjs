import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { catalogDatabase } from "./helpers/catalog-database.mjs";

const actorId = "admin-self", targetId = "admin-other";
const profile = { id: targetId, full_name: "Other Admin", email: "other@example.com", role: "admin", is_active: true,
  active_session_id: "active-session", last_logout_at: null };
const payload = { fullName: "Updated Name", role: "admin", isActive: true };

function harness({ target = {}, allowed = true, race = false, authEmail, authReadError = false } = {}) {
  const database = catalogDatabase({ staff_users: [{ ...profile, ...target }] });
  const audits = [], authReads = []; let clients = 0;
  database.auth = { admin: { getUserById: async id => { authReads.push(id); return { data: { user: { id, email: authEmail ?? database.tables.staff_users[0].email } }, error: authReadError ? { message: "Auth unavailable" } : null }; } } };
  if (race) {
    const from = database.from;
    database.from = table => {
      const query = from(table), update = query.update;
      query.update = values => {
        // Another request promotes this account between the read and the write.
        if (race === "email") database.tables.staff_users[0].email = "changed@marvilleresort.com";
        else database.tables.staff_users[0].role = "admin";
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
  return { database, audits, authReads, clients: () => clients, patch: (values = payload, id = targetId) => PATCH(
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

test("resort-domain and other non-Gmail staff cannot be promoted to admin through direct requests", async () => {
  for (const role of ["staff", "cashier"]) for (const email of ["staff@marvilleresort.com", "staff@example.com", "staff@gmail.com.evil.com", "staff@sub.gmail.com"]) {
    const h = harness({ target: { role, email } });
    const response = await h.patch({ ...payload, email: "spoofed@gmail.com" });
    assert.equal(response.status, 403); assert.match((await response.json()).message, /Only accounts using @gmail.com/);
    assert.equal(h.database.tables.staff_users[0].role, role);
    assert.deepEqual(h.database.writes, []); assert.deepEqual(h.audits, []); assert.deepEqual(h.authReads, []);
  }
});

test("Gmail staff can be promoted only when their actual sign-in address matches", async () => {
  for (const role of ["staff", "cashier"]) {
    const h = harness({ target: { role, email: "owner@gmail.com" }, authEmail: "Owner@GMAIL.COM" });
    assert.equal((await h.patch()).status, 200);
    assert.equal(h.database.tables.staff_users[0].role, "admin");
    assert.deepEqual(h.authReads, [targetId]); assert.equal(h.audits.length, 1);
  }
  for (const options of [{ authEmail: "owner@marvilleresort.com" }, { authReadError: true }]) {
    const h = harness({ target: { role: "staff", email: "owner@gmail.com" }, ...options });
    assert.equal((await h.patch()).status, options.authReadError ? 503 : 403);
    assert.deepEqual(h.database.writes, []); assert.deepEqual(h.audits, []);
  }
});

test("an email changed during promotion cannot bypass the Gmail requirement", async () => {
  const h = harness({ target: { role: "staff", email: "owner@gmail.com" }, race: "email" });
  assert.equal((await h.patch()).status, 409);
  assert.equal(h.database.tables.staff_users[0].role, "staff"); assert.deepEqual(h.audits, []);
});

function passwordHarness({ role = "admin", id = targetId, active = true, allowed = true, missing = false, readError = false, authError = false } = {}) {
  const database = catalogDatabase({ staff_users: missing ? [] : [{ ...profile, id, role, is_active: active }] });
  const authWrites = [], audits = [];
  database.auth = { admin: { updateUserById: async (id, values) => { authWrites.push({ id, values }); return { error: authError ? { message: "Auth unavailable" } : null }; } } };
  if (readError) database.from = () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: { message: "Read unavailable" } }) }; return q; };
  const { POST } = loadTsModule("app/api/admin/users/[staffId]/password/route.ts", {
    "@/lib/server/admin-audit": {
      requireAdminStaff: async () => allowed ? { staffUser: { id: actorId, role: "admin" } } : null,
      createAuditLog: async (_actor, event) => { audits.push(event); return true; },
    },
    "@/lib/supabase/admin": { tryCreateAdminClient: () => database },
  });
  return { database, authWrites, audits, reset: (password = "temporary123") => POST(
    new Request("http://localhost/api/admin/users/" + id + "/password", { method: "POST", body: JSON.stringify({ password }) }),
    { params: Promise.resolve({ staffId: id }) },
  ) };
}

test("user management cannot reset active or inactive admin passwords, including the acting admin", async () => {
  for (const id of [targetId, actorId]) for (const active of [true, false]) {
    const h = passwordHarness({ id, active });
    const response = await h.reset();
    assert.equal(response.status, 403);
    assert.match((await response.json()).message, /Admin passwords cannot be reset/);
    assert.deepEqual(h.authWrites, []); assert.deepEqual(h.database.writes, []); assert.deepEqual(h.audits, []);
  }
});

test("password reset checks fail closed for missing profiles, read failures and denied access", async () => {
  for (const [options, expected] of [[{ missing: true }, 404], [{ readError: true }, 503], [{ allowed: false }, 401], [{ role: "unexpected-role" }, 403]]) {
    const h = passwordHarness(options); assert.equal((await h.reset()).status, expected);
    assert.deepEqual(h.authWrites, []); assert.deepEqual(h.database.writes, []); assert.deepEqual(h.audits, []);
  }
  const generated = passwordHarness({ role: "staff" });
  const response = await generated.reset("short");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.temporaryPassword, generated.authWrites[0].values.password);
  assert.notEqual(data.temporaryPassword, "short");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("manager and cashier resets still revoke sessions, require a password change and create an audit entry", async () => {
  for (const role of ["staff", "cashier"]) {
    const h = passwordHarness({ role }); assert.equal((await h.reset()).status, 200);
    assert.equal(h.authWrites[0].id, targetId);
    assert.equal(h.authWrites[0].values.password.length, 20);
    assert.notEqual(h.authWrites[0].values.password, "temporary123");
    assert.equal(JSON.stringify(h.audits).includes(h.authWrites[0].values.password), false);
    const staff = h.database.tables.staff_users[0];
    assert.equal(staff.active_session_id, null); assert.equal(staff.must_change_password, true);
    assert.match(staff.last_logout_at, /\+08:00$/); assert.equal(h.audits[0].action, "Password reset");
  }
  const failed = passwordHarness({ role: "cashier", authError: true });
  assert.equal((await failed.reset()).status, 500); assert.deepEqual(failed.database.writes, []); assert.deepEqual(failed.audits, []);
});

test("admins can edit their own name while role, status and session protections remain", async () => {
  const h = harness({ target: { id: actorId } });
  assert.equal((await h.patch(payload, actorId)).status, 200);
  const updated = h.database.tables.staff_users[0];
  assert.equal(updated.full_name, "Updated Name"); assert.equal(updated.role, "admin"); assert.equal(updated.is_active, true);
  assert.equal(updated.active_session_id, "active-session"); assert.equal(h.audits[0].action, "Staff edited");
});

test("admins cannot rename another active or inactive admin even when spoofing ownership or reactivating", async () => {
  for (const is_active of [true, false]) {
    const h = harness({ target: { is_active } });
    const response = await h.patch({ ...payload, currentStaffUserId: targetId, userId: targetId });
    assert.equal(response.status, 403); assert.equal((await response.json()).field, "fullName");
    assert.equal(h.database.tables.staff_users[0].full_name, profile.full_name);
    assert.equal(h.database.tables.staff_users[0].is_active, is_active);
    assert.deepEqual(h.database.writes, []); assert.deepEqual(h.audits, []);
  }
});

test("inactive admins can still be reactivated without changing their name", async () => {
  const h = harness({ target: { is_active: false, full_name: "Other  Admin" } });
  assert.equal((await h.patch({ ...payload, fullName: "Other Admin" })).status, 200);
  const updated = h.database.tables.staff_users[0];
  assert.equal(updated.full_name, "Other  Admin", "An unrelated status change preserves the stored name exactly");
  assert.equal(updated.is_active, true); assert.equal(h.audits[0].action, "Staff enabled");
});

test("manager and cashier names remain editable", async () => {
  for (const role of ["staff", "cashier"]) {
    const h = harness({ target: { role } });
    assert.equal((await h.patch({ ...payload, role })).status, 200);
    assert.equal(h.database.tables.staff_users[0].full_name, "Updated Name");
  }
});

test("a concurrent promotion to admin cannot bypass name protection", async () => {
  const h = harness({ target: { role: "staff" }, race: true });
  assert.equal((await h.patch({ ...payload, role: "staff" })).status, 409);
  assert.equal(h.database.tables.staff_users[0].full_name, profile.full_name);
  assert.deepEqual(h.audits, []);
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
