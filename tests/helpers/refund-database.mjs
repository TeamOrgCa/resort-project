import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const guest="11111111-1111-4111-8111-111111111111", other="33333333-3333-4333-8333-333333333333";
const admin="44444444-4444-4444-8444-444444444444", cashier="55555555-5555-4555-8555-555555555555";
const manager="66666666-6666-4666-8666-666666666666", reservation="22222222-2222-4222-8222-222222222222";

const workflowMigration=readFileSync("docs/manager-cashier-refund-workflow-migration.sql","utf8");
const migration=readFileSync("docs/admin-read-only-manager-refunds-migration.sql","utf8");
export async function createRefundDatabase() { let db;
db=new PGlite();await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.guests(id uuid primary key);
    create table public.staff_users(id uuid primary key,role text,is_active boolean);
    create table public.role_permissions(role text primary key,permissions text[]);
    create table public.booking_policy_versions(version bigint primary key,cancellation_text text,refund_text text,refund_review_enabled boolean,guest_cancellation_notice_hours integer);
    create table public.reservations(reservation_id uuid primary key,guest_id uuid references public.guests,reference_number text,status text,start_datetime timestamptz,
      end_datetime timestamptz,checked_in_at timestamptz,booking_policy_version bigint,payment_deadline_at timestamptz,cancelled_at timestamptz,cancellation_reason text,created_at timestamptz default now());
    create table public.transactions(reservation_id uuid primary key references public.reservations,total_amount numeric(10,2),paid_amount numeric(10,2) default 0,status text,
      balance numeric generated always as (greatest(total_amount-paid_amount,0)) stored,overpaid_amount numeric generated always as (greatest(paid_amount-total_amount,0)) stored);
    create table public.payments(payment_id uuid primary key default gen_random_uuid(),reservation_id uuid references public.reservations,amount numeric,status text,verified_at timestamptz default now(),created_at timestamptz default now());
    create table public.receipts(receipt_id uuid primary key default gen_random_uuid(),payment_id uuid references public.payments,transaction_total_at_time numeric,issued_at timestamptz default now());
    create table public.payment_methods(payment_method_id uuid primary key default gen_random_uuid(),name text,is_active boolean);
    insert into public.payment_methods(name,is_active) values('GCash',true),('Bank transfer',true),('Inactive wallet',false);
    create table public.refund_requests(refund_id uuid primary key default gen_random_uuid(),reservation_id uuid unique references public.reservations,guest_id uuid,
      amount numeric(10,2) check(amount>0),policy_snapshot text,policy_version bigint,status text default 'pending' check(status in ('pending','approved','rejected','refunded')),
      requested_at timestamptz default now(),reviewed_by uuid,reviewed_at timestamptz,review_reason text,refunded_by uuid,refunded_at timestamptz,gcash_reference text,proof_path text,
      check(status<>'refunded' or (gcash_reference is not null and proof_path is not null and refunded_at is not null)));
    create table public.invoices(reservation_id uuid references public.reservations,status text);
    create table public.reservation_reschedules(reservation_id uuid references public.reservations,status text);
    create table public.audit_logs(user_id uuid,auth_user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
    create table public.reservation_status_logs(reservation_id uuid references public.reservations,old_status text,new_status text,changed_by uuid references public.staff_users);
    create table public.notifications(recipient_role text,recipient_id uuid,actor_id uuid,title text,message text,action_url text,entity_type text,entity_id uuid);
    create table storage.objects(bucket_id text,name text);
    create function public.update_transaction_paid_amount() returns trigger language plpgsql as $$begin return null;end$$;
    create trigger update_paid after insert or update or delete on public.payments for each row execute function public.update_transaction_paid_amount();
    insert into public.guests values('${guest}'),('${other}');
    insert into public.staff_users values('${admin}','admin',true),('${cashier}','cashier',true);
    insert into public.role_permissions values('cashier',array['transactions','payment_approval']);
    insert into public.booking_policy_versions values(1,'Cancellation policy','Downpayment non-refundable',true,48);
  
 create table public.maintenance_blocks(block_id uuid primary key default gen_random_uuid(),name text,reason text,start_date date,end_date date,status text default 'active',created_by uuid,released_by uuid,released_at timestamptz);
 create function public.expire_unpaid_reservations() returns void language sql as $$select$$;
 create table public.units(name text);
 create table public.business_settings(name text);
 insert into public.staff_users values('${manager}','staff',true);
 insert into public.role_permissions values('staff',array['reservations','cancel_reservation','edit_reservation','refund_review','refund_payout','refund_verify']);
 `);
 await db.exec(readFileSync("docs/overpayment-refunds-migration.sql","utf8"));
 await db.exec(readFileSync("docs/cancellation-refund-workflow-migration.sql","utf8"));
 await db.exec(migration);
 await db.exec("alter table public.reservation_reschedules add column reschedule_fee numeric default 0;create table public.reservation_reschedule_adjustments(reservation_id uuid references public.reservations,notice_fee numeric);");
 await db.exec(readFileSync("docs/non-refundable-reschedule-fees-migration.sql","utf8"));
 await db.exec(workflowMigration);

return db;
}

