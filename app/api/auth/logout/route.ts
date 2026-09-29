import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEVICE_COOKIE, isDeviceId, recordAttempt } from "@/lib/server/login-access";

export async function POST() {
  try {
    const supabase = await createClient();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const deviceId = (await cookies()).get(DEVICE_COOKIE)?.value;
      if (user?.email && isDeviceId(deviceId)) {
        await recordAttempt(createAdminClient(), user.email.toLowerCase(), deviceId, "guest", "logout", user.id);
      }
    } catch (auditError) {
      console.warn("[guest logout] Could not record logout audit event", auditError);
    }

    const { error } = await supabase.auth.signOut();
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
