-- Apply AFTER public-swimming-booking-migration.sql, swimming-room-addons-migration.sql
-- and private-swimming-room-reserve-migration.sql. Run once in the Supabase SQL editor.
-- Guest-declared eligibility is allowed only inside atomic private booking creation.
begin;

do $$ declare body text; existing_scope text := 'r.commercial_type=''public_swimming'' and not r.room_pricing and coalesce(current_setting(''app.public_guest_creation'',true),'''')=r.reservation_id::text';
begin
  body:=pg_get_functiondef('public.set_booking_discount(uuid,uuid,integer,text,numeric,text,boolean)'::regprocedure);
  if position('app.private_swimming_guest_creation' in body)=0 then
    if position(existing_scope in body)=0 then
      raise exception 'Apply the current public-swimming-booking migration before private swimming discounts';
    end if;
    body:=replace(body,existing_scope,'('||existing_scope||' or r.commercial_type=''private_swimming'' and not r.room_pricing and coalesce(current_setting(''app.private_swimming_guest_creation'',true),'''')=r.reservation_id::text)');
    execute body;
  end if;
end $$;

-- Keep the existing six-argument RPC for older clients and staff bookings.
-- Rooms, eligibility, the winning discount and the quoted net commit together.
create or replace function public.swimming_finalize_booking(p_reservation uuid,p_actor uuid,p_rooms jsonb,p_code text,p_expected_gross numeric,p_expected_net numeric,p_eligible integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; gross numeric; result jsonb;
begin
  perform pg_advisory_xact_lock(73124,1);
  select * into r from public.reservations where reservation_id=p_reservation for update;
  if not found or p_actor is null or r.guest_id is distinct from p_actor or r.commercial_type<>'private_swimming' or r.room_pricing then
    raise exception 'Only the private swimming booking owner may declare eligible guests' using errcode='42501';
  end if;
  if p_eligible is null or p_eligible<0 or p_eligible>r.adult_count+r.child_count then
    raise exception 'Eligible PWD/senior guests must be between zero and the number of guests' using errcode='22023';
  end if;
  if r.swimming_room_choices is not null then
    raise exception 'This booking is already finalized. Reload its saved bill' using errcode='40001';
  end if;
  perform public.swimming_attach_rooms(p_reservation,p_actor,p_rooms);
  select total_amount into gross from public.transactions where reservation_id=p_reservation for update;
  if gross is distinct from p_expected_gross then
    raise exception 'Room prices changed. Return to the form and review the total' using errcode='40001';
  end if;
  perform set_config('app.private_swimming_guest_creation',p_reservation::text,true);
  result:=public.set_booking_discount(p_reservation,p_actor,p_eligible,p_code,gross,'PWD/senior eligibility declared during private swimming booking',true);
  perform set_config('app.private_swimming_guest_creation','',true);
  if (result->>'totalAmount')::numeric is distinct from p_expected_net then
    raise exception 'The quoted discount changed. Return to the form and review the total' using errcode='40001';
  end if;
  return result;
end $$;

revoke all on function public.swimming_finalize_booking(uuid,uuid,jsonb,text,numeric,numeric,integer) from public,anon,authenticated;
grant execute on function public.swimming_finalize_booking(uuid,uuid,jsonb,text,numeric,numeric,integer) to service_role;
notify pgrst,'reload schema';
commit;
