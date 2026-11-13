import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync("docs/review-feedback-management-migration.sql", "utf8");
const guest = "11111111-1111-4111-8111-111111111111", staff = "22222222-2222-4222-8222-222222222222", session = "33333333-3333-4333-8333-333333333333";
const completed = "44444444-4444-4444-8444-444444444444";
const completedMigration = readFileSync("docs/review-completed-stay-required-migration.sql", "utf8");
let db;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const auth = (id, sid = session) => one("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, session_id: sid })]);
const text = "Our family enjoyed the resort pool and the helpful staff during our visit.";
const insert = (title = "Our stay", reviewText = text, reservation = null) => one("insert into public.reviews(guest_id,title,review_text,reservation_id) values($1,$2,$3,$4) returning *", [guest, title, reviewText, reservation]);
const archive = (id, archived = true, expected = null) => one("select public.set_feedback_archived($1,$2,'Guest privacy request',$3) result", [id, archived, expected]);
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
    create function auth.uid() returns uuid language sql as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
    create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    create table public.guests(id uuid primary key,is_active boolean default true);
    create table public.staff_users(id uuid primary key,role text,is_active boolean,active_session_id uuid);
    create table public.role_permissions(role text primary key,permissions text[]);
    create table public.reservations(reservation_id uuid primary key,guest_id uuid,status text);
    create table public.reviews(review_id uuid primary key default gen_random_uuid(),guest_id uuid not null references public.guests,
      reservation_id uuid,overall_rating integer default 5,title text,review_text text,public_display_name text default 'Guest',image_path text,
      is_approved boolean default true,created_at timestamptz default now(),updated_at timestamptz default now());
    create unique index one_review_per_guest on public.reviews(guest_id);
    create unique index one_review_per_reservation on public.reviews(reservation_id) where reservation_id is not null;
    alter table public.reviews enable row level security;
    create table public.audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
    create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to anon,authenticated;
    grant select on public.reviews,storage.objects to anon;
    grant select,insert,update,delete on public.reviews to authenticated;
    grant select on public.staff_users,public.role_permissions to authenticated;
    insert into public.role_permissions values('staff',array['analytics']);`);
  await db.query("insert into public.guests(id) values($1)", [guest]);
  await db.query("insert into public.staff_users values($1,'staff',true,$2)", [staff, session]);
  await db.exec(migration);
  const stayMigration = readFileSync("docs/stay-completion-migration.sql", "utf8");
  for (const name of ["guard_review_completed_stay", "review_submission_status"]) {
    const start = stayMigration.indexOf(`create or replace function public.${name}(`);
    const end = stayMigration.indexOf("end $$;", start) + "end $$;".length;
    await db.exec(stayMigration.slice(start, end));
  }
  await db.exec("create trigger guard_review_completed_stay before insert or update of reservation_id,guest_id on public.reviews for each row execute function public.guard_review_completed_stay()");
  await db.exec(readFileSync("docs/review-without-completed-stay-migration.sql", "utf8"));
  for (let i = 0; i < 2; i++) await db.exec(completedMigration);
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("reset role;truncate public.reviews,public.review_submission_log,public.audit_logs,public.reservations,storage.objects;update public.guests set is_active=true;update public.role_permissions set permissions=array['analytics'];update public.staff_users set is_active=true");
  await auth(guest);
  await db.query("insert into public.reservations values($1,$2,'completed')",[completed,guest]);
});

test("reviews require a completed stay and linked reservations must be owned and completed", async () => {
  await db.exec("delete from public.reservations");
  await assert.rejects(()=>one("select public.review_submission_status($1,$2)",["General",text]),e=>e.code==="42501");
  await assert.rejects(()=>insert(),e=>e.code==="42501");
  for(const status of ["pending","confirmed","cancelled","expired","no_show"]){
    await db.query("insert into public.reservations values($1,$2,$3) on conflict(reservation_id) do update set status=excluded.status",[completed,guest,status]);
    await assert.rejects(()=>insert(),e=>e.code==="42501");
    await assert.rejects(()=>insert("Linked",text,completed),e=>e.code==="42501");
  }
  assert.equal((await one("select count(*)::int n from public.review_submission_log")).n,0);
  await db.exec("update public.reservations set status='completed'");
  assert.equal((await one("select public.review_submission_status($1,$2) result",["Our stay",text])).result.allowed,true);
  await insert();await db.exec("truncate public.reviews,public.review_submission_log");
  await insert("Linked",text,completed);await db.exec("truncate public.reviews,public.review_submission_log");
  await db.query("insert into public.reservations values($1,$2,'confirmed')",[session,guest]);
  await assert.rejects(()=>insert("Incomplete",text,session),e=>e.code==="42501");
  await db.query("update public.reservations set status='completed',guest_id=$1 where reservation_id=$2",[staff,session]);
  await assert.rejects(()=>insert("Not mine",text,session),e=>e.code==="42501");
  await db.exec("update public.guests set is_active=false");
  await assert.rejects(()=>one("select public.review_submission_status($1,$2)",["General",text]),e=>e.code==="42501");
  await assert.rejects(()=>insert(),e=>e.code==="42501");
});

test("restoring the rule preserves historical feedback and allows moderation without inventing completed stays",async()=>{
  await db.exec(readFileSync("docs/review-without-completed-stay-migration.sql","utf8"));
  await db.exec("delete from public.reservations");const review=await insert();
  await db.exec(completedMigration);await db.exec(completedMigration);
  assert.equal((await one("select count(*)::int n from public.reviews")).n,1);
  await assert.rejects(()=>insert("New feedback",text+" A new experience"),e=>e.code==="42501");
  await db.query("update public.reviews set reservation_id=reservation_id where review_id=$1",[review.review_id]);
  await auth(staff);await db.exec("update public.role_permissions set permissions=array['analytics','feedback_archive']");
  assert.ok((await archive(review.review_id)).result.archived_at);
});

test("multiple reviews are allowed with durable cooldowns, daily quotas and duplicate detection", async () => {
  await insert();
  await assert.rejects(() => insert("Another experience", text + " Another experience"), e => e.code === "P0429" && Number(e.detail) > 0);
  await assert.rejects(() => insert(" OUR  stay ", "  " + text.toUpperCase() + "  "), e => e.code === "P0409");
  await assert.rejects(() => insert("Changed title only"), e => e.code === "P0409");
  for (let i = 1; i < 3; i++) { await db.exec("update public.review_submission_log set created_at=clock_timestamp()-interval '20 minutes'"); await insert("Experience " + i, text + " Additional visit " + i); }
  await db.exec("update public.review_submission_log set created_at=clock_timestamp()-interval '20 minutes'");
  const policy = (await one("select public.review_submission_status('Fourth experience',$1) policy", [text + " Fourth visit"])).policy;
  assert.equal(policy.allowed, false); assert.equal(policy.code, "REVIEW_RATE_LIMITED"); assert.ok(policy.retryAfter > 80000);
  await db.exec("delete from public.reviews");
  await assert.rejects(() => insert("Fourth experience", text + " Fourth visit"), e => e.code === "P0429");
  assert.equal((await one("select count(*)::int n from public.review_submission_log")).n, 3);
  await db.exec("update public.review_submission_log set created_at=clock_timestamp()-interval '25 hours'");
  assert.ok((await insert("Fourth experience")).review_id);
});

test("simultaneous requests cannot create a burst and guests cannot forge timestamps or archive data", async () => {
  const results = await Promise.allSettled([insert("First"), insert("Second", text + " Second visit")]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.code, "P0429");
  const review = await one("select * from public.reviews");
  await assert.rejects(() => db.query("update public.reviews set created_at='2000-01-01'"), e => e.code === "42501");
  await assert.rejects(() => archive(review.review_id), e => e.code === "42501");
  await assert.rejects(() => db.query("update public.reviews set archived_at=now(),archive_reason='Forged'"), e => e.code === "42501");
});

test("archiving requires both permissions and a current staff session; archive and restore are audited", async () => {
  const review = await insert(); await auth(staff);
  await assert.rejects(() => archive(review.review_id), e => e.code === "42501");
  await db.exec("update public.role_permissions set permissions=array['analytics','feedback_archive']");
  await assert.rejects(() => db.exec("update public.reviews set review_text='Changed by staff'"), e => e.code === "42501");
  await auth(staff, guest); await assert.rejects(() => archive(review.review_id), e => e.code === "42501"); await auth(staff);
  const archived = (await archive(review.review_id)).result; assert.ok(archived.archived_at);
  await assert.rejects(() => archive(review.review_id), e => e.code === "40001");
  await archive(review.review_id, false, archived.archived_at);
  assert.equal((await one("select archived_at from public.reviews")).archived_at, null);
  assert.equal((await one("select count(*)::int n from public.audit_logs")).n, 2);
  assert.equal((await one("select count(*)::int n from public.review_submission_log")).n, 1);
});

test("archived reviews and photos are hidden from public reads, and guests cannot restore them", async () => {
  const review = await insert();
  await db.query("update public.reviews set image_path=$1", [guest + "/photo.png"]);
  await db.query("insert into storage.objects values('review-images',$1)", [guest + "/photo.png"]);
  await db.exec("set role anon"); assert.equal((await one("select count(*)::int n from storage.objects")).n, 1); await db.exec("reset role");
  await auth(staff); await db.exec("update public.role_permissions set permissions=array['analytics','feedback_archive']");
  await archive(review.review_id); await auth(guest);
  await db.exec("set role authenticated");
  assert.equal((await one("select count(*)::int n from public.reviews")).n, 0);
  const update = await db.query("update public.reviews set archived_at=null returning *"); assert.equal(update.rows.length, 0);
  await db.exec("reset role;set role anon"); assert.equal((await one("select count(*)::int n from public.reviews")).n, 0);
  assert.equal((await one("select count(*)::int n from storage.objects")).n, 0);
  await db.exec("reset role");
});

test("audit failure rolls back archive and a reservation still accepts only its own single review", async () => {
  await db.query("insert into public.reservations(reservation_id,guest_id,status) values($1,$2,'completed')", [session, guest]);
  const review = await insert("Linked visit", text, session);
  await db.exec("update public.review_submission_log set created_at=clock_timestamp()-interval '20 minutes'");
  await assert.rejects(() => insert("Another linked review", text + " New experience", session), e => e.code === "23505");
  assert.equal((await one("select count(*)::int n from public.review_submission_log")).n, 1);
  await auth(staff); await db.exec("update public.role_permissions set permissions=array['analytics','feedback_archive'];create function public.fail_feedback_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable';end$$;create trigger fail_feedback_audit before insert on public.audit_logs for each row execute function public.fail_feedback_audit()");
  try { await assert.rejects(() => archive(review.review_id), /audit unavailable/); }
  finally { await db.exec("drop trigger fail_feedback_audit on public.audit_logs"); }
  assert.equal((await one("select archived_at from public.reviews")).archived_at, null);
  await db.exec(migration); assert.equal((await one("select count(*)::int n from public.review_submission_log")).n, 1);
});
