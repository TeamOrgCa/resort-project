import { NextResponse } from "next/server";
import { loginAccess, loginError, recordAttempt } from "@/lib/server/login-access";

export async function POST(request: Request) {
  try {
    const access = await loginAccess("guest", await request.json());
    if (access.response) return access.response;
    const { admin, supabase, user, authSessionId, email, deviceId, finish } = access;

    const { data: guest, error } = await admin.from("guests").select("id").eq("id", user.id).maybeSingle();
    if (error || !guest) {
      await recordAttempt(admin, email, deviceId, "guest", "denied", user.id);
      await supabase.auth.signOut({ scope: "local" });
      return finish(loginError("Guest account is unavailable.", 403));
    }

    if (authSessionId) {
      const { error: updateError } = await admin.from("guests")
        .update({ active_session_id: authSessionId }).eq("id", user.id);
      if (updateError) throw updateError;
    }
    const { error: revokeError } = await supabase.auth.signOut({ scope: "others" });
    if (revokeError) throw revokeError;

    await recordAttempt(admin, email, deviceId, "guest", "success", user.id);
    return finish(NextResponse.json({ success: true, message: "Signed in." }));
  } catch {
    return loginError("Unable to process login request.", 500);
  }
}
