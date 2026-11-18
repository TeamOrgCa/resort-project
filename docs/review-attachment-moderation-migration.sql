-- Apply after review-images, review-feedback-management and completed-stay review migrations.
-- Existing published reviews are retained. New/edited attachments need approval.
begin;
create or replace function public.can_moderate_guest_reviews()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_users where id=auth.uid() and is_active and role='admin'
    and active_session_id is not null and active_session_id::text=auth.jwt()->>'session_id');
$$;
revoke all on function public.can_moderate_guest_reviews() from public,anon;
grant execute on function public.can_moderate_guest_reviews() to authenticated;

create or replace function public.queue_review_attachment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.image_path is not null then
    if tg_op='INSERT' then new.is_approved:=false;
    elsif new.image_path is distinct from old.image_path or new.title is distinct from old.title or new.review_text is distinct from old.review_text then
      new.is_approved:=false;
    end if;
  elsif tg_op='INSERT' then new.is_approved:=true;
  end if;
  return new;
end $$;
revoke all on function public.queue_review_attachment() from public,anon,authenticated;
drop trigger if exists aa_queue_review_attachment on public.reviews;
create trigger aa_queue_review_attachment before insert or update on public.reviews for each row execute function public.queue_review_attachment();

create or replace function public.guard_review_changes()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.review_id is distinct from old.review_id or new.guest_id is distinct from old.guest_id or new.created_at is distinct from old.created_at then
    raise exception 'Feedback identity and submission time cannot be changed' using errcode='42501'; end if;
  if auth.uid() is not null and auth.uid()<>old.guest_id
    and (to_jsonb(new)-array['archived_at','archived_by','archive_reason','updated_at','is_approved']) is distinct from
      (to_jsonb(old)-array['archived_at','archived_by','archive_reason','updated_at','is_approved']) then
    raise exception 'Archiving permission does not allow changing guest review content or ratings' using errcode='42501'; end if;
  if new.is_approved is distinct from old.is_approved and not public.can_moderate_guest_reviews()
    and not (new.is_approved=false and new.image_path is not null
      and (new.image_path is distinct from old.image_path or new.title is distinct from old.title or new.review_text is distinct from old.review_text)
      and (auth.uid()=old.guest_id or auth.uid() is null)) then
    raise exception 'Only an administrator can approve review attachments' using errcode='42501'; end if;
  if new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by
    or new.archive_reason is distinct from old.archive_reason then
    if not public.can_archive_feedback() then raise exception 'Feedback archive permission required' using errcode='42501'; end if;
    if (new.archived_at is null)=(old.archived_at is null) and (new.archived_at is distinct from old.archived_at
      or new.archived_by is distinct from old.archived_by or new.archive_reason is distinct from old.archive_reason) then
      raise exception 'Use an archive or restore action to change feedback status' using errcode='40001'; end if;
    if new.archived_at is distinct from old.archived_at then
      if length(btrim(coalesce(new.archive_reason,'')))<3 or length(new.archive_reason)>500 then
        raise exception 'Enter a reason between 3 and 500 characters' using errcode='22023'; end if;
      new.archived_at:=case when new.archived_at is null then null else clock_timestamp() end;
      new.archived_by:=case when new.archived_at is null then null else auth.uid() end;
      insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
        values(auth.uid(),auth.uid(),case when new.archived_at is null then 'Restored guest feedback' else 'Archived guest feedback' end,'review',new.review_id,
          jsonb_build_object('reason',new.archive_reason,'before_archived_at',old.archived_at,'archived_at',new.archived_at,'rating',old.overall_rating));
    end if;
  end if;
  new.updated_at:=clock_timestamp();return new;
end $$;

create or replace function public.moderate_guest_review(p_review uuid,p_approve boolean,p_reason text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reviews%rowtype;
begin
  if not public.can_moderate_guest_reviews() then raise exception 'Administrator review moderation access required' using errcode='42501'; end if;
  if p_approve is null or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then
    raise exception 'Enter a reason between 3 and 500 characters' using errcode='22023'; end if;
  select * into r from public.reviews where review_id=p_review for update;
  if not found then raise exception 'Review not found' using errcode='P0002'; end if;
  if r.archived_at is not null or r.is_approved or r.updated_at is distinct from p_expected_updated_at then
    raise exception 'This review changed. Refresh before making a decision' using errcode='40001'; end if;
  update public.reviews set is_approved=p_approve,
    archived_at=case when p_approve then null else clock_timestamp() end,
    archive_reason=case when p_approve then null else btrim(p_reason) end
    where review_id=p_review;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
    values(auth.uid(),auth.uid(),case when p_approve then 'Approved guest review attachment' else 'Rejected guest review attachment' end,
      'review',p_review,jsonb_build_object('reason',btrim(p_reason),'approved',p_approve,'image_path',r.image_path));
  return jsonb_build_object('review_id',p_review,'is_approved',p_approve);
end $$;
revoke all on function public.moderate_guest_review(uuid,boolean,text,timestamptz) from public,anon;
grant execute on function public.moderate_guest_review(uuid,boolean,text,timestamptz) to authenticated;
-- INSERT ... RETURNING must be able to return the owner's pending review.
-- This does not expose unapproved feedback to any other guest or the public.
drop policy if exists "Guests read their active feedback" on public.reviews;
create policy "Guests read their active feedback" on public.reviews for select to authenticated
using(guest_id=auth.uid() and archived_at is null);
notify pgrst,'reload schema';
commit;
