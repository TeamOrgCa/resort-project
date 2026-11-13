-- Apply after stay-completion, review-feedback-management and (if installed)
-- review-without-completed-stay migrations. This restores completed-stay eligibility.
-- Existing feedback, photos, quotas, moderation and audit history are preserved.
begin;

create or replace function public.guard_review_completed_stay()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Historical feedback remains editable under its existing moderation rules.
  if tg_op='UPDATE' then
    if new.guest_id is not distinct from old.guest_id and new.reservation_id is not distinct from old.reservation_id then
      return new;
    end if;
  end if;
  if not exists(select 1 from public.reservations r where r.guest_id=new.guest_id and r.status='completed'
    and (new.reservation_id is null or r.reservation_id=new.reservation_id)) then
    raise exception 'Complete a resort stay before submitting a review. Linked reservations must be your own completed stays' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_review_completed_stay() from public,anon,authenticated;
drop trigger if exists guard_review_completed_stay on public.reviews;
create trigger guard_review_completed_stay before insert or update of reservation_id,guest_id on public.reviews
for each row execute function public.guard_review_completed_stay();

create or replace function public.review_submission_status(p_title text,p_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.guests where id=auth.uid() and is_active) then
    raise exception 'An active guest account is required' using errcode='42501'; end if;
  if not exists(select 1 from public.reservations where guest_id=auth.uid() and status='completed') then
    raise exception 'Complete a resort stay before submitting a review' using errcode='42501'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 or p_text is null or length(btrim(p_text)) not between 50 and 5000 then
    raise exception 'Enter a title of 1-200 characters and review text of 50-5000 characters' using errcode='22023'; end if;
  return public.review_submission_policy(auth.uid(),p_title,p_text);
end $$;
revoke all on function public.review_submission_status(text,text) from public,anon;
grant execute on function public.review_submission_status(text,text) to authenticated;

notify pgrst,'reload schema';
commit;
