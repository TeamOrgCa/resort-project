import { NextResponse } from "next/server";

import { createAuditLog, requireAdminStaff } from "@/lib/server/admin-audit";
import { tryCreateAdminClient } from "@/lib/supabase/admin";

interface ResetPasswordPayload {
  password: string;
}

const parsePayload = (value: unknown): ResetPasswordPayload | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const payload = value as Partial<ResetPasswordPayload>;
  const password = typeof payload.password === "string" ? payload.password : "";

  if (password.length < 8) {
    return null;
  }

  return { password };
};

export async function POST(request: Request, context: { params: Promise<{ staffId: string }> }) {
  try {
    const staffContext = await requireAdminStaff();

    if (!staffContext) {
      return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
    }

    const { staffId } = await context.params;
    const payload = parsePayload(await request.json());

    if (!payload) {
      return NextResponse.json({ success: false, message: "Invalid password payload." }, { status: 400 });
    }

    const adminSupabase = tryCreateAdminClient();

    if (!adminSupabase) {
      return NextResponse.json(
        {
          success: false,
          message: "Staff management is not configured. Set SUPABASE_SERVICE_ROLE_KEY on the server.",
        },
        { status: 503 }
      );
    }

    const { error: updateAuthError } = await adminSupabase.auth.admin.updateUserById(staffId, {
      password: payload.password,
    });

    if (updateAuthError) {
      return NextResponse.json({ success: false, message: updateAuthError.message }, { status: 500 });
    }

    const { error: revokeError } = await adminSupabase
      .from("staff_users")
      .update({
        active_session_id: null,
        last_logout_at: new Date().toISOString(),
      })
      .eq("id", staffId);

    if (revokeError) {
      return NextResponse.json({ success: false, message: "Password updated but session revoke failed." }, { status: 500 });
    }

    const auditSuccess = await createAuditLog(staffContext, {
      action: "Password reset",
      entityType: "staff_user",
      entityId: staffId,
    });

    if (!auditSuccess) {
      return NextResponse.json({ success: false, message: "Password reset but audit logging failed." }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Password reset successfully." }, { status: 200 });
  } catch {
    return NextResponse.json({ success: false, message: "Unexpected error while resetting password." }, { status: 500 });
  }
}