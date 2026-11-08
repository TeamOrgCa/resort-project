-- Apply before deploying service photos in Business Catalog and booking.
-- Uses the same admin-only upload endpoint and public bucket as website images.
begin;
alter table public.services add column if not exists image_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-content', 'site-content', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
commit;
