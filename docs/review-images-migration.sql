-- Run after the reviews and staff_users tables exist.
begin;
alter table public.reviews add column if not exists image_path text;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.reviews'::regclass and conname = 'reviews_owned_image_path') then
    alter table public.reviews add constraint reviews_owned_image_path check (
      image_path is null or image_path ~ ('^' || guest_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')
    );
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-images', 'review-images', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Uploads/deletes go through the authenticated guest API, using the server-only
-- service role after validating the guest, file signature and review details.
-- Public reads are allowed only for photos linked to an approved review.
drop policy if exists "Read visible review photos" on storage.objects;
create policy "Read visible review photos" on storage.objects for select to anon, authenticated using (
  bucket_id = 'review-images'
  and exists (select 1 from public.reviews r where r.image_path = storage.objects.name and r.is_approved = true)
);
drop policy if exists "Guests and staff read review photos" on storage.objects;
create policy "Guests and staff read review photos" on storage.objects for select to authenticated using (
  bucket_id = 'review-images' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.staff_users s where s.id = auth.uid() and s.is_active = true)
  )
);
notify pgrst, 'reload schema';
commit;
