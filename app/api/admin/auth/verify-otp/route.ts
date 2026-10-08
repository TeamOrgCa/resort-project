import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DEVICE_COOKIE, isDeviceId, loginError } from "@/lib/server/login-access";
import { completeStaffLogin } from "@/lib/server/staff-login";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: unknown; token?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!email || !token || !/^\d{6,8}$/.test(token)) {
      return loginError("Enter the verification code from your email.", 400);
    }

    const supabase = await createClient();
    if (!email.endsWith("@gmail.com")) return loginError("OTP is only required for Gmail staff accounts.", 400);

    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (error || !data.user) return loginError("The verification code is invalid or expired.", 401);

    const admin = createAdminClient();
    const cookieStore = await cookies();
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

    return completeStaffLogin({ admin, supabase, user: data.user, email, deviceId, finish });
  } catch {
    return loginError("Unable to verify the login code.", 500);
  }
}