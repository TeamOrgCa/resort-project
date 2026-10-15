import { NextResponse } from "next/server";
import { loginAccess, loginError, recordAttempt } from "@/lib/server/login-access";
import { DEACTIVATED_GUEST_MESSAGE } from "@/lib/auth/guest-access";

export async function POST(request: Request) {
  try {
    const access = await loginAccess("guest", await request.json());
    if (access.response) return access.response;
    const { admin, supabase, user, authSessionId, email, deviceId, finish } = access;
    if (!authSessionId) return finish(loginError("Unable to verify the login session.", 401));

    const { data: guest, error } = await admin.from("guests").select("id, is_active").eq("id", user.id).maybeSingle();
    if (error || !guest) {
      await recordAttempt(admin, email, deviceId, "guest", "denied", user.id);
      await supabase.auth.signOut({ scope: "local" });
      return finish(loginError("Guest account is unavailable.", 403));
    }

    if (!guest.is_active) {
      await recordAttempt(admin, email, deviceId, "guest", "denied", user.id);
      await supabase.auth.signOut({ scope: "local" });
      return finish(NextResponse.json({ success: false, code: "ACCOUNT_DEACTIVATED", message: DEACTIVATED_GUEST_MESSAGE }, { status: 403 }));
    }

    if (authSessionId) {
      const { data: activated, error: updateError } = await admin.from("guests")
        .update({ active_session_id: authSessionId }).eq("id", user.id).eq("is_active", true).select("id").maybeSingle();
      if (updateError) throw updateError;
      if (!activated) {
        await recordAttempt(admin, email, deviceId, "guest", "denied", user.id);
        await supabase.auth.signOut({ scope: "local" });
        return finish(NextResponse.json({ success: false, code: "ACCOUNT_DEACTIVATED", message: DEACTIVATED_GUEST_MESSAGE }, { status: 403 }));
      }
    }
    const { error: revokeError } = await supabase.auth.signOut({ scope: "others" });
    if (revokeError) throw revokeError;

    await recordAttempt(admin, email, deviceId, "guest", "success", user.id);
    return finish(NextResponse.json({ success: true, message: "Signed in." }));
  } catch {
    return loginError("Unable to process login request.", 500);
  }
}
