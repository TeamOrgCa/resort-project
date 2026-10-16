-- Apply after review-images, role-permissions and guest-account-status migrations.
begin;
alter table public.audit_logs add column if not exists details jsonb;
alter table public.reviews add column if not exists archived_at timestamptz;
alter table public.reviews add column if not exists archived_by uuid references public.staff_users(id);
alter table public.reviews add column if not exists archive_reason text;
drop index if exists public.one_review_per_guest;
-- Keep one review per linked reservation. Unlinked reviews may be repeated within the limits below.
create index if not exists reviews_guest_created on public.reviews(guest_id,created_at desc);
create index if not exists reviews_feedback_created on public.reviews(created_at desc,review_id);

-- This history survives deleting or archiving a review, so neither can reset the quota.
create table if not exists public.review_submission_log(
  review_id uuid primary key,guest_id uuid not null references public.guests(id) on delete cascade,
  fingerprint text not null,created_at timestamptz not null default clock_timestamp()
);
create index if not exists review_submission_guest_time on public.review_submission_log(guest_id,created_at desc);
alter table public.review_submission_log enable row level security;
revoke all on public.review_submission_log from anon,authenticated;
grant all on public.review_submission_log to service_role;
insert into public.review_submission_log(review_id,guest_id,fingerprint,created_at)
 select review_id,guest_id,md5(lower(regexp_replace(btrim(review_text),'\s+',' ','g'))),created_at
 from public.reviews on conflict(review_id) do nothing;

create or replace function public.review_submission_policy(p_guest uuid,p_title text,p_text text,p_now timestamptz default clock_timestamp())
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_latest timestamptz;v_oldest timestamptz;v_count integer;v_retry integer;
begin
  if exists(select 1 from public.review_submission_log where guest_id=p_guest and created_at>p_now-interval '24 hours'
    and fingerprint=md5(lower(regexp_replace(btrim(p_text),'\s+',' ','g')))) then
    return jsonb_build_object('allowed',false,'code','DUPLICATE_REVIEW','message','You already submitted this review within the last 24 hours. Please share a different experience.'); end if;
  select max(created_at),min(created_at),count(*) into v_latest,v_oldest,v_count from public.review_submission_log
    where guest_id=p_guest and created_at>p_now-interval '24 hours';
  v_retry:=greatest(0,coalesce(ceil(extract(epoch from v_latest+interval '10 minutes'-p_now))::integer,0),
    case when v_count>=3 then ceil(extract(epoch from v_oldest+interval '24 hours'-p_now))::integer else 0 end);
  if v_retry>0 then return jsonb_build_object('allowed',false,'code','REVIEW_RATE_LIMITED','retryAfter',v_retry,
    'message','Please wait before submitting another review. Allow 10 minutes between reviews, with a maximum of 3 in 24 hours.'); end if;
  return jsonb_build_object('allowed',true);
end $$;
revoke all on function public.review_submission_policy(uuid,text,text,timestamptz) from public,anon,authenticated;

create or replace function public.review_submission_status(p_title text,p_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.guests where id=auth.uid() and is_active) then
    raise exception 'An active guest account is required' using errcode='42501'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 or p_text is null or length(btrim(p_text)) not between 50 and 5000 then
    raise exception 'Enter a title of 1-200 characters and review text of 50-5000 characters' using errcode='22023'; end if;
  return public.review_submission_policy(auth.uid(),p_title,p_text);
end $$;
revoke all on function public.review_submission_status(text,text) from public,anon;
grant execute on function public.review_submission_status(text,text) to authenticated;

create or replace function public.guard_review_submission()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_policy jsonb;
begin
  if new.title is null or length(btrim(new.title)) not between 1 and 200 or new.review_text is null or length(btrim(new.review_text)) not between 50 and 5000 then
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
drop trigger if exists guard_review_submission on public.reviews;
create trigger guard_review_submission before insert on public.reviews for each row execute function public.guard_review_submission();

