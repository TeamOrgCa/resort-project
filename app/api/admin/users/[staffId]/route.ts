import { NextResponse } from "next/server";

import { createAuditLog, requireAdminStaff } from "@/lib/server/admin-audit";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import type { StaffRole } from "@/lib/auth/staff-auth";
import type { StaffUserRecord } from "@/components/admin/users/types";

interface UpdateStaffPayload {
  fullName: string;
  role: StaffRole;
  isActive: boolean;
}

const parseUpdatePayload = (value: unknown): UpdateStaffPayload | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const payload = value as Partial<UpdateStaffPayload>;
  const fullName = typeof payload.fullName === "string" ? payload.fullName.trim() : "";
  const role = payload.role === "admin" || payload.role === "staff" || payload.role === "cashier" ? payload.role : null;
  const isActive = typeof payload.isActive === "boolean" ? payload.isActive : false;

  if (!fullName || !role) {
    return null;
  }

  return { fullName, role, isActive };
};

export async function PATCH(request: Request, context: { params: Promise<{ staffId: string }> }) {
  try {
    const staffContext = await requireAdminStaff();

    if (!staffContext) {
      return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
    }

    const { staffId } = await context.params;
    const payload = parseUpdatePayload(await request.json());

    if (!payload) {
      return NextResponse.json({ success: false, message: "Invalid staff payload." }, { status: 400 });
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

    const { data: existingStaff, error: existingError } = await adminSupabase
      .from("staff_users")
      .select("id, full_name, email, role, is_active, active_session_id, last_login_at, last_logout_at, created_at, updated_at")
      .eq("id", staffId)
      .maybeSingle<StaffUserRecord>();

    if (existingError || !existingStaff) {
      return NextResponse.json({ success: false, message: "Staff user not found." }, { status: 404 });
    }

    if (existingStaff.id === staffContext.staffUser.id && existingStaff.role === "admin" && payload.role !== "admin") {
      return NextResponse.json({ success: false, message: "You cannot remove your own admin role." }, { status: 400 });
    }

    const nextValues = {
      full_name: payload.fullName,
      role: payload.role,
      is_active: payload.isActive,
      active_session_id: payload.isActive ? existingStaff.active_session_id : null,
      last_logout_at: payload.isActive ? existingStaff.last_logout_at : new Date().toISOString(),
    };

    const { data: updatedStaff, error: updateError } = await adminSupabase
      .from("staff_users")
      .update(nextValues)
      .eq("id", staffId)
      .select("id, full_name, email, role, is_active, active_session_id, last_login_at, last_logout_at, created_at, updated_at")
      .single<StaffUserRecord>();

    if (updateError || !updatedStaff) {
      return NextResponse.json({ success: false, message: "Failed to update staff user." }, { status: 500 });
    }

    const auditSuccess = await createAuditLog(staffContext, {
      action:
        existingStaff.is_active === payload.isActive
          ? "Staff edited"
          : payload.isActive
            ? "Staff enabled"
            : "Staff disabled",
      entityType: "staff_user",
      entityId: updatedStaff.id,
    });

    if (!auditSuccess) {
      return NextResponse.json({ success: false, message: "Staff updated but audit logging failed." }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Staff user updated.", staffUser: updatedStaff }, { status: 200 });
  } catch {
    return NextResponse.json({ success: false, message: "Unexpected error while updating staff user." }, { status: 500 });
  }
}