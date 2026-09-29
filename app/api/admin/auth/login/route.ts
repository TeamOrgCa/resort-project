import { NextResponse } from "next/server";
import { STAFF_SESSION_COOKIE, type StaffUserProfile } from "@/lib/auth/staff-auth";
import { createStaffSessionCookieOptions } from "@/lib/auth/staff-session";
import { loginAccess, loginError, recordAttempt } from "@/lib/server/login-access";

export async function POST(request: Request) {
  try {
    const access = await loginAccess("staff", await request.json());
    if (access.response) return access.response;
    const { admin, supabase, user, email, deviceId, finish } = access;

    const { data: staff, error } = await admin.from("staff_users")
      .select("id, full_name, email, role, is_active, active_session_id")
      .eq("id", user.id).maybeSingle<StaffUserProfile>();

    if (error || !staff || !staff.is_active) {
      await recordAttempt(admin, email, deviceId, "staff", "denied", user.id);
      await supabase.auth.signOut();
      return finish(loginError("Staff account is unavailable.", 403));
    }

    const sessionToken = crypto.randomUUID();
    const { error: updateError } = await admin.from("staff_users").update({
      active_session_id: sessionToken,
      last_login_at: new Date().toISOString(),
      ...(staff.active_session_id ? { last_logout_at: new Date().toISOString() } : {}),
    }).eq("id", staff.id);
    if (updateError) throw updateError;

    if (staff.active_session_id) {
      const { error: auditError } = await admin.from("audit_logs").insert({
        user_id: staff.id, action: "Session invalidated by another login",
        entity_type: "staff_session", entity_id: staff.active_session_id,
        attempted_email: email, auth_user_id: user.id, device_id: deviceId,
      });
      if (auditError) throw auditError;
    }
    await recordAttempt(admin, email, deviceId, "staff", "success", user.id);

    const response = NextResponse.json({ success: true, message: "Staff authentication successful.", staffUser: {
      id: staff.id, fullName: staff.full_name, email: staff.email, role: staff.role,
    } });
    response.cookies.set(STAFF_SESSION_COOKIE, sessionToken, createStaffSessionCookieOptions());
    return finish(response);
  } catch {
    return loginError("Unable to process login request.", 500);
  }
}
