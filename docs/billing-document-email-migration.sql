-- Apply after additional-services-billing-migration.sql.
-- Records mail delivery without granting general UPDATE access to receipt rows.
create or replace function public.billing_email_enabled()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare enabled_value text;
begin
  if not exists (
    select 1 from public.staff_users
    where id = auth.uid() and is_active = true and role in ('admin', 'cashier')
  ) then
    raise exception 'Not authorized to read billing email setting' using errcode = '42501';
  end if;

  select setting_value->>'emailEnabled' into enabled_value
  from public.business_settings where setting_key = 'payments.receipt_settings';
  return enabled_value is distinct from 'false';
end;
$$;

revoke all on function public.billing_email_enabled() from public;
grant execute on function public.billing_email_enabled() to authenticated;

create or replace function public.record_billing_email_delivery(
  p_document_type text,
  p_document_id uuid,
  p_sent boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.staff_users
    where id = auth.uid() and is_active = true and role in ('admin', 'cashier')
  ) then
    raise exception 'Not authorized to record billing email delivery' using errcode = '42501';
  end if;

  if p_document_type = 'receipt' then
    update public.receipts
    set email_sent = p_sent,
        email_sent_at = case when p_sent then now() else null end,
        email_error = case when p_sent then null else left(coalesce(p_error, 'Email delivery failed'), 500) end
    where receipt_id = p_document_id and email_sent is not true;
  elsif p_document_type = 'invoice' then
    update public.invoices
    set email_sent = p_sent,
        email_sent_at = case when p_sent then now() else null end,
        email_error = case when p_sent then null else left(coalesce(p_error, 'Email delivery failed'), 500) end
    where invoice_id = p_document_id and email_sent is not true;
  else
    raise exception 'Unknown billing document type' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.record_billing_email_delivery(text, uuid, boolean, text) from public;
grant execute on function public.record_billing_email_delivery(text, uuid, boolean, text) to authenticated;

-- An added service changes the current invoice amount. Mark that invoice for
-- delivery again when its next payment is verified.
create or replace function public.reset_invoice_email_on_total_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.total_amount is distinct from old.total_amount then
    new.email_sent := false;
    new.email_sent_at := null;
    new.email_error := null;
  end if;
  return new;
end;
$$;

drop trigger if exists reset_invoice_email_on_total_change on public.invoices;
create trigger reset_invoice_email_on_total_change
before update of total_amount on public.invoices
for each row execute function public.reset_invoice_email_on_total_change();
