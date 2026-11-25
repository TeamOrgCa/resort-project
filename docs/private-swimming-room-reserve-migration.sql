-- Apply AFTER swimming-room-addons-migration.sql and room-online-time-slots-migration.sql.
-- Permanently dedicate two Standard rooms to the included private pool package.
-- Existing reservations/assignments are preserved; rooms held by other booking
-- types are skipped when choosing the dedicated pair. Re-running is safe.
begin;
select pg_advisory_xact_lock(73124,1);
alter table public.physical_rooms add column if not exists private_swimming_only boolean not null default false;

do $$ declare dedicated integer; begin
  select count(*) into dedicated from public.physical_rooms where private_swimming_only;
  if dedicated=0 then
    update public.physical_rooms set private_swimming_only=true where room_id in (
      select pr.room_id from public.physical_rooms pr join public.room_classifications c using(classification_id)
      where c.code='standard' and pr.is_active and pr.status<>'maintenance' and not exists (
        select 1 from public.room_assignments a join public.reservations r using(reservation_id)
        where a.room_id=pr.room_id and (r.commercial_type<>'private_swimming' or r.room_pricing)
          and (a.state='occupied' or a.state='reserved' and a.expected_checkout>clock_timestamp()
            and r.status in ('pending','payment_submitted','confirmed','reschedule_requested')
            and (r.status<>'pending' or r.payment_deadline_at is null or r.payment_deadline_at>clock_timestamp()))
      ) order by pr.room_number limit 2
    );
  end if;
  if (select count(*) from public.physical_rooms where private_swimming_only)<>2 or exists (
    select 1 from public.physical_rooms pr join public.room_classifications c using(classification_id)
    where pr.private_swimming_only and (c.code<>'standard' or not pr.is_active)
  ) then
    raise exception 'Two active Standard rooms must be available to dedicate to private swimming. Resolve existing room bookings or maintenance, then retry this migration';
  end if;
end $$;

-- Enforce the restriction for every booking path, including manual assignments,
-- legacy catalog claims and transfers. A room-only bill labeled private swimming
-- is still a room-only booking and cannot use these rooms.
create or replace function public.room_guard_private_package_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.state in ('reserved','occupied') and exists(select 1 from public.physical_rooms where room_id=new.room_id and private_swimming_only)
    and not exists(select 1 from public.reservations where reservation_id=new.reservation_id and commercial_type='private_swimming' and not room_pricing) then
    raise exception 'This room is reserved for the included private swimming package. Choose another room' using errcode='40001';
  end if;
  return new;
end $$;
drop trigger if exists room_guard_private_package_assignment on public.room_assignments;
create trigger room_guard_private_package_assignment before insert or update on public.room_assignments for each row execute function public.room_guard_private_package_assignment();

create or replace function public.room_guard_private_package_reservation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (new.commercial_type<>'private_swimming' or new.room_pricing) and exists(
    select 1 from public.room_assignments a join public.physical_rooms pr using(room_id)
    where a.reservation_id=new.reservation_id and pr.private_swimming_only and a.state in ('reserved','occupied')
  ) then raise exception 'Release the dedicated private swimming rooms before changing this reservation type' using errcode='40001'; end if;
  return new;
end $$;
drop trigger if exists room_guard_private_package_reservation on public.reservations;
create trigger room_guard_private_package_reservation before update of commercial_type,room_pricing on public.reservations for each row execute function public.room_guard_private_package_reservation();

-- Housekeeping and maintenance remain available; the pair cannot be removed
-- from the private package by ordinary inventory edits or deactivation.
create or replace function public.room_guard_private_package_inventory()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    if old.private_swimming_only then raise exception 'Dedicated private swimming rooms cannot be deleted' using errcode='40001'; end if;
    return old;
  end if;
  if tg_op='INSERT' then
    if new.private_swimming_only then raise exception 'The two private swimming rooms are already configured' using errcode='40001'; end if;
  elsif new.private_swimming_only is distinct from old.private_swimming_only or
    old.private_swimming_only and (not new.is_active or new.classification_id is distinct from old.classification_id) then
    raise exception 'Keep the two dedicated Standard rooms active for private swimming. Use maintenance for temporary closures' using errcode='40001';
  end if;
  return new;
end $$;
drop trigger if exists room_guard_private_package_inventory on public.physical_rooms;
create trigger room_guard_private_package_inventory before insert or update or delete on public.physical_rooms for each row execute function public.room_guard_private_package_inventory();

-- Update the existing allocators without replacing their pricing, permissions,
-- payment, lead-time or request-idempotency logic. Fail if a prerequisite differs.
do $$ declare patch record; body text; begin
  for patch in select * from (values
    ('public.swimming_allocate_rooms(uuid,uuid,jsonb,boolean)',
      'where classification_id=c.classification_id and is_active and status<>''maintenance''',
      'where classification_id=c.classification_id and is_active and status<>''maintenance'' and private_swimming_only=p_included'),
    ('public.room_guest_reserve(uuid,uuid,jsonb)',
      'where classification_id=c.classification_id and is_active and status<>''maintenance''',
      'where classification_id=c.classification_id and is_active and status<>''maintenance'' and not private_swimming_only'),
    ('public.room_claim_catalog()',
      'where classification_id=link.classification_id and is_active',
      'where classification_id=link.classification_id and is_active and not private_swimming_only'),
    ('public.room_guest_catalog(timestamp with time zone,timestamp with time zone)',
      '''room_id'',r.room_id,''classification_id'',r.classification_id,',
      '''room_id'',r.room_id,''classification_id'',r.classification_id,''private_swimming_only'',r.private_swimming_only,')
  ) as changes(signature,needle,replacement) loop
    body:=pg_get_functiondef(to_regprocedure(patch.signature));
    if body is null then raise exception 'Missing prerequisite function: %',patch.signature; end if;
    if position('private_swimming_only' in body)=0 then
      if position(patch.needle in body)=0 then raise exception 'Unexpected function definition for %. Apply prerequisite migrations first',patch.signature; end if;
      execute replace(body,patch.needle,patch.replacement);
    end if;
  end loop;
end $$;

revoke all on function public.room_guard_private_package_assignment(),public.room_guard_private_package_reservation(),public.room_guard_private_package_inventory() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
