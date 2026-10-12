-- Required for deployments that predate payment QR storage.
-- Keep QR storage private; /api/catalog signs guest image URLs on the server.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-qr-codes', 'payment-qr-codes', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Existing accounts without QR images must be edited to attach one.
-- The admin API enforces QR upload on account creation, editing, and restore.
