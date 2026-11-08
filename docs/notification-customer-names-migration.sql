-- Apply after reservation, billing, refund and guest-reschedule migrations.
-- Enrich both existing and future booking notifications without changing recipients.
begin;
create or replace function public.add_notification_customer_name()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_res uuid; v_ref text; v_name text; v_label text; v_candidate text;
begin
  case new.entity_type
    when 'reservation' then v_res:=new.entity_id;
    when 'payment' then select reservation_id into v_res from public.payments where payment_id=new.entity_id;
    when 'refund_request' then select reservation_id into v_res from public.refund_requests where refund_id=new.entity_id;
    when 'reservation_reschedule' then select reservation_id into v_res from public.reservation_reschedules where reschedule_id=new.entity_id;
    when 'transaction' then select reservation_id into v_res from public.transactions where transaction_id=new.entity_id;
    when 'invoice' then select reservation_id into v_res from public.invoices where invoice_id=new.entity_id;
    when 'receipt' then select p.reservation_id into v_res from public.receipts c join public.payments p on p.payment_id=c.payment_id where c.receipt_id=new.entity_id;
    else null;
  end case;
  -- Some historical notifications have no entity link, only a booking reference.
  if v_res is null then
    v_candidate:=substring(concat_ws(' ',new.title,new.message) from '\m(?:SR|MV)-[A-Z0-9-]+\M');
    if v_candidate is not null then
      select reservation_id into v_res from public.reservations where reference_number=v_candidate;
    end if;
  end if;
  if v_res is null then return new; end if;
  select r.reference_number,nullif(btrim(concat_ws(' ',coalesce(g.first_name,w.first_name),coalesce(g.middle_name,w.middle_name),coalesce(g.last_name,w.last_name))),'')
    into v_ref,v_name
    from public.reservations r left join public.guests g on g.id=r.guest_id
    left join public.walk_in_guests w on w.walk_in_guest_id=r.walk_in_guest_id
    where r.reservation_id=v_res and (auth.uid() is null or r.guest_id=auth.uid()
      or exists(select 1 from public.staff_users where id=auth.uid() and is_active));
  if v_ref is null or v_name is null then return new; end if;
  v_label:=v_name||' ('||v_ref||')';
  if position(v_label in new.title)=0 then new.title:=replace(new.title,v_ref,v_label); end if;
  if position(v_label in coalesce(new.message,''))=0 then
    if position(v_ref in coalesce(new.message,''))>0 then new.message:=replace(new.message,v_ref,v_label);
    else new.message:=v_label||case when coalesce(new.message,'')<>'' then E'\n'||new.message else '' end; end if;
  end if;
  return new;
end $$;
revoke all on function public.add_notification_customer_name() from public,anon,authenticated;
drop trigger if exists notification_customer_name on public.notifications;
create trigger notification_customer_name before insert or update of title,message,entity_type,entity_id
  on public.notifications for each row execute function public.add_notification_customer_name();
update public.notifications set message=message;
notify pgrst,'reload schema';
commit;
