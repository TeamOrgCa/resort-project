-- Apply after admin-read-only-manager-refunds-migration.sql.
-- Correct existing and future notification titles without changing refund status.
begin;
create or replace function public.notify_refund_workflow(p_guest uuid,p_title text,p_message text,p_entity text,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_title text:=case when lower(btrim(p_title))='refund refunded' then 'Refund completed' else p_title end;
begin
  if p_guest is not null then
    insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
      values('guest',p_guest,auth.uid(),v_title,p_message,'/manage',p_entity,p_id);
  end if;
  insert into public.notifications(recipient_role,recipient_id,actor_id,title,message,action_url,entity_type,entity_id)
    select s.role,s.id,auth.uid(),v_title,p_message,'/admin/transactions?tab=refunds',p_entity,p_id
    from public.staff_users s where s.is_active and (s.role in ('admin','cashier') or exists
      (select 1 from public.role_permissions rp where rp.role=s.role and
        rp.permissions && array['refund_review','refund_approval','refund_payout','refund_verify']));
end $$;
revoke all on function public.notify_refund_workflow(uuid,text,text,text,uuid) from public,anon,authenticated;
update public.notifications set title='Refund completed' where lower(btrim(title))='refund refunded';
notify pgrst,'reload schema';
commit;
