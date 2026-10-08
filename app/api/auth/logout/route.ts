import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEVICE_COOKIE, isDeviceId, recordAttempt } from "@/lib/server/login-access";
import { getAuthSessionId } from "@/lib/auth/auth-session";

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const authSessionId = getAuthSessionId(session?.access_token);
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (currentUser && authSessionId) {
      const admin = createAdminClient();
      await admin.from("guests").update({ active_session_id: null })
        .eq("id", currentUser.id).eq("active_session_id", authSessionId);
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const deviceId = (await cookies()).get(DEVICE_COOKIE)?.value;
      if (user?.email && isDeviceId(deviceId)) {
        await recordAttempt(createAdminClient(), user.email.toLowerCase(), deviceId, "guest", "logout", user.id);
      }
    } catch (auditError) {
      console.warn("[guest logout] Could not record logout audit event", auditError);
    }

    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      console.error("[guest logout] Supabase sign-out failed", error);
      return NextResponse.json({ success: false, message: "Unable to sign out." }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[guest logout] Unexpected sign-out failure", error);
    return NextResponse.json({ success: false, message: "Unable to sign out." }, { status: 500 });
  }
}
