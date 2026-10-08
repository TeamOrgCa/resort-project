# One active device per account

Apply [single-session-migration.sql](single-session-migration.sql) before deploying the app. Existing guest sessions need to sign in again after deployment. Staff already have `active_session_id` in `staff_users` and need no schema change.

On a successful guest or staff login, the app records the new active session and asks Supabase Auth to revoke the other refresh tokens. Guest sessions use the Supabase `session_id` claim; staff sessions use the existing staff session cookie. Signing out uses the **local** scope, so an older device cannot sign out the newer one.

Protected pages and API requests reject a replaced session. An open tab also checks the session every 60 seconds and when focused. It signs out locally and redirects to the guest or staff login page with an explanation. A closed tab is checked when it next opens a protected page.

## Verification

1. Sign in on a laptop as a guest, then sign in to the same account on a phone. The laptop should show the session replacement message within 15 seconds or when focused; the phone stays signed in.
2. Repeat with a staff account, including a Gmail staff account that uses an email code.
3. Sign out on the old device and confirm the new device remains signed in.
4. Try a protected page or API request from the old device; it should redirect or return HTTP 401.

Supabase access tokens are valid until their configured expiry even after refresh tokens are revoked. The app checks its active session on protected routes immediately; direct calls to Supabase tables remain subject to existing RLS policies. Supabase's optional single-session Auth setting can add enforcement at token refresh time on eligible plans.
