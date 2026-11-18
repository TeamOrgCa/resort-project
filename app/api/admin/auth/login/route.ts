import { NextResponse } from "next/server";
import { loginAccess, loginError, recordAttempt } from "@/lib/server/login-access";
import { completeStaffLogin } from "@/lib/server/staff-login";
import { isEmailConfigured, sendStaffOtpEmail } from "@/lib/email";
import { createStaffOtpChallenge, STAFF_OTP_COOKIE, staffOtpCookieOptions } from "@/lib/server/email-auth";

export async function POST(request: Request) {
  try {
    const access = await loginAccess("staff", await request.json());
    if (access.response) return access.response;
    const { admin, supabase, user, authSessionId, email, deviceId, finish } = access;
    if (!authSessionId) return finish(loginError("Unable to verify the login session.", 401));

    const { data: staff, error } = await admin.from("staff_users")
      .select("id, full_name, email, role, is_active, active_session_id")
      .eq("id", user.id).maybeSingle();

    if (error || !staff || !staff.is_active) {
      await recordAttempt(admin, email, deviceId, "staff", "denied", user.id);
      await supabase.auth.signOut({ scope: "local" });
      return finish(loginError("Staff account is unavailable.", 403));
    }

    if (!email.endsWith("@gmail.com")) {
      return completeStaffLogin({ admin, supabase, user, authSessionId, email, deviceId, finish });
    }

    const challenge = createStaffOtpChallenge(email);
    let sent = false;
    try {
      if (isEmailConfigured()) {
        const { data, error: otpError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
        if (!otpError && data.user?.id === user.id && data.properties?.verification_type === "magiclink" && /^\d{6,8}$/.test(data.properties.email_otp)) {
          sent = await sendStaffOtpEmail({ email, code: data.properties.email_otp });
        }
      } else {
        const { error: otpError } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
        sent = !otpError;
      }
    } finally {
      // Never leave the password session signed in if code delivery throws.
      await supabase.auth.signOut({ scope: "local" });
    }
    if (!sent) return finish(loginError("Unable to send the verification code.", 502));

    const response = finish(NextResponse.json({
      success: true,
      requiresOtp: true,
      message: "A verification code was sent to your staff email. It expires in 5 minutes and can only be used once.",
    }));
    response.cookies.set(STAFF_OTP_COOKIE, challenge, staffOtpCookieOptions);
    return response;
  } catch {
    return loginError("Unable to process login request.", 500);
  }
}
