import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const { isValidStaffEmail, isValidStaffEmailForRole, staffEmailSuffix, staffEmailUsername } = loadTsModule("lib/auth/staff-email.ts");
const valid = { fullName: "Alex Mendoza", email: "alex@marvilleresort.com", role: "staff", password: "secret123", isActive: true };
const invalidEmails = ["plainaddress", "alex@localhost", "alex@", "@example.com", "alex@@example.com", "alex @example.com", "alex@example .com",
  ".alex@example.com", "alex.@example.com", "alex..m@example.com", "alex@example..com", "alex@-example.com", "alex@example-.com",
  "alex@exam_ple.com", "alex@example.c", "alex@example.123", "alex@example.com.", "alex@" + "a".repeat(64) + ".com", "a".repeat(65) + "@example.com"];

test("creation generates a fresh temporary password for every role and returns it only with the creation result", async () => {
  const passwords = new Set();
  for (const role of ["admin", "staff", "cashier"]) {
    const h = harness();
    const body = { fullName: "Ana Santos", email: role === "admin" ? "ana@gmail.com" : "ana@marvilleresort.com", role, isActive: true };
    for (const supplied of [undefined, "ClientChosenPassword123!"]) {
      const response = await h.post({ ...body, ...(supplied ? { password: supplied } : {}) });
      assert.equal(response.status, 201);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const data = await response.json();
      const password = data.temporaryPassword;
      assert.equal(password, h.calls.created.at(-1).password);
      assert.equal(password.length, 20);
      for (const pattern of [/[A-Z]/, /[a-z]/, /[0-9]/, /[!@#$%&*?]/]) assert.match(password, pattern);
      assert.notEqual(password, supplied);
      assert.equal(passwords.has(password), false); passwords.add(password);
      assert.equal(JSON.stringify(h.calls.profiles).includes(password), false);
      assert.equal(JSON.stringify(h.calls.audits).includes(password), false);
      assert.equal(h.calls.profiles.at(-1).values.must_change_password, true);
    }
  }
});

test("staff email validation accepts complete addresses, aliases, subdomains and domain length boundaries", () => {
  for (const email of ["alex@example.com", "Alex.Mendoza+cashier@Team.Example.COM.PH", "alex_mendoza@example.org", "o'neil@example.co.uk",
    "alex%tag@example.travel", "alex@xn--bcher-kva.de", "alex@example.xn--p1ai", "a".repeat(64) + "@example.com"]) assert.equal(isValidStaffEmail(email), true, email);
  const longest = "a".repeat(64) + "@" + "b".repeat(63) + "." + "c".repeat(63) + "." + "d".repeat(57) + ".com";
  assert.equal(longest.length, 254); assert.equal(isValidStaffEmail(longest), true); assert.equal(isValidStaffEmail("a" + longest), false);
});

test("staff email validation rejects malformed addresses and non-string values", () => {
  for (const email of [...invalidEmails, "", null, undefined, {}, 123, " alex@example.com ", "alex@example.com\n"]) assert.equal(isValidStaffEmail(email), false, String(email));
});

function harness({ allowed = true, existing = null } = {}) {
  const calls = { admin: 0, searches: [], created: [], profiles: [], audits: [] };
  const admin = { auth: { admin: { createUser: async payload => { calls.created.push(payload); return { data: { user: { id: "new-staff" } }, error: null }; } } },
    from(table) {
      const q = { select: () => q, ilike: (column, value) => { calls.searches.push({ column, value }); return q; },
        maybeSingle: async () => ({ data: existing, error: null }),
        insert: values => { calls.profiles.push({ table, values }); return q; },
        single: async () => ({ data: { id: "new-staff", ...calls.profiles.at(-1).values }, error: null }) };
      return q;
    } };
  const { POST } = loadTsModule("app/api/admin/users/route.ts", {
    "@/lib/server/admin-audit": { requireAdminStaff: async () => allowed ? { staffUser: { id: "admin", role: "admin" } } : null,
      createAuditLog: async (_actor, event) => { calls.audits.push(event); return true; } },
    "@/lib/supabase/admin": { tryCreateAdminClient: () => { calls.admin++; return admin; } },
  });
  return { calls, post: (body = valid) => POST(new Request("http://localhost/api/admin/users", { method: "POST", body: JSON.stringify(body) })),
    malformed: () => POST(new Request("http://localhost/api/admin/users", { method: "POST", body: "{" })) };
}

test("staff creation rejects malformed emails before accessing account creation or profiles", async () => {
  const h = harness();
  for (const email of invalidEmails) {
    const response = await h.post({ ...valid, email }); const result = await response.json();
    assert.equal(response.status, 400, email); assert.equal(result.field, "email"); assert.match(result.message, /valid email address/);
  }
  assert.equal((await h.malformed()).status, 400); assert.equal(h.calls.admin, 0);
  assert.equal(h.calls.created.length, 0); assert.equal(h.calls.profiles.length, 0); assert.equal(h.calls.audits.length, 0);
});

test("valid staff creation normalizes email and preserves role, password-change and audit workflows", async () => {
  const h = harness(); const response = await h.post({ ...valid, email: " Alex.Mendoza+cashier@MarVilleResort.COM ", role: "cashier" });
  assert.equal(response.status, 201); assert.equal(h.calls.created[0].email, "alex.mendoza+cashier@marvilleresort.com");
  assert.equal(h.calls.profiles[0].values.email, "alex.mendoza+cashier@marvilleresort.com"); assert.equal(h.calls.profiles[0].values.role, "cashier");
  assert.equal(h.calls.profiles[0].values.must_change_password, true); assert.equal(h.calls.audits.length, 1);
});

test("authorization and duplicate-account checks remain enforced and wildcard characters stay literal", async () => {
  const denied = harness({ allowed: false }); assert.equal((await denied.post()).status, 401); assert.equal(denied.calls.admin, 0);
  const duplicate = harness({ existing: { id: "old-staff" } }); assert.equal((await duplicate.post()).status, 409); assert.equal(duplicate.calls.created.length, 0);
  const literal = harness(); assert.equal((await literal.post({ ...valid, email: "alex_mendoza%tag@marvilleresort.com" })).status, 201);
  assert.equal(literal.calls.searches[0].value, "alex\\_mendoza\\%tag@marvilleresort.com");
});


test("role suffixes are fixed and full-address paste only strips the matching suffix", () => {
  for (const role of ["staff", "cashier", "admin"]) {
    const suffix = role === "admin" ? "@gmail.com" : "@marvilleresort.com";
    assert.equal(staffEmailSuffix(role), suffix);
    assert.equal(isValidStaffEmailForRole("alex" + suffix, role), true);
    assert.equal(isValidStaffEmailForRole("alex" + suffix + ".evil.com", role), false);
    assert.equal(staffEmailUsername(" Alex.Mendoza" + suffix.toUpperCase() + " ", role), "alex.mendoza");
  }
  assert.equal(staffEmailUsername("alex@gmail.com", "cashier"), "alex@gmail.com", "Wrong-domain paste is not silently reassigned to another mailbox");
});

test("creation enforces role domains on direct API requests before privileged account creation", async () => {
  for (const [role, email] of [["staff", "alex@gmail.com"], ["cashier", "alex@gmail.com"], ["admin", "alex@marvilleresort.com"], ["admin", "alex@example.com"], ["staff", "alex@team.marvilleresort.com"], ["cashier", "alex@marvilleresort.com.evil.com"]]) {
    const h = harness(), response = await h.post({ ...valid, role, email });
    assert.equal(response.status, 400); assert.equal((await response.json()).field, "email");
    assert.equal(h.calls.admin, 0); assert.deepEqual(h.calls.created, []);
  }
  for (const role of ["staff", "cashier", "admin"]) {
    const h = harness(), email = role === "admin" ? "admin@gmail.com" : "staff@marvilleresort.com";
    assert.equal((await h.post({ ...valid, role, email })).status, 201);
    assert.equal(h.calls.created[0].email, email); assert.equal(h.calls.profiles[0].values.role, role);
  }
});
