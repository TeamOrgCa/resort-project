-- Apply after review-feedback-management, review-completed-stay-required and
-- review-attachment-moderation migrations. Existing reviews remain unchanged.
-- Updates only submission validation; completed stays, quotas and photo approval remain required.
begin;

create or replace function public.review_submission_status(p_title text,p_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.guests where id=auth.uid() and is_active) then
    raise exception 'An active guest account is required' using errcode='42501'; end if;
  if not exists(select 1 from public.reservations where guest_id=auth.uid() and status='completed') then
    raise exception 'Complete a resort stay before submitting a review' using errcode='42501'; end if;
  if p_title is null or length(btrim(p_title)) not between 5 and 100 or p_text is null or length(btrim(p_text)) not between 20 and 1000 then
    raise exception 'Enter a title of 5-100 characters and review description of 20-1000 characters' using errcode='22023'; end if;
  return public.review_submission_policy(auth.uid(),p_title,p_text);
end $$;
revoke all on function public.review_submission_status(text,text) from public,anon;
grant execute on function public.review_submission_status(text,text) to authenticated;

create or replace function public.guard_review_submission()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_policy jsonb;
begin
  if new.title is null or length(btrim(new.title)) not between 5 and 100 or new.review_text is null or length(btrim(new.review_text)) not between 20 and 1000 then
    raise exception 'Enter valid review content' using errcode='22023'; end if;
  -- Serialize concurrent submissions for the same account, across server instances.
  perform 1 from public.guests where id=new.guest_id and is_active for update;
  if not found or (auth.uid() is not null and auth.uid()<>new.guest_id) then
    raise exception 'An active guest account is required' using errcode='42501'; end if;
  if new.archived_at is not null or new.archived_by is not null or new.archive_reason is not null then
    raise exception 'New feedback cannot include archive metadata' using errcode='42501'; end if;
  if new.reservation_id is not null and not exists(select 1 from public.reservations where reservation_id=new.reservation_id and guest_id=new.guest_id) then
    raise exception 'The reservation must belong to this guest' using errcode='22023'; end if;
  v_policy:=public.review_submission_policy(new.guest_id,new.title,new.review_text);
  if not (v_policy->>'allowed')::boolean then
    if v_policy->>'code'='DUPLICATE_REVIEW' then raise exception '%',v_policy->>'message' using errcode='P0409'; end if;
    raise exception '%',v_policy->>'message' using errcode='P0429',detail=v_policy->>'retryAfter'; end if;
  new.created_at:=clock_timestamp();new.updated_at:=new.created_at;
  insert into public.review_submission_log(review_id,guest_id,fingerprint,created_at)
    values(new.review_id,new.guest_id,md5(lower(regexp_replace(btrim(new.review_text),'\s+',' ','g'))),new.created_at);
  return new;
end $$;
revoke all on function public.guard_review_submission() from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
