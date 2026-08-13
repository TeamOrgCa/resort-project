import { NextResponse } from "next/server";

import { STAFF_SESSION_COOKIE } from "@/lib/auth/staff-auth";
import { createAuditLog, requireActiveStaff } from "@/lib/server/admin-audit";

export async function POST() {
  try {
    const staffContext = await requireActiveStaff();

    if (!staffContext) {
      const response = NextResponse.json({ success: true, message: "Signed out." }, { status: 200 });
      response.cookies.delete(STAFF_SESSION_COOKIE);
      return response;
    }

    const { error } = await staffContext.supabase
      .from("staff_users")
      .update({
        active_session_id: null,
        last_logout_at: new Date().toISOString(),
      })
      .eq("id", staffContext.staffUser.id);

    if (!error) {
      await createAuditLog(staffContext, {
        action: "Logout",
        entityType: "staff_session",
        entityId: staffContext.staffUser.active_session_id,
      });
    }

    await staffContext.supabase.auth.signOut();

    const response = NextResponse.json({ success: true, message: "Signed out." }, { status: 200 });
    response.cookies.delete(STAFF_SESSION_COOKIE);
    return response;
  } catch {
    const response = NextResponse.json({ success: true, message: "Signed out." }, { status: 200 });
    response.cookies.delete(STAFF_SESSION_COOKIE);
    return response;
  }
}