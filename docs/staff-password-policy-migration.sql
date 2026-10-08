alter table public.staff_users
  add column if not exists must_change_password boolean not null default false;

update public.staff_users
set must_change_password = true
where role in ('staff', 'cashier');