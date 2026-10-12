# Guest registration confirmation email

When `EMAIL_USER` and `EMAIL_PASS` are configured, registration and resend use the
same Nodemailer SMTP sender as reservation mail. Supabase creates an unconfirmed
guest and issues a one-use signup token; the app sends that token in an
`/auth/confirm?token_hash=...&type=email` link. The callback confirms the email
without persisting a session, then redirects to login. Guests still need to sign
in normally. Tokens and passwords are never returned in registration responses.

Guest login returns `403` with `EMAIL_NOT_CONFIRMED` and a "Please confirm your
email first" message when Supabase validates the password but reports that email
confirmation is missing. The login screen shows that prompt. These attempts are
audited as denied rather than counted as incorrect-password failures. Incorrect
credentials still return the generic error, and an existing lockout still applies.

SMTP settings: `EMAIL_HOST` (defaults to `smtp.gmail.com`), `EMAIL_PORT` (587),
`EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASS`, optional `EMAIL_FROM` and
`EMAIL_FROM_NAME`. For Gmail use an app password. `NEXT_PUBLIC_SITE_URL` should
be the public site origin in production; localhost falls back to the request
origin. Keep all SMTP secrets and `SUPABASE_SERVICE_ROLE_KEY` on the server.

Keep Supabase email signup and **Confirm email** enabled. The app checks these
settings before creating a guest. The auth-user trigger must create the guest
profile. Existing passwords and profiles are retained on repeated registration.
Resend ignores unknown, confirmed, and staff addresses. Link generation supplies
an empty password so it cannot create an unknown account during resend.

Delivery errors keep the account unconfirmed and display a resend option. SMTP
success means the mail server accepted the recipient; inbox placement still
depends on the recipient's provider. Wait one minute between confirmation
requests. There is also a process-local limit of 10 requests per IP per 10
minutes; deployments with multiple instances should enforce this limit at the
shared ingress too. Auth's last confirmation timestamp also enforces a minute
between issued tokens. Without app SMTP, the existing Supabase mail path remains.

Supabase's built-in SMTP sender is restricted to project team addresses and has
low sending limits. Configuring `EMAIL_*` in Next.js does not configure Supabase's
SMTP sender. See [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
and [custom email links](https://supabase.com/docs/reference/javascript/auth-admin-generatelink).

Tests: `node --experimental-strip-types --test tests/guest-confirmation.test.mjs`.
The optional `guest-confirmation.integration.test.mjs` runs only with
`RUN_GUEST_CONFIRMATION_INTEGRATION=1`. It creates a unique temporary guest, checks
that login is blocked before confirmation, verifies the real one-use email token,
checks login afterwards, and deletes only that test guest. It never sends email.
