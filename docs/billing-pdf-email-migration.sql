-- Apply after billing-document-email-migration.sql and role-permissions-migration.sql.
-- Safe to reapply: includes managers granted payment_entry or payment_approval.
-- Allow server-approved payments
-- to email billing documents, and record delivery of updated paid invoices.
begin;
create or replace function public.billing_email_enabled()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare enabled_value text;
begin
  if not coalesce(auth.role() = 'service_role' and auth.uid() is null, false) and not exists (
    select 1 from public.staff_users s
    where s.id = auth.uid() and s.is_active = true
      and (s.role in ('admin', 'cashier') or exists (
        select 1 from public.role_permissions rp
        where rp.role = s.role and rp.permissions && array['payment_entry', 'payment_approval']::text[]
      ))
  ) then
    raise exception 'Not authorized to read billing email setting' using errcode = '42501';
  end if;

  select setting_value->>'emailEnabled' into enabled_value
  from public.business_settings where setting_key = 'payments.receipt_settings';
  return enabled_value is distinct from 'false';
end;
$$;

revoke all on function public.billing_email_enabled() from public, anon;
grant execute on function public.billing_email_enabled() to authenticated, service_role;

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
  if not coalesce(auth.role() = 'service_role' and auth.uid() is null, false) and not exists (
    select 1 from public.staff_users s
    where s.id = auth.uid() and s.is_active = true
      and (s.role in ('admin', 'cashier') or exists (
        select 1 from public.role_permissions rp
        where rp.role = s.role and rp.permissions && array['payment_entry', 'payment_approval']::text[]
      ))
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
    where invoice_id = p_document_id;
  else
    raise exception 'Unknown billing document type' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.record_billing_email_delivery(text, uuid, boolean, text) from public, anon;
grant execute on function public.record_billing_email_delivery(text, uuid, boolean, text) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
