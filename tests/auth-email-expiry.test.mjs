import test, { after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server.js";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const savedSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-email-auth-secret";
after(() => { if (savedSecret === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = savedSecret; });
const auth = loadTsModule("lib/server/email-auth.ts");
const email = "cashier@gmail.com";
const sessionId = "11111111-1111-4111-8111-111111111111";
const jwt = `header.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url")}.signature`;
const request = body => new Request("https://resort.example/api/admin/auth/verify-otp", { method: "POST", body: JSON.stringify(body) });

test("OTP challenge expires at five minutes, is email-bound and cannot be tampered with", () => {
  const now = Date.now(), challenge = auth.createStaffOtpChallenge(email, now);
  assert.equal(auth.validateStaffOtpChallenge(challenge, email, now + 299999), true);
  assert.equal(auth.validateStaffOtpChallenge(challenge, email, now + 300000), false);
  assert.equal(auth.validateStaffOtpChallenge(challenge, email, now - 1), false);
  assert.equal(auth.validateStaffOtpChallenge(challenge, "another@gmail.com", now), false);
  assert.equal(auth.validateStaffOtpChallenge(challenge + "x", email, now), false);
  assert.equal(auth.validateStaffOtpChallenge(undefined, email, now), false);
});

test("OTP endpoint refuses missing, expired, mismatched and forged challenges before authenticating", async () => {
  for (const challenge of [undefined, auth.createStaffOtpChallenge(email, Date.now() - 300001), auth.createStaffOtpChallenge("another@gmail.com"), "forged.signature"]) {
    let verified = 0;
    const { POST } = loadTsModule("app/api/admin/auth/verify-otp/route.ts", {
      "next/headers": { cookies: async () => ({ get: key => key === auth.STAFF_OTP_COOKIE && challenge ? { value: challenge } : undefined }) },
      "@/lib/supabase/server": { createClient: async () => { verified++; throw new Error("Must not authenticate"); } },
    });
    const response = await POST(request({ email, token: "123456" }));
    assert.equal(response.status, 401); assert.equal(verified, 0);
    assert.match((await response.json()).message, /5 minutes/);
    assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  }
});

test("valid OTP completes staff login and clears its challenge; wrong codes cannot complete login", async () => {
  for (const valid of [false, true]) {
    let completed = 0;
    const { POST } = loadTsModule("app/api/admin/auth/verify-otp/route.ts", {
      "next/headers": { cookies: async () => ({ get: key => key === auth.STAFF_OTP_COOKIE ? { value: auth.createStaffOtpChallenge(email) } : undefined }) },
      "@/lib/supabase/server": { createClient: async () => ({ auth: { verifyOtp: async input => {
        assert.deepEqual(input, { email, token: "123456", type: "email" });
        return valid ? { data: { user: { id: "staff" }, session: { access_token: jwt } }, error: null } : { data: {}, error: Error("Invalid code") };
      } } }) },
      "@/lib/supabase/admin": { createAdminClient: () => ({}) },
      "@/lib/server/staff-login": { completeStaffLogin: async () => { completed++; return NextResponse.json({ success: true }); } },
    });
    const response = await POST(request({ email, token: "123456" }));
    assert.equal(response.status, valid ? 200 : 401); assert.equal(completed, valid ? 1 : 0);
    if (valid) assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  }
});

test("staff password login sends the branded code and sets a five-minute HTTP-only challenge only after delivery", async () => {
  for (const delivered of [false, true]) {
    let signedOut = 0, sent = 0;
    const { POST } = loadTsModule("app/api/admin/auth/login/route.ts", {
      "@/lib/server/login-access": {
        loginAccess: async () => ({ email, user: { id: "staff" }, authSessionId: sessionId, deviceId: sessionId, finish: r => r,
          admin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_active: true }, error: null }) }) }) }), auth: { admin: { generateLink: async () => ({ data: { user: { id: "staff" }, properties: { verification_type: "magiclink", email_otp: "12345678" } }, error: null }) } } },
          supabase: { auth: { signOut: async () => { signedOut++; } } } }),
        loginError: (message, status) => NextResponse.json({ message }, { status }), recordAttempt: async () => {},
      },
      "@/lib/email": { isEmailConfigured: () => true, sendStaffOtpEmail: async payload => { assert.equal(payload.code, "12345678"); sent++; return delivered; } },
    });
    const response = await POST(request({ email, password: "secret123" }));
    assert.equal(signedOut, 1); assert.equal(sent, 1); assert.equal(response.status, delivered ? 200 : 502);
    if (delivered) { assert.match(response.headers.get("set-cookie"), /Max-Age=300/); assert.match(response.headers.get("set-cookie"), /HttpOnly/); assert.match((await response.json()).message, /5 minutes/); }
    else assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("reset links preserve portal, reject signature changes and expire at five minutes", () => {
  const now = Date.now();
  for (const staff of [false, true]) {
    const url = new URL(auth.passwordResetUrl(new Request("https://resort.example"), "private-token", staff, now));
    assert.equal(url.pathname, staff ? "/auth/confirm/staff" : "/auth/confirm");
    assert.equal(auth.validPasswordResetExpiry(url, staff, now + 299999), true);
    assert.equal(auth.validPasswordResetExpiry(url, staff, now + 300000), false);
    assert.equal(auth.validPasswordResetExpiry(url, !staff, now), false);
    url.searchParams.set("token_hash", "forged"); assert.equal(auth.validPasswordResetExpiry(url, staff, now), false);
  }
});

