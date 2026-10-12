import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

test("live guest signup stays unconfirmed until its email token is verified", { skip: process.env.RUN_GUEST_CONFIRMATION_INTEGRATION !== "1" }, async () => {
  const require = createRequire(import.meta.url);
  const { loadEnvConfig } = require("@next/env");
  loadEnvConfig(process.cwd());
  const { createClient } = await import("@supabase/supabase-js");
  const { NextRequest } = require("next/server");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const guestClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `confirmation-test+${randomUUID()}@example.com`;
  const password = `${randomUUID()}Aa1!`;
  const capturedMail = [];
  let ownedUserId = null;
  const createUser = admin.auth.admin.createUser.bind(admin.auth.admin);
  admin.auth.admin.createUser = async (payload) => {
    const result = await createUser(payload);
    if (!result.error && result.data.user?.email === email) ownedUserId = result.data.user.id;
    return result;
  };
  const mocks = {
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) },
    // Capture the generated email in memory; never send integration-test email.
    "@/lib/email": { isEmailConfigured: () => true, sendGuestConfirmationEmail: async (message) => { capturedMail.push(message); return true; } },
  };
  try {
    const { POST } = loadTsModule("app/api/auth/register/route.ts", mocks);
    const response = await POST(new Request("http://localhost:3000/api/auth/register", { method: "POST", body: JSON.stringify({ firstName: "Confirmation", lastName: "Test", middleName: "", email, password, confirmPassword: password, phoneNumber: "09171234567", address: "Integration test account" }) }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
    assert.ok(ownedUserId);
    assert.equal(capturedMail.length, 1);
    const before = await admin.auth.admin.getUserById(ownedUserId);
    assert.equal(Boolean(before.data.user.email_confirmed_at), false);
    const blocked = await guestClient.auth.signInWithPassword({ email, password });
    assert.ok(blocked.error);
    assert.equal(blocked.error.code, "email_not_confirmed");
    const { GET } = loadTsModule("app/auth/confirm/route.ts", mocks);
    const confirmation = await GET(new NextRequest(capturedMail[0].confirmationUrl));
    const destination = new URL(confirmation.headers.get("location"));
    assert.equal(destination.pathname, "/auth/login");
    assert.equal(destination.searchParams.get("confirmation"), "success");
    assert.equal(confirmation.headers.get("set-cookie"), null);
    const allowed = await guestClient.auth.signInWithPassword({ email, password });
    assert.equal(Boolean(allowed.error), false);
    assert.equal(allowed.data.user.id, ownedUserId);
    const reused = await GET(new NextRequest(capturedMail[0].confirmationUrl));
    assert.equal(new URL(reused.headers.get("location")).searchParams.get("confirmation"), "invalid");
  } finally {
    if (ownedUserId) {
      // Only delete the unique test account created in this exact run.
      const check = await admin.auth.admin.getUserById(ownedUserId);
      assert.equal(check.data.user?.email, email);
      const removed = await admin.auth.admin.deleteUser(ownedUserId);
      assert.equal(Boolean(removed.error), false);
    }
  }
});
