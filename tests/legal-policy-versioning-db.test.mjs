import test,{before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
let db,baseline;
const admin="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",manager="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const migration=readFileSync("docs/legal-policy-versioning-migration.sql","utf8");
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const code=value=>error=>error.code===value;
before(async()=>{
  db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('fixture.actor',true),'')::uuid$$;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create table public.staff_users(id uuid primary key,role text,is_active boolean);
    create table public.guests(id uuid primary key references auth.users(id));
    create table public.reservations(reservation_id uuid primary key default gen_random_uuid(),guest_id uuid,reference_number text);
    create table public.reservation_policies(policy_id uuid primary key default gen_random_uuid(),title text not null,content text not null,display_order integer default 0,is_active boolean default true,updated_at timestamptz default now());
    create table public.audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
    create function public.new_guest() returns trigger language plpgsql security definer as $$begin insert into public.guests(id) values(new.id);return new;end$$;
    create trigger new_guest after insert on auth.users for each row execute function public.new_guest();`);
  await db.query("insert into public.staff_users values($1,'admin',true),($2,'staff',true)",[admin,manager]);
  await db.exec(migration);
  baseline=(await db.query("select * from public.reservation_policies order by document_type")).rows;
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec("truncate public.guests,public.reservations,public.audit_logs,public.reservation_policies");
  await db.exec("select set_config('app.legal_policy_publish','true',false)");
  for(const row of baseline)await db.query("insert into public.reservation_policies(policy_id,title,content,document_type,version,published_at,change_note,is_active) values($1,$2,$3,$4,$5,$6,$7,true)",[row.policy_id,row.title,row.content,row.document_type,row.version,row.published_at,row.change_note]);
  await db.exec("select set_config('app.legal_policy_publish','',false)");
  await db.query("select set_config('fixture.actor',$1,false)",[admin]);
});
const current=async()=> (await db.query("select * from public.get_legal_policies()")).rows;
const ids=()=>({terms:baseline.find(row=>row.document_type==="terms").policy_id,privacy:baseline.find(row=>row.document_type==="privacy").policy_id});
const publish=async({type="terms",expected=1,content="# Revised rules\n\nNew published legal text with sufficient content.",note="Clarify guest guidance"}={})=>(await one("select public.publish_legal_policy($1,$2,$3,$4,$5) policy",[type,type==="terms"?"Terms and Conditions":"Privacy Policy",content,note,expected])).policy;

test("migration seeds the existing Terms and Privacy text as independently numbered versions",async()=>{
  const rows=await current();assert.equal(rows.length,2);assert.ok(rows.every(row=>row.version===1));
  assert.ok(rows.find(row=>row.document_type==="terms").content.includes("# 1. Reservations and payment"));
  assert.ok(rows.find(row=>row.document_type==="privacy").content.includes("# 1. Information we collect"));
  assert.ok(rows.every(row=>!("published_by" in row)&&!("change_note" in row)));
});
test("publishing creates immutable history with its author, reason and audit, without changing the other document",async()=>{
  const next=await publish();assert.equal(next.version,2);assert.equal(next.published_by,admin);assert.equal(next.change_note,"Clarify guest guidance");
  assert.equal((await current()).find(row=>row.document_type==="privacy").version,1);
  const old=await one("select * from public.reservation_policies where policy_id=$1",[ids().terms]);assert.equal(old.is_active,false);assert.equal(old.content,baseline.find(row=>row.document_type==="terms").content);
  assert.equal((await one("select details from public.audit_logs")).details.new_version,2);
  for(const statement of ["update public.reservation_policies set content='overwritten' where document_type='terms'","update public.reservation_policies set is_active=false where document_type='privacy'","delete from public.reservation_policies where document_type='terms'"])
    await assert.rejects(db.exec(statement),code("42501"));
});
test("stale editors, non-admins and unchanged text cannot create a new version",async()=>{
  await publish();await assert.rejects(publish(),code("40001"));
  await db.query("select set_config('fixture.actor',$1,false)",[manager]);await assert.rejects(publish({type:"privacy"}),code("42501"));
  await db.exec("select set_config('fixture.actor','',false)");await assert.rejects(publish({type:"privacy"}),code("42501"));
  await db.query("select set_config('fixture.actor',$1,false)",[admin]);
  await assert.rejects(publish({expected:2}),code("22023"));assert.equal((await one("select count(*) n from public.audit_logs")).n,1);
});
test("an audit failure rolls publication and the current-version pointer back together",async()=>{
  await db.exec("create function public.fail_legal_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable';end$$;create trigger fail_legal_audit before insert on public.audit_logs for each row execute function public.fail_legal_audit()");
  try {await assert.rejects(publish(),/audit unavailable/);assert.ok((await current()).every(row=>row.version===1));assert.equal((await one("select count(*) n from public.reservation_policies")).n,2);}
  finally{await db.exec("drop trigger fail_legal_audit on public.audit_logs;drop function public.fail_legal_audit()");}
});
test("bookings retain accepted document IDs after publication and reject stale new acceptances or later rewriting",async()=>{
  const pair=ids(),reservation=randomUUID();
  await db.query("insert into public.reservations(reservation_id,terms_policy_id,privacy_policy_id,legal_accepted_at) values($1,$2,$3,'1900-01-01')",[reservation,pair.terms,pair.privacy]);
  const saved=await one("select * from public.reservations");assert.ok(Date.parse(saved.legal_accepted_at)>Date.parse("2026-01-01"));
  const next=await publish();
  const retained=(await db.query("select * from public.get_legal_policies($1,$2)",[saved.terms_policy_id,saved.privacy_policy_id])).rows;assert.ok(retained.every(row=>row.version===1));
  await assert.rejects(db.query("insert into public.reservations(terms_policy_id,privacy_policy_id) values($1,$2)",[pair.terms,pair.privacy]),code("40001"));
  await assert.rejects(db.query("update public.reservations set terms_policy_id=$1",[next.policy_id]),code("42501"));
  assert.equal((await one("select count(*) n from public.reservations")).n,1);
});
test("registration stores immutable acceptance separately from editable authentication metadata",async()=>{
  const pair=ids(),user=randomUUID();
  const legal_consent={terms_accepted:true,privacy_acknowledged:true,terms_policy_id:pair.terms,privacy_policy_id:pair.privacy,policy_version:"terms:1;privacy:1",accepted_at:"1900-01-01"};
  await db.query("insert into auth.users values($1,$2)",[user,{legal_consent}]);
  const guest=await one("select * from public.guests where id=$1",[user]);assert.equal(guest.terms_policy_id,pair.terms);assert.ok(Date.parse(guest.legal_accepted_at)>Date.parse("2026-01-01"));
  await db.query("update auth.users set raw_user_meta_data='{}' where id=$1",[user]);assert.equal((await one("select * from public.guests where id=$1",[user])).terms_policy_id,pair.terms);
  await assert.rejects(db.query("update public.guests set legal_accepted_at=now() where id=$1",[user]),code("42501"));
  await publish();const stale=randomUUID();await assert.rejects(db.query("insert into auth.users values($1,$2)",[stale,{legal_consent}]),code("40001"));
  assert.equal((await one("select count(*) n from auth.users where id=$1",[stale])).n,0);
});
test("public RPCs expose policy text while direct history and publishing remain restricted",async()=>{
  await db.exec("grant usage on schema public,auth to anon,authenticated;grant select on public.reservation_policies,public.staff_users to anon,authenticated;select set_config('fixture.actor','',false);set role anon");
  try {assert.equal((await current()).length,2);assert.equal((await db.query("select * from public.reservation_policies")).rows.length,0);await assert.rejects(publish(),code("42501"));}
  finally{await db.exec("reset role");}
});
test("reapplying the migration keeps published history and booking references intact",async()=>{
  const next=await publish();await db.exec(migration);assert.equal((await current()).find(row=>row.document_type==="terms").policy_id,next.policy_id);
  assert.equal((await one("select count(*) n from public.reservation_policies")).n,3);
});
