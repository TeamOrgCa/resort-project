# Guest review photos

Apply [review-images-migration.sql](review-images-migration.sql) in Supabase before using photo attachments. It adds an optional image path to reviews and a private `review-images` bucket. The same SQL is appended to `updated-schema.sql` for new installations. Keep `SUPABASE_SERVICE_ROLE_KEY` configured on the server, as used by existing server features.

On **Reviews → Write a Review**, guests can attach one optional JPEG, PNG or WebP photo up to 3 MB. The form previews the photo and lets them replace or remove it before submission. Reviews without a photo are still supported, including existing JSON API clients. The existing registered-guest requirement, one-review-per-guest rule and automatic publication behavior remain in place.

The server validates file size, MIME type and file signature before uploading to a generated guest-owned path. It stores the path with the review and removes the newly uploaded object if review creation fails. Clients cannot supply arbitrary image paths or URLs. The database also checks that an attached path belongs to the review's guest.

The public feed returns photo URLs only for approved reviews. Storage access follows review approval, guest ownership and active staff access. Public photo URLs expire after one hour; an already-issued URL remains valid until its expiry even if staff subsequently hides the review. Reloading the reviews page obtains fresh URLs. Clicking a review photo opens its full-size image.

After migration, verify a review with a photo, a review without one, removal/replacement before submit, an oversized or invalid attachment, duplicate review rejection, and a hidden review's absence from the public feed. Use separate test guest accounts because the existing system permits one review per guest.
