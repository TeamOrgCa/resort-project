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
profile. Registration rejects already-verified email addresses with HTTP `409`,
`EMAIL_ALREADY_REGISTERED`, and a centered popup with sign-in, password-reset and
use-another-email actions. Registration failures appear immediately without scrolling;
the form retains its values and a reminder beside the submit button. It sends no new
confirmation email and leaves the existing account untouched. Repeating registration
for an unconfirmed guest can resend confirmation without changing its password or profile.
Resend ignores unknown, confirmed, and staff addresses. Link generation supplies
an empty password so it cannot create an unknown account during resend.

Delivery errors keep the account unconfirmed and display a resend option. SMTP
success means the mail server accepted the recipient; inbox placement still
depends on the recipient's provider. Wait one minute between confirmation
requests. There is also a process-local limit of 10 requests per IP per 10
minutes; deployments with multiple instances should enforce this limit at the
shared ingress too. Auth's last confirmation timestamp also enforces a minute
between issued tokens. Without app SMTP, the existing Supabase mail path remains.

## Vercel production configuration

Set these variables in the Vercel project's **Settings → Environment Variables**
for **Production**, then redeploy. A local `.env` change does not update the
deployed environment. When changing or revoking a Gmail app password, also update
`EMAIL_PASS` in Vercel before redeploying.

```dotenv
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-sender@gmail.com
EMAIL_PASS=your-current-gmail-app-password
NEXT_PUBLIC_SITE_URL=https://your-production-domain
```

Also configure the existing Supabase URL, publishable key and server-only
`SUPABASE_SERVICE_ROLE_KEY` for the same project. Supabase **Confirm email** must
remain enabled. Use the current Gmail app password rather than your normal
Google account password.
Port 465 requires `EMAIL_SECURE=true`; port 587 uses STARTTLS and requires
`EMAIL_SECURE=false`. Registration and resend await the SMTP result before responding.

For SMTP failures, look for `Failed to send email` in the Vercel function logs:

| Log | Check |
| --- | --- |
| `Email address not authorized` in the registration response | App SMTP variables may be missing, causing registration to use Supabase's default sender |
| `EAUTH`, SMTP 534 or 535 | Current Gmail app password, sender account and Google security activity |
| `ETIMEDOUT`, `ECONNECTION`, `ESOCKET` | SMTP host/port, TLS and connectivity from the production server |
| SMTP 421 or 454 | Temporary server refusal or sending limits |

SMTP failure logs include error codes and response codes, without passwords,
recipient addresses, message bodies or confirmation tokens. Successful SMTP
acceptance does not guarantee inbox placement; check the guest's spam folder.

References: [Vercel environment variables](https://vercel.com/docs/environment-variables),
[Nodemailer Gmail guide](https://nodemailer.com/guides/using-gmail),
[SMTP port and TLS settings](https://nodemailer.com/smtp).

Supabase's built-in SMTP sender is restricted to project team addresses and has
low sending limits. Configuring `EMAIL_*` in Next.js does not configure Supabase's
SMTP sender. See [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
and [custom email links](https://supabase.com/docs/reference/javascript/auth-admin-generatelink).

Tests: `node --experimental-strip-types --test tests/guest-confirmation.test.mjs`.
The optional `guest-confirmation.integration.test.mjs` runs only with
`RUN_GUEST_CONFIRMATION_INTEGRATION=1`. It creates a unique temporary guest, checks
that login is blocked before confirmation, verifies the real one-use email token,
checks login afterwards, and deletes only that test guest. It never sends email.
