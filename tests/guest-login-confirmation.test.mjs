import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const credentials = { email: "Guest@Example.com", password: "correct-password" };
const deviceId = "00000000-0000-4000-8000-000000000001";
function harness({ code = "email_not_confirmed", locked = false, verified = false, active = true, deactivateDuringLogin = false } = {}) {
  const attempts = []; const signIns = []; const signOuts = []; const updates = [];
  const sessionId = "00000000-0000-4000-8000-000000000002";
  const token = `header.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url")}.signature`;
  const supabase = { auth: {
    getUser: async () => ({ data: { user: null } }),
    signInWithPassword: async (input) => {
      signIns.push(input);
      return verified ? { data: { user: { id: deviceId }, session: { access_token: token } }, error: null } : { data: { user: null, session: null }, error: { code } };
    },
    signOut: async (input) => { signOuts.push(input); return { error: null }; },
  } };
  const admin = {
    rpc: async (name, payload) => {
      if (name === "check_login_lock") return { data: locked ? new Date(Date.now() + 60000).toISOString() : null, error: null };
      attempts.push(payload); return { data: null, error: null };
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: deviceId, is_active: active }, error: null }) }) }),
      update: (record) => { updates.push(record); const query = { eq: () => query, select: () => query, maybeSingle: async () => ({ data: deactivateDuringLogin ? null : { id: deviceId }, error: null }) }; return query; },
    }),
  };
  const mocks = {
    "next/headers": { cookies: async () => ({ get: () => ({ value: deviceId }) }) },
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/supabase/server": { createClient: async () => supabase },
  };
  const { POST } = loadTsModule("app/api/auth/login/route.ts", mocks);
  const { loginAccess } = loadTsModule("lib/server/login-access.ts", mocks);
  return { attempts, signIns, signOuts, updates, loginAccess, request: () => POST(new Request("https://resort.example/api/auth/login", { method: "POST", body: JSON.stringify(credentials) })) };
}

test("unconfirmed guest with correct credentials receives a confirmation prompt without a session", async () => {
  const h = harness(); const response = await h.request(); const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.success, false); assert.equal(body.code, "EMAIL_NOT_CONFIRMED");
  assert.match(body.message, /^Please confirm your email first\./);
  assert.equal(h.signIns[0].email, "guest@example.com");
  assert.equal(h.attempts[0].p_result, "denied");
  assert.equal(h.updates.length, 0); assert.equal(h.signOuts.length, 0);
  assert.equal(response.headers.get("set-cookie"), null);
});
test("confirmation reminders do not count toward the wrong-password lockout", async () => {
  const h = harness();
  for (let attempt = 0; attempt < 6; attempt++) assert.equal((await h.request()).status, 403);
  assert.equal(h.attempts.length, 6);
  assert.ok(h.attempts.every((attempt) => attempt.p_result === "denied"));
});
test("incorrect credentials keep their generic error and failed-attempt audit", async () => {
  const h = harness({ code: "invalid_credentials" }); const response = await h.request();
  assert.equal(response.status, 401); assert.equal((await response.json()).message, "Invalid credentials.");
  assert.equal(h.attempts[0].p_result, "failed");
});
test("existing login lockout takes priority over the confirmation prompt", async () => {
  const h = harness({ locked: true }); const response = await h.request();
  assert.equal(response.status, 429); assert.equal(h.signIns.length, 0);
  assert.equal(h.attempts[0].p_result, "blocked");
});
test("confirmed guests continue through the existing login session flow", async () => {
  const h = harness({ verified: true }); const response = await h.request();
  assert.equal(response.status, 200); assert.equal((await response.json()).success, true);
  assert.equal(h.updates.length, 1); assert.equal(h.signOuts[0].scope, "others");
  assert.equal(h.attempts[0].p_result, "success");
});
test("staff login retains its current error handling", async () => {
  const h = harness(); const access = await h.loginAccess("staff", credentials);
  assert.equal(access.response.status, 401);
  assert.equal((await access.response.json()).message, "Invalid credentials.");
  assert.equal(h.attempts[0].p_kind, "staff"); assert.equal(h.attempts[0].p_result, "failed");
});

test("guest and staff logins reject whitespace emails and blank passwords before authentication", async () => {
  for (const kind of ["guest", "staff"]) {
    for (const email of [" Guest@Example.com", "Guest@Example.com ", "guest @example.com", "guest@example .com", "guest\t@example.com", "guest\u00a0@example.com", "guest\u200b@example.com", "   ", "invalid"]) {
      const h = harness();
      const result = await h.loginAccess(kind, { ...credentials, email });
      assert.equal(result.response.status, 400, `${kind}: ${JSON.stringify(email)}`);
      assert.equal(h.signIns.length, 0); assert.equal(h.attempts.length, 0);
    }
    const h = harness();
    assert.equal((await h.loginAccess(kind, { ...credentials, password: "   " })).response.status, 400);
    assert.equal(h.signIns.length, 0);
  }
});

test("login preserves spaces within a real password", async () => {
  const h = harness();
  await h.loginAccess("guest", { ...credentials, password: " secret with spaces " });
  assert.equal(h.signIns[0].password, " secret with spaces ");
});


test("deactivated guests with correct credentials are denied without starting a website session", async () => {
  const h = harness({ verified: true, active: false }); const response = await h.request();
  assert.equal(response.status, 403); assert.equal((await response.json()).code, "ACCOUNT_DEACTIVATED");
  assert.equal(h.updates.length, 0); assert.equal(h.attempts[0].p_result, "denied"); assert.equal(h.signOuts[0].scope, "local");
});

test("deactivation racing with login cannot set a new active session", async () => {
  const h = harness({ verified: true, deactivateDuringLogin: true }); const response = await h.request();
  assert.equal(response.status, 403); assert.equal((await response.json()).code, "ACCOUNT_DEACTIVATED");
  assert.equal(h.signOuts[0].scope, "local"); assert.equal(h.attempts[0].p_result, "denied");
});
