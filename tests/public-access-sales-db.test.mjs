import test,{before,beforeEach,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
const id=n=>`11111111-1111-4111-8111-${String(n).padStart(12,"0")}`;
const cashier=id(1),session=id(2),cash=id(3),bank=id(4),request=id(5),other=id(6);
const migration=readFileSync("docs/public-access-sales-migration.sql","utf8");let db;
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const actor=(user=cashier,sid=session)=>db.query("select set_config('fixture.user',$1,false),set_config('fixture.session',$2,false)",[user??"",sid??""]);
const record=(patch={})=>{const p={request,guest:"Maria Cruz",contact:"+639171234567",type:"swimming",paymentFor:"4 adults and one cottage",amount:1200,method:cash,reference:null,proof:null,received:true,...patch};return one("select public.record_public_access_sale($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result",Object.values(p)).then(r=>r.result);};
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('fixture.user',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('session_id',current_setting('fixture.session',true))$$;
 create table public.staff_users(id uuid primary key,role text,is_active boolean,active_session_id uuid);
 create table public.role_permissions(role text,permissions text[]);
 create table public.payment_methods(payment_method_id uuid primary key,name text,type text,is_active boolean);
 create table storage.objects(bucket_id text,name text);
 create table public.audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
 grant usage on schema public,auth to anon,authenticated;grant select on public.staff_users,public.role_permissions to authenticated;`);
 await db.query("insert into public.staff_users values($1,'cashier',true,$2),($3,'admin',true,$2)",[cashier,session,other]);
 await db.query("insert into public.payment_methods values($1,'Cash','cash',true),($2,'Bank transfer','bank',true)",[cash,bank]);
 await db.exec("insert into public.role_permissions values('cashier',array['transactions','payment_entry'])");
 await db.exec(migration);await db.exec(migration);
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec("reset role;truncate public.public_access_sales,public.audit_logs,storage.objects;update public.staff_users set is_active=true;update public.staff_users set role='cashier' where role='staff';update public.payment_methods set is_active=true;update public.role_permissions set permissions=array['transactions','payment_entry']");
 await actor();
});
test("public admissions save guest, contact, usage and payment receipt together with server time and audit",async()=>{
 const result=await record();assert.equal(result.alreadyRecorded,false);assert.equal(result.sale.guest_name,"Maria Cruz");assert.equal(Number(result.sale.amount),1200);
 assert.equal(result.sale.payment_method_name,"Cash");assert.match(result.sale.receipt_number,/PA-RCPT-/);assert.match(result.sale.reference_number,/PA-/);
 assert.equal(result.sale.cashier_id,cashier);assert.ok(Date.parse(result.sale.paid_at)>Date.parse("2026-01-01"));
 assert.equal((await one("select count(*)::int n from public.audit_logs")).n,1);
 assert.equal((await one("select details from public.audit_logs")).details.payment_for,"4 adults and one cottage");
});
test("retries and concurrent saves issue exactly one collection and receipt; conflicting changes fail",async()=>{
 const results=await Promise.all([record(),record()]);assert.equal(results.filter(r=>r.alreadyRecorded).length,1);
 assert.equal((await one("select count(*)::int n from public.public_access_sales")).n,1);
 assert.equal((await one("select count(*)::int n from public.audit_logs")).n,1);
 await assert.rejects(()=>record({amount:1300}),e=>e.code==="40001");
 await db.exec("update public.payment_methods set is_active=false");assert.equal((await record()).alreadyRecorded,true);
});
test("only a current cashier session with both grants can record admissions",async()=>{
 for(const user of [null,other]){await actor(user);await assert.rejects(()=>record(),e=>e.code==="42501");}
 await actor(cashier,other);await assert.rejects(()=>record(),e=>e.code==="42501");await actor();
 await db.exec("update public.staff_users set role='staff' where role='cashier'");await assert.rejects(()=>record(),e=>e.code==="42501");
 await db.exec("update public.staff_users set role='cashier' where role='staff';update public.role_permissions set permissions=array['transactions']");await assert.rejects(()=>record(),e=>e.code==="42501");
});
test("invalid money, missing acknowledgement, contact and inactive methods cannot create collections",async()=>{
 for(const patch of [{amount:0},{amount:1.001},{received:false},{contact:"123"},{type:"private"},{paymentFor:""}])await assert.rejects(()=>record(patch),e=>e.code==="22023");
 await db.exec("update public.payment_methods set is_active=false");await assert.rejects(()=>record(),e=>e.code==="22023");
 assert.equal((await one("select count(*)::int n from public.public_access_sales")).n,0);
});
test("transfers require owned proof and real unique references, with historical method names retained",async()=>{
 const proof=`${cashier}/staff/proof.pdf`;
 await assert.rejects(()=>record({method:bank,reference:"BANK-123456",proof}),e=>e.code==="22023");
 await db.query("insert into storage.objects values('payment-proofs',$1)",[proof]);
 const result=await record({method:bank,reference:"BANK-123456",proof});assert.equal(result.sale.proof_path,proof);
 await assert.rejects(()=>record({request:other,method:bank,reference:"BANK-123456",proof}),e=>e.code==="23505");
 await assert.rejects(()=>record({request:other,method:bank,reference:"bank123456",proof}),e=>e.code==="23505");
 await db.exec("update public.payment_methods set name='Renamed transfer'");assert.equal((await one("select payment_method_name from public.public_access_sales")).payment_method_name,"Bank transfer");
});
test("an audit failure rolls back collection and receipt creation",async()=>{
 await db.exec("create function public.fail_public_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable';end$$;create trigger fail_public_audit before insert on public.audit_logs for each row execute function public.fail_public_audit()");
 try{await assert.rejects(()=>record(),/audit unavailable/);assert.equal((await one("select count(*)::int n from public.public_access_sales")).n,0);}
 finally{await db.exec("drop trigger fail_public_audit on public.audit_logs");}
});
test("guests cannot read public contact records or bypass cashier entry through direct writes",async()=>{
 await record();await actor(null);await db.exec("set role authenticated");
 try{assert.equal((await one("select count(*)::int n from public.public_access_sales")).n,0);await assert.rejects(()=>db.exec("delete from public.public_access_sales"),e=>e.code==="42501");}
 finally{await db.exec("reset role");}
 await actor(other);await db.exec("set role authenticated");
 try{assert.equal((await one("select count(*)::int n from public.public_access_sales")).n,1);}
 finally{await db.exec("reset role");}
});
