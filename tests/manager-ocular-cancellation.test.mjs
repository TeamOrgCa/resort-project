import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const manager = "11111111-1111-4111-8111-111111111111", visit = "22222222-2222-4222-8222-222222222222", other = "33333333-3333-4333-8333-333333333333";

test("manager cancellation saves the reason and audit atomically, rejects closed visits and forged actors, and safely retries", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql as $$select nullif(current_setting('role',true),'none')$$;
      create table staff_users(id uuid primary key,role text,is_active boolean);
      create table role_permissions(role text primary key,permissions text[]);
      create table ocular_visits(visit_id uuid primary key,guest_id uuid,reference_number text,scheduled_date date,status text);
      create table audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
      insert into staff_users values('${manager}','staff',true),('${other}','admin',true);
      insert into role_permissions values('staff',array['ocular_approval']);
      insert into ocular_visits values('${visit}',null,'MV-OCULAR',current_date+1,'confirmed');`);
    const migration = readFileSync("docs/manager-ocular-cancellation-migration.sql", "utf8");
    await db.exec(migration); await db.exec(migration);
    const cancel = (actor = manager, reason = "Pool repairs require closing the resort") => db.query("select public.cancel_manager_ocular_visit($1,$2,$3) data", [visit,reason,actor]);
    await assert.rejects(cancel(other), error => error.code === "42501");
    await assert.rejects(cancel(manager, " "), error => error.code === "22023");
    await cancel(); await cancel();
    const saved = (await db.query("select * from ocular_visits")).rows[0];
    assert.equal(saved.status, "cancelled"); assert.equal(saved.cancelled_by, manager);
    assert.equal(saved.cancellation_reason, "Pool repairs require closing the resort");
    assert.ok(saved.cancelled_at); assert.equal((await db.query("select count(*)::int n from audit_logs")).rows[0].n, 1);
    await db.exec("update ocular_visits set status='completed'");
    await assert.rejects(cancel(), error => error.code === "40001");
    await db.exec(`grant usage on schema auth to authenticated; grant select on staff_users to authenticated; grant select,update on ocular_visits to authenticated;
      select set_config('request.jwt.claim.sub','${manager}',false); set role authenticated;`);
    await assert.rejects(cancel(), error => error.code === "42501");
    await assert.rejects(db.exec("update ocular_visits set status='cancelled'"), error => error.code === "42501");
    await db.exec("reset role");
  } finally { await db.close(); }
});

function harness({ role = "staff", allowed = true, rpcError = null, deliveryFails = false } = {}) {
  const calls = [], notifications = [];
  const staff = { staffUser: { id: manager, role }, supabase: {} };
  const admin = { rpc: async (name, args) => { calls.push({ name, args }); return { data: rpcError ? null : { visit_id: visit, guest_id: "guest", reference_number: "MV-OCULAR", scheduled_date: "2026-11-20", status: "cancelled", cancellation_reason: args.p_reason }, error: rpcError }; },
    from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { email: "guest@example.com", first_name: "Ana", last_name: "Santos" }, error: null }) }; return q; } };
  const { cancelManagerOcularVisit } = loadTsModule("lib/server/ocular-cancellation.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => staff },
    "@/lib/server/role-permissions": { staffHasPermission: async () => allowed },
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/notifications": { createNotifications: async value => { notifications.push(value); return { error: deliveryFails ? Error("Offline") : null }; } },
    "@/lib/email": { sendOcularVisitCancelledEmail: async () => { if (deliveryFails) throw Error("SMTP unavailable"); return true; } },
  });
  return { calls, notifications, post: body => cancelManagerOcularVisit(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) })) };
}

test("ocular cancellation API permits only managers with permission and a documented reason", async () => {
  const body = { visitId: visit, cancellationReason: "Maintenance requires closing" };
  for (const role of ["admin", "cashier"]) { const h = harness({ role }); assert.equal((await h.post(body)).status, 403); assert.equal(h.calls.length, 0); }
  assert.equal((await harness({ allowed: false }).post(body)).status, 403);
  assert.equal((await harness().post({ ...body, cancellationReason: "no" })).status, 400);
  const h = harness({ deliveryFails: true }); const response = await h.post(body); const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.visit.status, "cancelled");
  assert.equal(data.notificationSent, false); assert.equal(data.emailSent, false);
  assert.equal(h.calls[0].args.p_staff, manager); assert.equal(h.calls[0].args.p_reason, body.cancellationReason);
  assert.match(h.notifications[0].message, /Maintenance requires closing/);
  assert.equal((await harness({ rpcError: { code: "40001", message: "Visit already closed" } }).post(body)).status, 409);
});
