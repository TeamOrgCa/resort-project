import type { SupabaseClient } from "@supabase/supabase-js";
import type { GuestRegistration } from "@/lib/auth/guest-registration";
import { sendGuestConfirmationEmail } from "@/lib/email";

export class GuestConfirmationError extends Error {
  constructor(message: string, public status = 502, public code?: string) { super(message); }
}

export const REGISTERED_EMAIL_MESSAGE = "This email is already registered. Please sign in or reset your password.";

const attempts = new Map<string, { count: number; expires: number }>();
export function limitConfirmationRequests(request: Request, email: string) {
  const now = Date.now();
  for (const [key, state] of attempts) if (state.expires <= now) attempts.delete(key);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  const rules = [{ key: `email:${email}`, maximum: 1, duration: 60000 }, { key: `ip:${ip}`, maximum: 10, duration: 600000 }];
  if (rules.some(({ key, maximum }) => (attempts.get(key)?.count ?? 0) >= maximum)) throw new GuestConfirmationError("Please wait before requesting another confirmation email.", 429);
  for (const { key, duration } of rules) {
    const state = attempts.get(key);
    attempts.set(key, { count: (state?.count ?? 0) + 1, expires: state?.expires ?? now + duration });
  }
}

export function guestConfirmationUrl(request: Request, tokenHash: string) {
  // A configured public origin prevents internal proxy hosts in production mail.
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", "email");
  return url.toString();
}

export async function assertGuestSignupEnabled() {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY! }, cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new GuestConfirmationError("Unable to check registration availability. Please try again.", 503);
  const settings = await response.json();
  if (settings.disable_signup || !settings.external?.email) throw new GuestConfirmationError("Guest registration is currently unavailable.", 503);
  if (settings.mailer_autoconfirm !== false) throw new GuestConfirmationError("Guest email confirmation is unavailable. Please contact the resort.", 503);
}

export async function sendGuestConfirmation(admin: SupabaseClient, request: Request, email: string): Promise<boolean | null> {
  const { data: profile, error } = await admin.from("guests").select("id, first_name").eq("email", email).maybeSingle();
  if (error) throw new GuestConfirmationError("Unable to check your account. Please try again.");
  if (!profile) return null;
  const [{ data: { user }, error: userError }, { data: staff, error: staffError }] = await Promise.all([
    admin.auth.admin.getUserById(profile.id), admin.from("staff_users").select("id").eq("id", profile.id).maybeSingle(),
  ]);
  if (userError || staffError) throw new GuestConfirmationError("Unable to check your account. Please try again.");
  if (!user || staff || user.email_confirmed_at || user.email?.toLowerCase() !== email) return null;
  if (user.confirmation_sent_at && Date.now() - new Date(user.confirmation_sent_at).getTime() < 60000) throw new GuestConfirmationError("Please wait before requesting another confirmation email.", 429);

  // Empty password prevents creation of an unknown account. For an existing
  // unconfirmed user, signup link generation preserves their password/metadata.
  const { data, error: linkError } = await admin.auth.admin.generateLink({ type: "signup", email, password: "" });
  // The account may have been confirmed after the check above.
  if (linkError && ["email_exists", "user_already_exists"].includes(linkError.code ?? "")) return null;
  if (linkError || !data.properties?.hashed_token || data.user?.id !== profile.id || data.properties.verification_type !== "signup") throw new GuestConfirmationError("Unable to prepare your confirmation email. Please try again.");
  return sendGuestConfirmationEmail({ email, guestName: profile.first_name, confirmationUrl: guestConfirmationUrl(request, data.properties.hashed_token) });
}

export async function registerGuestWithSmtp(admin: SupabaseClient, request: Request, guest: GuestRegistration) {
  await assertGuestSignupEnabled();
  const { data, error } = await admin.auth.admin.createUser({
    email: guest.email, password: guest.password, email_confirm: false,
    user_metadata: { first_name: guest.firstName, last_name: guest.lastName, middle_name: guest.middleName, phone_number: guest.phoneNumber, address: guest.address },
  });
  if (error && !["email_exists", "user_already_exists"].includes(error.code ?? "")) throw new GuestConfirmationError(error.status && error.status < 500 ? error.message : "Unable to create your account. Please try again.", error.status && error.status < 500 ? 400 : 502);
  if (!error) {
    if (!data.user || data.user.email_confirmed_at) throw new GuestConfirmationError("Guest email confirmation is unavailable. Please contact the resort.", 503);
    const { data: profile, error: profileError } = await admin.from("guests").select("id").eq("id", data.user.id).maybeSingle();
    if (profileError || !profile) throw new GuestConfirmationError("Your account needs assistance. Please contact support.", 500);
  }
  const delivered = await sendGuestConfirmation(admin, request, guest.email);
  if (delivered === null) throw new GuestConfirmationError(REGISTERED_EMAIL_MESSAGE, 409, "EMAIL_ALREADY_REGISTERED");
  return { success: true, needsEmailConfirmation: true, confirmationEmailSent: delivered !== false,
    ...(delivered === false ? { message: "Your account was created, but the confirmation email could not be sent. Please use Resend confirmation email to try again." } : {}) };
}
