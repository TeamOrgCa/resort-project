-- HISTORICAL: superseded by review-completed-stay-required-migration.sql.
-- Do not reapply this file alone to a current deployment.
-- Apply after review-feedback-management and stay-completion migrations.
-- Active guests can review without a completed stay or any reservation.
-- Preserve ownership checks, cooldowns, quotas and duplicate-review rules.
begin;

drop trigger if exists guard_review_completed_stay on public.reviews;

create or replace function public.guard_review_reservation_owner()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.reservation_id is not null and not exists(select 1 from public.reservations r
    where r.reservation_id=new.reservation_id and r.guest_id=new.guest_id) then
    raise exception 'Linked reservations must belong to this guest' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_review_reservation_owner() from public,anon,authenticated;
drop trigger if exists guard_review_reservation_owner on public.reviews;
create trigger guard_review_reservation_owner before insert or update of reservation_id,guest_id on public.reviews
for each row execute function public.guard_review_reservation_owner();

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

notify pgrst,'reload schema';
commit;
