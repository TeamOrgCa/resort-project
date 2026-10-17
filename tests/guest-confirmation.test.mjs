import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { catalogDatabase, uuid } from "./helpers/catalog-database.mjs";

const guest = { firstName: "Maria", lastName: "Cruz", middleName: "", email: "guest@example.com", phoneNumber: "09171234567", address: "Taytay, Rizal", password: "secret123", confirmPassword: "secret123" };
function harness({ existing = false, confirmed = false, staff = false, delivery = true, settings = { external: { email: true }, mailer_autoconfirm: false }, configured = true, missingProfile = false, duplicateCode = "email_exists", signupError = null, linkError = null } = {}) {
  const database = catalogDatabase({ guests: existing ? [{ id: uuid(1), email: guest.email, first_name: "Original" }] : [], staff_users: staff ? [{ id: uuid(1) }] : [] });
  const user = { id: uuid(1), email: guest.email, email_confirmed_at: confirmed ? "2026-01-01" : null };
  const calls = { created: [], links: [], emails: [], signup: [], resend: [] };
  database.auth = { admin: {
    createUser: async (payload) => {
      calls.created.push(payload);
      if (existing) return { data: { user: null }, error: { code: duplicateCode, status: 422 } };
      if (!missingProfile) database.tables.guests.push({ id: user.id, email: payload.email, first_name: payload.user_metadata.first_name });
      return { data: { user }, error: null };
    },
    getUserById: async () => ({ data: { user }, error: null }),
    generateLink: async (payload) => { calls.links.push(payload); return { data: { properties: { hashed_token: "private-token", verification_type: "signup" }, user }, error: linkError }; },
  } };
  const mocks = {
    "@/lib/supabase/admin": { createAdminClient: () => database },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) },
    "@/lib/email": { isEmailConfigured: () => configured, sendGuestConfirmationEmail: async (payload) => { calls.emails.push(payload); return delivery; } },
    "@supabase/supabase-js": { createClient: () => ({ auth: {
      resend: async (payload) => { calls.resend.push(payload); return { error: null }; },
      signUp: async (payload) => {
        calls.signup.push(payload);
        if (signupError) return { data: { user: null }, error: signupError };
        if (!existing && !missingProfile) database.tables.guests.push({ id: user.id, email: payload.email, first_name: payload.options.data.first_name });
        return { data: { user: { ...user, identities: existing && confirmed ? [] : [{ id: user.id }] } }, error: null };
      },
    } }) },
  };
  const cache = new Map();
  const register = loadTsModule("app/api/auth/register/route.ts", mocks, cache).POST;
  const resend = loadTsModule("app/api/auth/resend-confirmation/route.ts", mocks, cache).POST;
  const perform = async (route, body) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => settings });
    try { return await route(new Request("https://resort.example/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })); }
    finally { globalThis.fetch = originalFetch; }
  };
  return { calls, database, register: (body = guest) => perform(register, body), resend: (body = { email: guest.email }) => perform(resend, body) };
}

test("registration creates an unconfirmed guest and sends its token through configured SMTP", async () => {
  const h = harness();
  const response = await h.register(); const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.success, true);
  assert.equal(h.calls.created[0].email_confirm, false);
  assert.equal(h.calls.created[0].user_metadata.first_name, "Maria");
  assert.equal(h.calls.links[0].password, "");
  assert.equal(h.calls.links[0].options, undefined);
  assert.equal(h.calls.emails[0].confirmationUrl, "https://resort.example/auth/confirm?token_hash=private-token&type=email");
  assert.equal(h.calls.signup.length, 0);
  assert.equal(JSON.stringify(result).includes("private-token"), false);
});
test("repeat registration resends without changing existing credentials or profile metadata", async () => {
  const h = harness({ existing: true });
  assert.equal((await h.register()).status, 200);
  assert.equal(h.calls.emails[0].guestName, "Original");
  assert.equal(h.database.tables.guests[0].first_name, "Original");
  assert.equal(h.calls.links[0].password, "");
  assert.equal(h.calls.links[0].options, undefined);
});

test("verified email registration is rejected without issuing confirmation or modifying the account", async () => {
  for (const configured of [true, false]) {
    const h = harness({ existing: true, confirmed: true, configured });
    const before = structuredClone(h.database.tables.guests);
    const response = await h.register({ ...guest, email: "GUEST@EXAMPLE.COM", password: "different123", confirmPassword: "different123", firstName: "Changed" });
    const result = await response.json();
    assert.equal(response.status, 409); assert.equal(result.code, "EMAIL_ALREADY_REGISTERED");
    assert.match(result.message, /already registered/); assert.match(result.message, /sign in or reset your password/);
    assert.notEqual(result.success, true); assert.equal(result.needsEmailConfirmation, undefined);
    assert.equal(h.calls.links.length, 0); assert.equal(h.calls.emails.length, 0);
    assert.equal(h.calls.resend.length, 0); assert.deepEqual(h.database.tables.guests, before); assert.equal(h.database.writes.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /different123|private-token|00000000/);
  }
});

