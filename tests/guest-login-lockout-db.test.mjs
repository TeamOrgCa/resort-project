import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
let db;
const email = "guest@example.com", device = "00000000-0000-4000-8000-000000000001";
const state = async () => (await db.query("select public.guest_login_attempt_state($1) as value", [email])).rows[0].value;
const attempt = async (result = "failed", kind = "guest") => (await db.query("select public.record_login_attempt($1,$2,$3,$4) as value", [email,device,kind,result])).rows[0].value;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.login_lock_state(email text primary key,failed_attempts integer default 0,locked_until timestamptz,updated_at timestamptz default now());
    create table public.audit_logs(action text,entity_type text,attempted_email text,auth_user_id uuid,device_id uuid);`);
  await db.exec(readFileSync("docs/guest-login-lockout-migration.sql", "utf8"));
});
beforeEach(async () => db.exec("truncate public.login_lock_state,public.audit_logs"));
after(async () => db?.close());

test("four guest failures exhaust the server-side counter and lock for one minute", async () => {
  assert.equal((await state()).attemptsRemaining,4);
  for (const remaining of [3,2,1]) {
    assert.equal(await attempt(), null);
    assert.equal((await state()).attemptsRemaining,remaining);
  }
  const locked = await attempt(); assert.ok(locked);
  const snapshot = await state(); assert.equal(snapshot.attemptsRemaining,0);
  const seconds = (Date.parse(snapshot.lockedUntil)-Date.now())/1000;
  assert.ok(seconds > 55 && seconds <= 61);
  await attempt(); assert.equal((await state()).lockedUntil,snapshot.lockedUntil,"in-flight failures cannot extend the timeout");
});
test("expiry restores four attempts and the next failure starts a fresh counter", async () => {
  for(let i=0;i<4;i++) await attempt();
  await db.exec("update public.login_lock_state set locked_until=now()-interval '1 second'");
  assert.equal((await state()).attemptsRemaining,4);
  assert.equal(await attempt(),null); assert.equal((await state()).attemptsRemaining,3);
});
test("successful login resets failures while confirmation reminders and blocked requests do not consume attempts", async () => {
  await attempt(); await attempt("denied"); await attempt("blocked");
  assert.equal((await state()).attemptsRemaining,3);
  await attempt("success"); assert.equal((await state()).attemptsRemaining,4);
});
test("staff retain five attempts and guest lock state is not exposed directly to browser roles", async () => {
  for(let i=0;i<4;i++) assert.equal(await attempt("failed","staff"),null);
  assert.ok(await attempt("failed","staff"));
  await db.exec("set role authenticated");
  try { await assert.rejects(state(), /permission denied/); }
  finally { await db.exec("reset role"); }
});
