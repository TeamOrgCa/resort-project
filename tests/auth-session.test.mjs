import assert from "node:assert/strict";
import { test } from "node:test";
import { getAuthSessionId } from "../lib/auth/auth-session.ts";

test("reads a Supabase session UUID from a JWT payload", () => {
  const id = "723f34bd-99fe-431a-8669-3731b60abd61";
  const payload = Buffer.from(JSON.stringify({ session_id: id })).toString("base64url");
  assert.equal(getAuthSessionId(`header.${payload}.signature`), id);
});

test("rejects tokens without a valid session UUID", () => {
  const payload = Buffer.from(JSON.stringify({ session_id: "invalid" })).toString("base64url");
  assert.equal(getAuthSessionId(`header.${payload}.signature`), null);
  assert.equal(getAuthSessionId("invalid"), null);
});
