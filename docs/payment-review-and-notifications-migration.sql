-- Apply after reservation-lifecycle, role-permissions, staff-cash-payments,
-- cancellation-refund-workflow and admin-refund-verification migrations.
begin;
alter table public.payments add column if not exists rejection_reason text;
alter table public.audit_logs add column if not exists details jsonb;
grant update (rejection_reason) on public.payments to authenticated;

create or replace function public.can_review_payment(p_method uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_users s where s.id=auth.uid() and s.is_active
    and s.active_session_id is not null and s.active_session_id::text=auth.jwt()->>'session_id'
    and (s.role='admin' or exists(select 1 from public.role_permissions rp where rp.role=s.role
      and ('payment_approval'=any(rp.permissions) or ('payment_entry'=any(rp.permissions)
        and exists(select 1 from public.payment_methods m where m.payment_method_id=p_method and lower(btrim(m.type))='cash'))))));
$$;
revoke all on function public.can_review_payment(uuid) from public,anon;
grant execute on function public.can_review_payment(uuid) to authenticated;

drop policy if exists "Staff can verify payments" on public.payments;
drop policy if exists "Admin and cashier can review payments" on public.payments;
drop policy if exists "Authorized staff review payments" on public.payments;
create policy "Authorized staff review payments" on public.payments for update to authenticated
  using(public.can_review_payment(payment_method_id)) with check(public.can_review_payment(payment_method_id));

create or replace function public.guard_payment_review()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_r public.reservations%rowtype;
begin
  if old.status<>'pending' or new.status not in ('verified','rejected') or new.status is not distinct from old.status then
    raise exception 'Payment has already been reviewed or transition is invalid' using errcode='23514'; end if;
  if not public.can_review_payment(new.payment_method_id) or (new.status='rejected' and not exists
    (select 1 from public.staff_users s where s.id=auth.uid() and s.is_active and (s.role='admin' or exists
      (select 1 from public.role_permissions rp where rp.role=s.role and 'payment_approval'=any(rp.permissions))))) then
    raise exception 'Payment approval permission required' using errcode='42501'; end if;
  select * into v_r from public.reservations where reservation_id=new.reservation_id for update;
  if v_r.status not in ('payment_submitted','confirmed') then
    raise exception 'Reservation cannot accept this payment review' using errcode='40001'; end if;
  if new.status='verified' then
    new.verified_by:=auth.uid(); new.verified_at:=clock_timestamp(); new.rejection_reason:=null;
  else
    new.rejection_reason:=btrim(new.rejection_reason);
    if coalesce(length(new.rejection_reason),0) not between 5 and 2000 then
      raise exception 'A rejection reason of 5 to 2,000 characters is required' using errcode='22023'; end if;
    new.rejected_by:=auth.uid(); new.rejected_at:=clock_timestamp();
  end if;
  return new;
end $$;
drop trigger if exists guard_payment_review_trigger on public.payments;
create trigger guard_payment_review_trigger before update of status on public.payments
for each row execute function public.guard_payment_review();

create or replace function public.guard_payment_rejection_reason()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.rejection_reason is not null then raise exception 'A rejection reason may only be recorded during review' using errcode='23514'; end if;
  elsif new.rejection_reason is distinct from old.rejection_reason then
    if old.status<>'pending' or new.status<>'rejected' then
      raise exception 'The recorded payment rejection reason cannot be changed' using errcode='23514'; end if;
  end if;
  if tg_op='UPDATE' and old.status='pending' and new.status='rejected'
    and coalesce(length(btrim(new.rejection_reason)),0) not between 5 and 2000 then
    raise exception 'A rejection reason of 5 to 2,000 characters is required' using errcode='22023';
  end if;
  return new;
end $$;
drop trigger if exists guard_payment_rejection_reason on public.payments;
create trigger guard_payment_rejection_reason before insert or update of status,rejection_reason on public.payments
for each row execute function public.guard_payment_rejection_reason();

create or replace function public.finish_payment_review()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status='pending' and new.status in ('verified','rejected') then
    update public.reservations set status=case when new.status='verified' then 'confirmed' else 'rejected' end
      where reservation_id=new.reservation_id and status='payment_submitted';
    perform public.refresh_reservation_payment_totals(new.reservation_id);
    insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
      values(auth.uid(),auth.uid(),case when new.status='verified' then 'Approved payment verification' else 'Rejected payment verification' end,
        'payment',new.payment_id,jsonb_build_object('reservation_id',new.reservation_id,'amount',new.amount,
          'reference_number',new.reference_number,'status',new.status,'rejection_reason',new.rejection_reason));
  end if;
  return new;
end $$;
drop trigger if exists finish_payment_review_trigger on public.payments;
create trigger finish_payment_review_trigger after update of status on public.payments
for each row execute function public.finish_payment_review();

-- Normalize titles at the shared notification boundary, preserving the existing
-- atomic refund approval, payout and verification workflow.
create or replace function public.notify_refund_workflow(p_guest uuid,p_title text,p_message text,p_entity text,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_title text:=case lower(btrim(p_title))
  when 'refund reviewed' then 'Refund awaiting approval'
  when 'refund approved' then 'Refund approved'
  when 'refund rejected' then 'Refund request rejected'
  when 'refund payout submitted' then 'Refund transfer awaiting verification'
  when 'refund refunded' then 'Refund completed' else p_title end;
begin
  if p_guest is not null then
    insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
      values('guest',p_guest,auth.uid(),v_title,p_message,'/manage',p_entity,p_id);
  end if;
  insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
    select s.role,s.id,auth.uid(),v_title,p_message,'/admin/transactions?tab=refunds',p_entity,p_id
    from public.staff_users s where s.is_active and (s.role in ('admin','cashier') or exists
      (select 1 from public.role_permissions rp where rp.role=s.role and rp.permissions && array['refund_review','refund_payout','refund_verify']));
end $$;
revoke all on function public.notify_refund_workflow(uuid,text,text,text,uuid) from public,anon,authenticated;
update public.notifications set title='Refund completed' where lower(btrim(title))='refund refunded';
notify pgrst,'reload schema';
commit;
