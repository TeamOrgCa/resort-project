-- Run once in the Supabase SQL editor to enable Configuration > Website content uploads.
-- Public images are uploaded exclusively through the authenticated admin endpoint
-- using the service role. No anonymous or authenticated write policy is added.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-content', 'site-content', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Text and image URLs use the existing business_settings table. Missing content
-- keys use application defaults, so no seed or alteration of that table is needed.
