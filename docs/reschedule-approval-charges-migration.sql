-- Apply before deploying the reschedule approval API.
begin;
alter table public.reservation_reschedules
  add column if not exists rate_adjustment numeric(10,2) not null default 0;

create or replace function public.update_transaction_total()
returns trigger as $$
declare
    res_id uuid;

    v_total_units numeric := 0;
    v_total_services numeric := 0;
    v_total_guests numeric := 0;
    v_reschedule_charges numeric := 0;

    v_subtotal numeric := 0;
    v_total_due numeric := 0;

    v_nights int := 1;

    v_adult_rate numeric := 0;
    v_child_rate numeric := 0;

    v_adult_count int := 0;
    v_child_count int := 0;
begin

    res_id := coalesce(
        new.reservation_id,
        old.reservation_id
    );

    -- Get stay duration
    select
        greatest(
            1,
            ceil(
                extract(
                    epoch from (
                        r.end_datetime - r.start_datetime
                    )
                ) / 86400.0
            )
        )::int
    into v_nights
    from public.reservations r
    where r.reservation_id = res_id;

    -- Get guest counts and snapshot rates
    select
        coalesce(r.adult_rate_at_booking, 0),
        coalesce(r.child_rate_at_booking, 0),
        coalesce(r.adult_count, 0),
        coalesce(r.child_count, 0)
    into
        v_adult_rate,
        v_child_rate,
        v_adult_count,
        v_child_count
    from public.reservations r
    where r.reservation_id = res_id;

    -- Unit charges
    select
        coalesce(
            sum(
                ru.quantity *
                ru.price_per_night *
                v_nights
            ),
            0
        )
    into v_total_units
    from public.reservation_units ru
    where ru.reservation_id = res_id;

    -- Service charges
    select
        coalesce(
            sum(
                rs.quantity *
                rs.price_at_time
            ),
            0
        )
    into v_total_services
    from public.reservation_services rs
    where rs.reservation_id = res_id;

    -- Guest entrance fees
    v_total_guests :=
        (v_adult_count * v_adult_rate * v_nights)
        +
        (v_child_count * v_child_rate * v_nights);

    v_subtotal :=
        v_total_units
        + v_total_services
        + v_total_guests;

    select coalesce(sum(reschedule_fee + rate_adjustment), 0)
    into v_reschedule_charges
    from public.reservation_reschedules
    where reservation_id = res_id and status = 'approved';

    v_total_due :=
        round(v_subtotal::numeric, 2) + v_reschedule_charges;

    update public.transactions t
    set
        total_amount = v_total_due,
        status =
            case
                when t.paid_amount >= v_total_due
                     and v_total_due > 0
                then 'paid'

                when t.paid_amount > 0
                then 'partial'

                else 'unpaid'
            end
    where t.reservation_id = res_id;

    return null;
end;
$$ language plpgsql;


create or replace function public.approve_reschedule_request(
  p_reschedule_id uuid,
  p_staff_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.reservation_reschedules%rowtype;
  v_reservation public.reservations%rowtype;
  v_total numeric(10,2);
  v_paid numeric(10,2);
  v_new_total numeric(10,2);
  v_charge numeric(10,2);
  v_status text;
begin
  if not exists (select 1 from public.staff_users where id = p_staff_id and is_active = true) then
    raise exception 'Active staff account required';
  end if;

  select * into v_request from public.reservation_reschedules
  where reschedule_id = p_reschedule_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Reschedule request is no longer pending';
  end if;
  if v_request.new_start < now() + interval '30 minutes' then
    raise exception 'Requested start time is too soon';
  end if;

  select * into v_reservation from public.reservations
  where reservation_id = v_request.reservation_id for update;
  if not found or v_reservation.status <> 'reschedule_requested'
     or v_reservation.start_datetime <> v_request.old_start
     or v_reservation.end_datetime <> v_request.old_end then
    raise exception 'Reservation is no longer awaiting this reschedule';
  end if;

  v_charge := v_request.reschedule_fee + v_request.rate_adjustment;

  -- The reservation trigger recalculates the base transaction total.
  -- The exclusion constraint rejects a date taken since the guest requested it.
  update public.reservations set
    start_datetime = v_request.new_start,
    end_datetime = v_request.new_end,
    status = 'confirmed'
  where reservation_id = v_request.reservation_id;

  select total_amount, paid_amount into v_total, v_paid
  from public.transactions where reservation_id = v_request.reservation_id for update;
  if not found then raise exception 'Reservation transaction is missing'; end if;
  v_new_total := v_total + v_charge;
  v_status := case when coalesce(v_paid, 0) >= v_new_total then 'paid'
                   when coalesce(v_paid, 0) > 0 then 'partial' else 'unpaid' end;
  update public.transactions set total_amount = v_new_total, status = v_status
  where reservation_id = v_request.reservation_id;
  update public.invoices set total_amount = v_new_total
  where reservation_id = v_request.reservation_id;

  update public.reservation_reschedules set
    status = 'approved', approved_by = p_staff_id,
    approved_at = now(), rejection_reason = null
  where reschedule_id = p_reschedule_id;

  return jsonb_build_object(
    'reservationId', v_request.reservation_id,
    'totalAmount', v_new_total,
    'paidAmount', coalesce(v_paid, 0),
    'additionalCharge', v_charge
  );
end;
$$;

revoke all on function public.approve_reschedule_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_reschedule_request(uuid, uuid) to service_role;
commit;
