import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { catalogDatabase } from "./helpers/catalog-database.mjs";

const { normalizePersonName, sanitizePersonName } = loadTsModule("lib/validation/name.ts");
const { validateGuestRegistration } = loadTsModule("lib/auth/guest-registration.ts");
const { validateGuestProfile } = loadTsModule("lib/auth/guest-profile.ts");
const invalidNames = ["Maria123", "123", "Maria ９", "Maria ٣", "Maria 😀", "Maria 1️⃣", "Maria 🇵🇭", "Maria 👩‍👩‍👧‍👦", "---", "...", " ", "a".repeat(101)];
const guest = { firstName: "Maria", lastName: "Dela Cruz", middleName: "", email: "guest@example.com", phoneNumber: "09171234567", address: "Taytay, Rizal", password: "secret123", confirmPassword: "secret123" };

test("person names support accents, initials and punctuation while rejecting digits and all emoji forms", () => {
  for (const name of ["José Peña", "O’Neil", "Anne-Marie", "J. Dela Cruz Jr.", "Jose\u0301", "李明"]) {
    assert.equal(normalizePersonName(name), name.normalize("NFC"));
  }
  assert.equal(normalizePersonName("  José   O’Neil  "), "José O’Neil");
  for (const name of [...invalidNames, null, 123, {}]) assert.equal(normalizePersonName(name), null, String(name));
  assert.equal(normalizePersonName(sanitizePersonName("José123 😀 Peña ９ 1️⃣")), "José Peña");
});

test("guest registration and profile validation check each personal name, including optional middle names", () => {
  for (const field of ["firstName", "lastName", "middleName"]) {
    for (const value of invalidNames.filter(value => value.trim())) {
      for (const validate of [validateGuestRegistration, validateGuestProfile]) {
        const result = validate({ ...guest, [field]: value });
        assert.equal(result.value, undefined, field + ": " + value);
        assert.match(result.error, /Names must use letters/);
      }
    }
  }
  assert.equal(validateGuestProfile({ ...guest, middleName: "  " }).value.middle_name, null);
  assert.equal(validateGuestProfile({ ...guest, firstName: "José", lastName: "O’Neil Jr." }).value.first_name, "José");
});

test("staff creation and updates reject invalid names before privileged database access", async () => {
  let clients = 0; const audits = [];
  const mocks = {
    "@/lib/server/admin-audit": { requireAdminStaff: async () => ({ staffUser: { id: "admin", role: "admin" } }), createAuditLog: async data => { audits.push(data); return true; } },
    "@/lib/supabase/admin": { tryCreateAdminClient: () => { clients++; throw new Error("Invalid names must not reach the database"); } },
  };
  const { POST } = loadTsModule("app/api/admin/users/route.ts", mocks);
  const { PATCH } = loadTsModule("app/api/admin/users/[staffId]/route.ts", mocks);
  for (const fullName of invalidNames) {
    const request = () => new Request("http://localhost", { method: "POST", body: JSON.stringify({ fullName, email: "staff@example.com", password: "secret123", role: "staff", isActive: true }) });
    for (const response of [await POST(request()), await PATCH(request(), { params: Promise.resolve({ staffId: "other" }) })]) {
      assert.equal(response.status, 400); assert.equal((await response.json()).field, "fullName");
    }
  }
  assert.equal(clients, 0); assert.equal(audits.length, 0);
});

test("walk-in creation rejects invalid first, last and middle names before database operations", async () => {
  let queries = 0;
  const { POST } = loadTsModule("app/api/admin/reservations/create/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => ({ staffUser: { id: "admin", role: "admin" }, supabase: { from: () => { queries++; throw new Error("Unexpected query"); } } }) },
    "@/lib/server/role-permissions": { staffHasPermission: async () => true },
  });
  for (const field of ["firstName", "lastName", "middleName"]) {
    for (const value of invalidNames) {
      const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ guestType: "walk_in", walkInGuest: { ...guest, [field]: value } }) }));
      assert.equal(response.status, 400); assert.match((await response.json()).message, /Names must use letters/);
    }
  }
  assert.equal(queries, 0);
});

function profileApi({ authenticated = true, active = true } = {}) {
  const db = catalogDatabase({ guests: [{ id: "guest", first_name: "Maria", is_active: active }, { id: "other", first_name: "Other Guest", is_active: true }] });
  db.auth = { getUser: async () => ({ data: { user: authenticated ? { id: "guest" } : null }, error: null }) };
  const { PATCH } = loadTsModule("app/api/auth/me/route.ts", { "@/lib/supabase/server": { createClient: async () => db } });
  return { db, patch: (body = guest) => PATCH(new Request("http://localhost/api/auth/me", { method: "PATCH", body: JSON.stringify(body) })) };
}

test("profile API validates names before writing and updates only the signed-in active guest", async () => {
  const h = profileApi();
  for (const field of ["firstName", "lastName", "middleName"]) {
    for (const value of invalidNames.filter(value => value.trim())) {
      const response = await h.patch({ ...guest, [field]: value });
      assert.equal(response.status, 400); assert.match((await response.json()).message, /Names must use letters/);
    }
  }
  assert.equal(h.db.writes.length, 0);
  assert.equal((await h.patch({ ...guest, id: "other", firstName: "  José  ", lastName: "O’Neil Jr." })).status, 200);
  assert.equal(h.db.tables.guests[0].first_name, "José"); assert.equal(h.db.tables.guests[0].last_name, "O’Neil Jr.");
  assert.equal(h.db.tables.guests[0].phone_number, "+639171234567"); assert.equal(h.db.tables.guests[0].middle_name, null);
  assert.equal(h.db.tables.guests[1].first_name, "Other Guest");
  const anonymous = profileApi({ authenticated: false }); assert.equal((await anonymous.patch()).status, 401); assert.equal(anonymous.db.writes.length, 0);
  const inactive = profileApi({ active: false }); assert.equal((await inactive.patch()).status, 404); assert.equal(inactive.db.tables.guests[0].first_name, "Maria");
});
