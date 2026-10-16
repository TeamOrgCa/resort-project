# Guest feedback and repeat reviews

Run [review-feedback-management-migration.sql](review-feedback-management-migration.sql) in Supabase after the migrations listed at its top, before deploying. It preserves existing reviews/photos and submission timestamps and can be safely reapplied. It is also included at the end of `updated-schema.sql` for fresh installations.

## Analytics

Analytics > Guest feedback automatically fetches actual reviews within the selected Philippine date range. It supports live text search, active/archived/all filters, pagination, photos, refresh and archive/restore confirmation with a required reason. The list works without the AI service. Optional analysis uses at most 100 latest approved, non-archived reviews. Archiving/restoring clears the displayed summary so it must be regenerated.

Administrators can archive and restore. Other roles need both `analytics` and the new `feedback_archive` permission, granted in Users > Role Permission Matrix. No existing non-admin role receives the new write permission automatically. The API and SQL function both enforce access; SQL also checks the current staff session. Changes and their audit records commit together. This permission does not allow editing another guest's review text or rating, nor altering the archive actor without a new audited status transition.

Archived reviews are retained, excluded from public review queries, and excluded from public photo signing through storage policies. Staff can still view them. Existing signed photo links may remain usable until their expiry; archiving does not revoke a previously issued URL.

## Repeat reviews and rate limits

The one-review-per-account index and application check are removed. The existing one-review-per-linked-reservation index remains.

- Wait **10 minutes** between successful submissions.
- At most **3 reviews per rolling 24 hours**, including archived or subsequently deleted reviews.
- Repeating the same normalized review text within **24 hours** is rejected even when its title changes. Casing and whitespace differences do not evade the duplicate check.
- Invalid forms and failed inserts do not consume a successful-submission quota. Existing reviews are included when initializing the quota history.
- The quota is stored in `review_submission_log`, which guests cannot modify. Inserts lock the guest row and recheck the quota atomically; limits work across multiple application instances and concurrent requests. Guests cannot forge submission timestamps or archive metadata.
- The API prechecks the quota before photo upload, returns HTTP **429** with `Retry-After` for cooldown/daily limits, and removes only the newly uploaded photo if a concurrent insert loses the quota race. Duplicate content and an already-reviewed reservation return **409**. The client shows a popup with the retry time in Philippine time and retains the guest's draft/photo.

Tests cover the actual migration, role/session enforcement, archive rollback/auditing, public review/photo visibility, multiple reviews, concurrent submissions, quotas after deletion, API responses, upload cleanup, UI confirmations and rate-limit feedback.