test("duplicate Auth errors reject verified registration and preserve unconfirmed confirmation recovery", async () => {
  for (const duplicateCode of ["email_exists", "user_already_exists"]) {
    const verified = harness({ existing: true, confirmed: true, duplicateCode });
    assert.equal((await verified.register()).status, 409); assert.equal(verified.calls.emails.length, 0);
    const unconfirmed = harness({ existing: true, duplicateCode });
    assert.equal((await unconfirmed.register()).status, 200); assert.equal(unconfirmed.calls.emails.length, 1);
    const fallback = harness({ configured: false, signupError: { code: duplicateCode, message: "User already registered" } });
    const response = await fallback.register(); assert.equal(response.status, 409); assert.equal((await response.json()).code, "EMAIL_ALREADY_REGISTERED");
  }
  const fallback = harness({ existing: true, configured: false });
  assert.equal((await fallback.register()).status, 200); assert.equal(fallback.database.tables.guests[0].first_name, "Original");
});

test("confirmation during repeated registration returns an existing-account alert instead of delivery failure", async () => {
  const h = harness({ existing: true, linkError: { code: "email_exists" } });
  const response = await h.register(); assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "EMAIL_ALREADY_REGISTERED"); assert.equal(h.calls.emails.length, 0);
});
test("resend does not create accounts or send mail for unknown, confirmed, or staff addresses", async () => {
  for (const options of [{}, { existing: true, confirmed: true }, { existing: true, staff: true }]) {
    const h = harness(options);
    assert.equal((await h.resend()).status, 200);
    assert.equal(h.calls.created.length, 0); assert.equal(h.calls.links.length, 0); assert.equal(h.calls.emails.length, 0);
  }
});
test("registration exposes delivery failure without losing the unconfirmed account", async () => {
  const h = harness({ delivery: false });
  const result = await (await h.register()).json();
  assert.equal(result.success, true); assert.equal(result.confirmationEmailSent, false);
  assert.match(result.message, /could not be sent/);
  assert.equal(h.database.tables.guests.length, 1);
  const failedResend = harness({ existing: true, delivery: false });
  assert.equal((await failedResend.resend()).status, 502);
});
test("signup configuration and missing profiles are checked before sending", async () => {
  for (const settings of [{ external: { email: true }, mailer_autoconfirm: true }, { external: { email: true }, mailer_autoconfirm: false, disable_signup: true }]) {
    const h = harness({ settings }); assert.equal((await h.register()).status, 503); assert.equal(h.calls.created.length, 0);
  }
  const h = harness({ missingProfile: true }); assert.equal((await h.register()).status, 500); assert.equal(h.calls.emails.length, 0);
});
test("confirmation requests share a cooldown across signup and resend", async () => {
  const h = harness(); assert.equal((await h.register()).status, 200);
  assert.equal((await h.resend()).status, 429); assert.equal(h.calls.emails.length, 1);
});
test("invalid forms are rejected before account creation or delivery", async () => {
  const h = harness(); assert.equal((await h.register({ ...guest, email: "invalid" })).status, 400);
  assert.equal((await h.resend({ email: "invalid" })).status, 400); assert.equal(h.calls.created.length, 0);
});
test("registration API rejects spaced emails before creating accounts or sending confirmation", async () => {
  for (const configured of [true, false]) {
    const h = harness({ configured });
    for (const email of [" guest@example.com", "guest@example.com ", "guest @example.com", "guest\u00a0@example.com", "guest\u200b@example.com"]) {
      const response = await h.register({ ...guest, email });
      assert.equal(response.status, 400);
      assert.match((await response.json()).message, /without spaces/);
    }
    assert.equal(h.calls.created.length, 0); assert.equal(h.calls.signup.length, 0);
    assert.equal(h.calls.links.length, 0); assert.equal(h.calls.emails.length, 0);
    assert.equal(h.database.writes.length, 0);
  }
});
test("deployments without app SMTP preserve Supabase's mail delivery path", async () => {
  const h = harness({ configured: false }); assert.equal((await h.register()).status, 200); assert.equal(h.calls.signup.length, 1);
  assert.equal((await h.resend()).status, 200); assert.equal(h.calls.resend.length, 1); assert.equal(h.calls.created.length, 0);
});

test("confirmation templates include plain text, escape guest names and check SMTP acceptance", async () => {
  const previous = { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS };
  process.env.EMAIL_USER = "sender@example.com"; process.env.EMAIL_PASS = "test-password";
  const messages = [];
  try {
    const { sendGuestConfirmationEmail } = loadTsModule("lib/email.ts", { nodemailer: { createTransport: () => ({ sendMail: async (message) => { messages.push(message); return { accepted: messages.length === 1 ? [message.to] : [] }; } }) } });
    const payload = { email: "guest@example.com", guestName: "<Guest>", confirmationUrl: "https://resort.example/auth/confirm?token_hash=secret&type=email" };
    assert.equal(await sendGuestConfirmationEmail(payload), true);
    assert.equal(await sendGuestConfirmationEmail(payload), false);
    assert.match(messages[0].html, /&lt;Guest&gt;/); assert.doesNotMatch(messages[0].html, /Hi <Guest>/);
    assert.match(messages[0].text, /token_hash=secret&type=email/);
  } finally {
    for (const [key, value] of [["EMAIL_USER", previous.user], ["EMAIL_PASS", previous.pass]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
