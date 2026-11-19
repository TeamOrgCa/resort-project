-- Apply after review-attachment-moderation and admin-read-only-manager-refunds.
-- Admin moderation is always allowed. Manager moderation is opt-in through
-- role_permissions: both analytics and feedback_moderation must be enabled.
-- Other operational writes and feedback archival permissions remain unchanged.
begin;

create or replace function public.can_moderate_guest_reviews()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_users s where s.id=auth.uid() and s.is_active
    and s.active_session_id is not null and s.active_session_id::text=auth.jwt()->>'session_id'
    and (s.role='admin' or (s.role='staff' and exists(select 1 from public.role_permissions rp
      where rp.role=s.role and 'analytics'=any(rp.permissions) and 'feedback_moderation'=any(rp.permissions)))));
$$;
revoke all on function public.can_moderate_guest_reviews() from public,anon;
grant execute on function public.can_moderate_guest_reviews() to authenticated;

-- Replace only the reviews-table admin guard. The moderation RPC opens a narrow,
-- transaction-local context; ordinary admin inserts, updates and deletes still fail.
create or replace function public.guard_review_admin_write()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.staff_users where id=auth.uid() and role='admin') then
    if tg_op='UPDATE' then
      if public.can_moderate_guest_reviews() and current_setting('app.review_moderation',true)=old.review_id::text
        and not old.is_approved and old.archived_at is null and old.image_path is not null
        and (to_jsonb(new)-array['is_approved','archived_at','archived_by','archive_reason','updated_at'])
          is not distinct from (to_jsonb(old)-array['is_approved','archived_at','archived_by','archive_reason','updated_at']) then
        return new;
      end if;
    end if;
    raise exception 'Administrators may approve or reject review attachments through the moderation action only' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_review_admin_write() from public,anon,authenticated;
drop trigger if exists guard_admin_operational_write on public.reviews;
drop trigger if exists guard_review_admin_write on public.reviews;
create trigger guard_review_admin_write before insert or update or delete on public.reviews
for each row execute function public.guard_review_admin_write();

create or replace function public.guard_review_changes()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_moderating boolean := coalesce(current_setting('app.review_moderation',true)=old.review_id::text,false)
  and public.can_moderate_guest_reviews() and not old.is_approved and old.archived_at is null and old.image_path is not null;
begin
  if new.review_id is distinct from old.review_id or new.guest_id is distinct from old.guest_id or new.created_at is distinct from old.created_at then
    raise exception 'Feedback identity and submission time cannot be changed' using errcode='42501'; end if;
  if auth.uid() is not null and auth.uid()<>old.guest_id
    and (to_jsonb(new)-array['archived_at','archived_by','archive_reason','updated_at','is_approved']) is distinct from
      (to_jsonb(old)-array['archived_at','archived_by','archive_reason','updated_at','is_approved']) then
    raise exception 'Feedback permissions do not allow changing guest review content or ratings' using errcode='42501'; end if;
  if new.is_approved is distinct from old.is_approved and not v_moderating
    and not (new.is_approved=false and new.image_path is not null
      and (new.image_path is distinct from old.image_path or new.title is distinct from old.title or new.review_text is distinct from old.review_text)
      and (auth.uid()=old.guest_id or auth.uid() is null)) then
    raise exception 'Use the authorized review attachment moderation action' using errcode='42501'; end if;
  if new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by
    or new.archive_reason is distinct from old.archive_reason then
    if not v_moderating and not public.can_archive_feedback() then raise exception 'Feedback archive permission required' using errcode='42501'; end if;
    if (new.archived_at is null)=(old.archived_at is null) and (new.archived_at is distinct from old.archived_at
      or new.archived_by is distinct from old.archived_by or new.archive_reason is distinct from old.archive_reason) then
      raise exception 'Use an archive or restore action to change feedback status' using errcode='40001'; end if;
    if new.archived_at is distinct from old.archived_at then
      if length(btrim(coalesce(new.archive_reason,'')))<3 or length(new.archive_reason)>500 then
        raise exception 'Enter a reason between 3 and 500 characters' using errcode='22023'; end if;
      new.archived_at:=case when new.archived_at is null then null else clock_timestamp() end;
      new.archived_by:=case when new.archived_at is null then null else auth.uid() end;
      if not v_moderating then
        insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
          values(auth.uid(),auth.uid(),case when new.archived_at is null then 'Restored guest feedback' else 'Archived guest feedback' end,'review',new.review_id,
            jsonb_build_object('reason',new.archive_reason,'before_archived_at',old.archived_at,'archived_at',new.archived_at,'rating',old.overall_rating));
      end if;
    end if;
  end if;
  new.updated_at:=clock_timestamp();return new;
end $$;
revoke all on function public.guard_review_changes() from public,anon,authenticated;

create or replace function public.moderate_guest_review(p_review uuid,p_approve boolean,p_reason text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reviews%rowtype; v_setting text:=current_setting('app.review_moderation',true);
begin
  if not public.can_moderate_guest_reviews() then raise exception 'Review moderation permission required' using errcode='42501'; end if;
  if p_approve is null or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then
    raise exception 'Enter a reason between 3 and 500 characters' using errcode='22023'; end if;
  select * into r from public.reviews where review_id=p_review for update;
  if not found then raise exception 'Review not found' using errcode='P0002'; end if;
  if r.archived_at is not null or r.is_approved or r.image_path is null or r.updated_at is distinct from p_expected_updated_at then
    raise exception 'This review changed. Refresh before making a decision' using errcode='40001'; end if;
  perform set_config('app.review_moderation',p_review::text,true);
  update public.reviews set is_approved=p_approve,
    archived_at=case when p_approve then null else clock_timestamp() end,
    archive_reason=case when p_approve then null else btrim(p_reason) end where review_id=p_review;
  perform set_config('app.review_moderation',coalesce(v_setting,''),true);
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(auth.uid(),auth.uid(),case when p_approve then 'Approved guest review attachment' else 'Rejected guest review attachment' end,
      'review',p_review,jsonb_build_object('reason',btrim(p_reason),'approved',p_approve,'image_path',r.image_path));
  return jsonb_build_object('review_id',p_review,'is_approved',p_approve);
end $$;
revoke all on function public.moderate_guest_review(uuid,boolean,text,timestamptz) from public,anon;
grant execute on function public.moderate_guest_review(uuid,boolean,text,timestamptz) to authenticated;

-- Correct historical staff copies only. Guests keep their own submission messages.
update public.notifications set title='Review awaiting approval',
  message='A guest submitted a review with a photo. Review the text and attachment before approving or rejecting publication.'
where recipient_role in ('admin','staff') and entity_type='review' and title='Review submitted'
  and message ilike '%your review%photo%awaiting%approval%';
update public.notifications set title='New guest review',message='A guest submitted a new published review.'
where recipient_role in ('admin','staff') and entity_type='review' and title='Review submitted'
  and message='Thanks for sharing your experience.';

notify pgrst,'reload schema';
commit;
