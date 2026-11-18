import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DEVICE_COOKIE, isDeviceId, loginError } from "@/lib/server/login-access";
import { completeStaffLogin } from "@/lib/server/staff-login";
import { getAuthSessionId } from "@/lib/auth/auth-session";
import { EMAIL_INPUT_ERROR, isValidLoginEmail } from "@/lib/validation/email";
import { STAFF_OTP_COOKIE, staffOtpCookieOptions, validateStaffOtpChallenge } from "@/lib/server/email-auth";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: unknown; token?: unknown };
    if (!isValidLoginEmail(body.email)) return loginError(EMAIL_INPUT_ERROR, 400);
    const email = body.email.toLowerCase();
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!email || !token || !/^\d{6,8}$/.test(token)) {
      return loginError("Enter the verification code from your email.", 400);
    }

    if (!email.endsWith("@gmail.com")) return loginError("OTP is only required for Gmail staff accounts.", 400);
    const cookieStore = await cookies();
    if (!validateStaffOtpChallenge(cookieStore.get(STAFF_OTP_COOKIE)?.value, email)) {
      const response = loginError("This verification code has expired. Sign in again to request a new code. Codes are valid for 5 minutes.", 401);
      response.cookies.set(STAFF_OTP_COOKIE, "", { ...staffOtpCookieOptions, maxAge: 0 });
      return response;
    }
    const supabase = await createClient();

    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (error || !data.user) return loginError("The verification code is invalid or expired.", 401);
    const authSessionId = getAuthSessionId(data.session?.access_token);
    if (!authSessionId) return loginError("Unable to verify the login session.", 401);

    const admin = createAdminClient();
    const existingDevice = cookieStore.get(DEVICE_COOKIE)?.value;
    const deviceId = isDeviceId(existingDevice) ? existingDevice : crypto.randomUUID();
    const finish = (response: NextResponse) => {
      if (deviceId !== existingDevice) response.cookies.set(DEVICE_COOKIE, deviceId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
      return response;
    };

    const response = await completeStaffLogin({ admin, supabase, user: data.user, authSessionId, email, deviceId, finish });
    response.cookies.set(STAFF_OTP_COOKIE, "", { ...staffOtpCookieOptions, maxAge: 0 });
    return response;
  } catch {
    return loginError("Unable to verify the login code.", 500);
  }
}
