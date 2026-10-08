import { NextResponse } from "next/server";
import { loginAccess, loginError, recordAttempt } from "@/lib/server/login-access";
import { completeStaffLogin } from "@/lib/server/staff-login";

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

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    await supabase.auth.signOut({ scope: "local" });
    if (otpError) return finish(loginError("Unable to send the verification code.", 502));

    return finish(NextResponse.json({
      success: true,
      requiresOtp: true,
      message: "A verification code was sent to your staff email.",
    }));
  } catch {
    return loginError("Unable to process login request.", 500);
  }
}
