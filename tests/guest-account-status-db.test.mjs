
import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const admin="11111111-1111-4111-8111-111111111111", guest="22222222-2222-4222-8222-222222222222", manager="33333333-3333-4333-8333-333333333333";
const session="44444444-4444-4444-8444-444444444444", booking="55555555-5555-4555-8555-555555555555";
let db;
const actor=async(id,sid=session)=>{ await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.session_id',$2,false)",[id??"",sid??""]); };
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const status=(active,expected=!active)=>one("select public.set_guest_account_status($1,$2,$3,'Access review') data",[guest,active,expected]).then(row=>row.data);
before(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('session_id',nullif(current_setting('request.jwt.claim.session_id',true),''))$$;
    grant usage on schema public,auth to authenticated,anon;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create table public.staff_users(id uuid primary key,role text,is_active boolean,active_session_id uuid);
    create table public.guests(id uuid primary key references auth.users,first_name text,last_name text,middle_name text,email text,phone_number text,
      created_at timestamptz default now(),updated_at timestamptz default now(),active_session_id uuid);
    create table public.audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
    create table public.reservations(reservation_id uuid primary key,guest_id uuid references public.guests,status text);
    create table public.payments(payment_id uuid primary key default gen_random_uuid(),reservation_id uuid references public.reservations,amount numeric);
    grant select,insert,update,delete on public.guests,public.reservations to authenticated;
    create function public.guest_test_rpc() returns void language sql security definer set search_path='' as $$update public.reservations set status='cancelled' where guest_id=auth.uid()$$;
  `);
  await db.exec(readFileSync("docs/guest-account-status-migration.sql","utf8"));
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec("reset role"); await actor(null);
  await db.exec("truncate public.guests,auth.users,public.staff_users,public.audit_logs,public.reservations,public.payments cascade");
  await db.query("insert into auth.users values($1,now()),($2,now()),($3,null)",[admin,guest,manager]);
  await db.query("insert into public.staff_users values($1,'admin',true,$3),($2,'staff',true,$3)",[admin,manager,session]);
  await db.query("insert into public.guests(id,first_name,last_name,email,phone_number,active_session_id) values($1,'Admin','Shadow','admin@example.com','09123456789',$4),($2,'Guest','Tester','guest@example.com','09999999999',$4),($3,'Manager','Shadow','manager@example.com','09123456789',$4)",[admin,guest,manager,session]);
  await db.query("insert into public.reservations values($1,$2,'confirmed')",[booking,guest]);
  await db.query("insert into public.payments(reservation_id,amount) values($1,3000)",[booking]);
  await actor(admin);
});
test("admin guest listing filters staff shadow profiles and searches guest names, email and phone",async()=>{
  let result=(await one("select public.admin_guest_accounts() data")).data;
  assert.equal(result.total,1);assert.equal(result.rows[0].id,guest);assert.equal(result.rows[0].email_confirmed,true);
  assert.equal((await one("select public.admin_guest_accounts('09999') data")).data.total,1);
  assert.equal((await one("select public.admin_guest_accounts('absent') data")).data.total,0);
  await status(false);assert.equal((await one("select public.admin_guest_accounts('','inactive') data")).data.total,1);
  assert.equal((await one("select public.admin_guest_accounts('','active') data")).data.total,0);
});
test("only an active admin with the current staff session can list or change guest status",async()=>{
  for(const [id,sid] of [[guest,session],[manager,session],[null,session],[admin,"66666666-6666-4666-8666-666666666666"]]){
    await actor(id,sid);await assert.rejects(()=>status(false),error=>error.code==="42501");
    await assert.rejects(()=>db.query("select public.admin_guest_accounts()"),error=>error.code==="42501");
  }
  await actor(null);await db.query("update public.staff_users set is_active=false where id=$1",[admin]);await actor(admin);
  await assert.rejects(()=>status(false),error=>error.code==="42501");
});
test("staff cannot promote themselves or forge a session to bypass guest-account administrator checks",async()=>{
  await actor(manager);
  await assert.rejects(()=>db.query("update public.staff_users set role='admin' where id=$1",[manager]),error=>error.code==="42501");
  await assert.rejects(()=>db.query("update public.staff_users set active_session_id=null where id=$1",[manager]),error=>error.code==="42501");
  await actor(admin);await db.query("update public.staff_users set is_active=false where id=$1",[manager]);
  await actor(manager);await assert.rejects(()=>db.query("update public.staff_users set is_active=true where id=$1",[manager]),error=>error.code==="42501");
});
test("deactivation clears sessions, preserves all billing and bookings, and audits the administrator and reason exactly once",async()=>{
  const result=await status(false);assert.equal(result.is_active,false);
  const profile=await one("select * from public.guests where id=$1",[guest]);assert.equal(profile.active_session_id,null);assert.equal(profile.is_active,false);
  assert.equal((await one("select status from public.reservations")).status,"confirmed");assert.equal((await one("select amount from public.payments")).amount,"3000");
  const audit=await one("select * from public.audit_logs");assert.equal(audit.user_id,admin);assert.equal(audit.action,"Guest deactivated");assert.equal(audit.details.reason,"Access review");
  await status(false,true);assert.equal((await one("select count(*)::int n from public.audit_logs")).n,1);
  await status(true);assert.equal((await one("select active_session_id from public.guests where id=$1",[guest])).active_session_id,null);
  assert.equal((await one("select count(*)::int n from public.audit_logs")).n,2);
});
test("guests cannot reactivate themselves, set an old session, or use an RPC to mutate reservations while inactive",async()=>{
  await status(false);await actor(guest);await db.exec("set role authenticated");
  try {
    await assert.rejects(()=>db.query("update public.guests set is_active=true where id=$1",[guest]),error=>error.code==="42501");
    await assert.rejects(()=>db.query("select public.guest_test_rpc()"),error=>error.code==="42501");
    await assert.rejects(()=>status(true),error=>error.code==="42501");
  }finally{await db.exec("reset role");}
  await actor(admin);await status(true);await actor(guest);
  await assert.rejects(()=>db.query("update public.guests set active_session_id=$2 where id=$1",[guest,session]),error=>error.code==="42501");
  await db.query("update public.guests set first_name='Updated' where id=$1",[guest]);
});
test("staff profiles are protected from guest-account controls and invalid/stale updates fail",async()=>{
  await assert.rejects(()=>db.query("select public.set_guest_account_status($1,false,true,null)",[manager]),error=>error.code==="22023");
  await assert.rejects(()=>status(false,false),error=>error.code==="40001");
  await assert.rejects(()=>db.query("select public.set_guest_account_status($1,false,true,null)",["77777777-7777-4777-8777-777777777777"]),error=>error.code==="P0002");
});
test("an audit failure rolls back deactivation and the migration is safe to reapply",async()=>{
  await db.exec("create function public.fail_guest_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable';end$$;create trigger fail_guest_audit before insert on public.audit_logs for each row execute function public.fail_guest_audit()");
  try{await assert.rejects(()=>status(false),/audit unavailable/);}finally{await db.exec("drop trigger fail_guest_audit on public.audit_logs");}
  assert.equal((await one("select is_active,active_session_id from public.guests where id=$1",[guest])).is_active,true);
  await status(false);await db.exec(readFileSync("docs/guest-account-status-migration.sql","utf8"));
  assert.equal((await one("select is_active from public.guests where id=$1",[guest])).is_active,false);
  assert.equal((await one("select count(*)::int n from public.audit_logs")).n,1);
});
