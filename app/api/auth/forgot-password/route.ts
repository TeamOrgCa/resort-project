import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmailConfigured, sendPasswordResetEmail } from "@/lib/email";
import { GuestConfirmationError, limitConfirmationRequests } from "@/lib/server/guest-confirmation";
import { passwordResetUrl } from "@/lib/server/email-auth";
import { isValidLoginEmail } from "@/lib/validation/email";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { email?: unknown; staff?: unknown } | null;
  if (!isValidLoginEmail(body?.email)) return NextResponse.json({ message: "Enter a valid email address without spaces." }, { status: 400 });
  const email = body.email.toLowerCase(), staff = body.staff === true;
  try {
    limitConfirmationRequests(request, `recovery:${email}`);
    if (isEmailConfigured()) {
      const admin = createAdminClient();
      // Only issue links for existing accounts in the selected portal. Never
      // reveal whether the address is registered or create a recovery account.
      const { data: profile, error } = await admin.from(staff ? "staff_users" : "guests").select("id").eq("email", email).maybeSingle();
      if (error) throw error;
      if (profile) {
        const { data, error: linkError } = await admin.auth.admin.generateLink({ type: "recovery", email });
        if (linkError || data.user?.id !== profile.id || !data.properties?.hashed_token || data.properties.verification_type !== "recovery") throw new Error("Unable to prepare password reset.");
        if (!await sendPasswordResetEmail({ email, resetUrl: passwordResetUrl(request, data.properties.hashed_token, staff) })) throw new Error("Unable to send password reset.");
      }
    } else {
      const supabase = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
      const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: new URL(staff ? "/auth/confirm/staff" : "/auth/confirm", origin).toString() });
      if (error) throw error;
    }
    return NextResponse.json({ success: true, message: "If this address has an account, a password reset email is on its way. The link expires in 5 minutes and can only be used once." });
  } catch (error) {
    return NextResponse.json({ message: error instanceof GuestConfirmationError ? error.message : "Unable to send a reset email. Please try again later." }, { status: error instanceof GuestConfirmationError ? error.status : 502 });
  }
}