test("both recovery callbacks enforce provider age even when expiry parameters are removed", async () => {
  for (const staff of [false, true]) for (const expired of [false, true]) for (const pkce of [false, true]) {
    let signedOut = 0;
    const result = { data: { user: { recovery_sent_at: new Date(Date.now() - (expired ? 300001 : 1000)).toISOString() } }, error: null };
    const { GET } = loadTsModule(staff ? "app/auth/confirm/staff/route.ts" : "app/auth/confirm/route.ts", {
      "@/lib/supabase/server": { createClient: async () => ({ auth: { verifyOtp: async () => result, exchangeCodeForSession: async () => result, signOut: async () => { signedOut++; } } }) },
    });
    const response = await GET(new NextRequest(`https://resort.example/auth/confirm${staff ? "/staff" : ""}?${pkce ? "code=provider-code" : "token_hash=provider-token&type=recovery"}`));
    const destination = new URL(response.headers.get("location"));
    assert.equal(destination.pathname, "/auth/reset"); assert.equal(destination.searchParams.get("staff"), staff ? "1" : null);
    assert.equal(destination.searchParams.get("error"), expired ? "invalid_link" : null); assert.equal(signedOut, expired ? 1 : 0);
  }
});

test("password reset emails target existing accounts only and do not disclose tokens or account existence", async () => {
  for (const staff of [false, true]) for (const exists of [false, true]) {
    const sent = [], links = [];
    const { POST } = loadTsModule("app/api/auth/forgot-password/route.ts", {
      "@/lib/server/guest-confirmation": { limitConfirmationRequests: () => {}, GuestConfirmationError: class extends Error {} },
      "@/lib/email": { isEmailConfigured: () => true, sendPasswordResetEmail: async payload => { sent.push(payload); return true; } },
      "@/lib/supabase/admin": { createAdminClient: () => ({
        from: table => { assert.equal(table, staff ? "staff_users" : "guests"); return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: exists ? { id: "account" } : null, error: null }) }) }) }; },
        auth: { admin: { generateLink: async payload => { links.push(payload); return { data: { user: { id: "account" }, properties: { hashed_token: "private-token", verification_type: "recovery" } }, error: null }; } } },
      }) },
    });
    const response = await POST(request({ email, staff }));
    assert.equal(response.status, 200); const body = await response.json();
    assert.match(body.message, /5 minutes/); assert.doesNotMatch(JSON.stringify(body), /private-token/);
    assert.equal(sent.length, exists ? 1 : 0); assert.equal(links.length, exists ? 1 : 0);
    if (exists) assert.equal(new URL(sent[0].resetUrl).pathname, staff ? "/auth/confirm/staff" : "/auth/confirm");
  }
});