create or replace function public.can_archive_feedback()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_users s where s.id=auth.uid() and s.is_active
    and s.active_session_id is not null and s.active_session_id::text=auth.jwt()->>'session_id'
    and (s.role='admin' or exists(select 1 from public.role_permissions rp where rp.role=s.role
      and 'analytics'=any(rp.permissions) and 'feedback_archive'=any(rp.permissions))));
$$;
revoke all on function public.can_archive_feedback() from public,anon;
grant execute on function public.can_archive_feedback() to authenticated;

create or replace function public.guard_review_changes()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.review_id is distinct from old.review_id or new.guest_id is distinct from old.guest_id or new.created_at is distinct from old.created_at then
    raise exception 'Feedback identity and submission time cannot be changed' using errcode='42501'; end if;
  if auth.uid() is not null and auth.uid()<>old.guest_id
    and (to_jsonb(new)-array['archived_at','archived_by','archive_reason','updated_at']) is distinct from
      (to_jsonb(old)-array['archived_at','archived_by','archive_reason','updated_at']) then
    raise exception 'Archiving permission does not allow changing guest review content or ratings' using errcode='42501'; end if;
  if new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by
    or new.archive_reason is distinct from old.archive_reason or new.is_approved is distinct from old.is_approved then
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
drop trigger if exists guard_review_changes on public.reviews;
create trigger guard_review_changes before update on public.reviews for each row execute function public.guard_review_changes();

drop policy if exists "Public read approved reviews" on public.reviews;
create policy "Public read approved reviews" on public.reviews for select using(is_approved and archived_at is null);
drop policy if exists "Staff manage reviews" on public.reviews;
drop policy if exists "Staff read feedback" on public.reviews;
create policy "Staff read feedback" on public.reviews for select to authenticated using(exists(select 1 from public.staff_users s
  where s.id=auth.uid() and s.is_active and (s.role='admin' or exists(select 1 from public.role_permissions rp where rp.role=s.role and 'analytics'=any(rp.permissions)))));
drop policy if exists "Staff archive feedback" on public.reviews;
create policy "Staff archive feedback" on public.reviews for update to authenticated using(public.can_archive_feedback()) with check(public.can_archive_feedback());
drop policy if exists "Users manage own reviews" on public.reviews;
create policy "Users manage own reviews" on public.reviews for update to authenticated using(auth.uid()=guest_id and archived_at is null)
  with check(auth.uid()=guest_id and archived_at is null);

create or replace function public.set_feedback_archived(p_review uuid,p_archive boolean,p_reason text,p_expected_archived_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_review public.reviews%rowtype;
begin
  if not public.can_archive_feedback() then raise exception 'Feedback archive permission required' using errcode='42501'; end if;
  select * into v_review from public.reviews where review_id=p_review for update;
  if not found then raise exception 'Feedback not found' using errcode='P0002'; end if;
  if p_archive is null or v_review.archived_at is distinct from p_expected_archived_at
    or (v_review.archived_at is not null)=p_archive then
    raise exception 'Feedback status changed. Refresh before trying again' using errcode='40001'; end if;
  update public.reviews set archived_at=case when p_archive then clock_timestamp() else null end,archive_reason=btrim(p_reason)
    where review_id=p_review returning * into v_review;
  return jsonb_build_object('review_id',v_review.review_id,'archived_at',v_review.archived_at);
end $$;
revoke all on function public.set_feedback_archived(uuid,boolean,text,timestamptz) from public,anon;
grant execute on function public.set_feedback_archived(uuid,boolean,text,timestamptz) to authenticated;

drop policy if exists "Read visible review photos" on storage.objects;
create policy "Read visible review photos" on storage.objects for select to anon,authenticated using(bucket_id='review-images'
  and exists(select 1 from public.reviews r where r.image_path=storage.objects.name and r.is_approved and r.archived_at is null));
notify pgrst,'reload schema';
commit;
