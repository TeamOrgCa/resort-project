import { manilaTimestamp } from "@/lib/booking/manila-date";
import { NextResponse } from "next/server";

import { createAuditLog, requireAdminStaff } from "@/lib/server/admin-audit";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import type { StaffRole } from "@/lib/auth/staff-auth";
import type { StaffUserRecord } from "@/components/admin/users/types";
import { normalizePersonName, PERSON_NAME_ERROR } from "@/lib/validation/name";

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
  const fullName = normalizePersonName(payload.fullName);
  const role = payload.role === "admin" || payload.role === "staff" || payload.role === "cashier" ? payload.role : null;
  if (!fullName || !role || typeof payload.isActive !== "boolean") {
    return null;
  }

  return { fullName, role, isActive: payload.isActive };
};

export async function PATCH(request: Request, context: { params: Promise<{ staffId: string }> }) {
  try {
    const staffContext = await requireAdminStaff();

    if (!staffContext) {
      return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
    }

    const { staffId } = await context.params;
    const body = await request.json().catch(() => null);
    if (!normalizePersonName(body?.fullName)) return NextResponse.json({ success: false, field: "fullName", message: PERSON_NAME_ERROR }, { status: 400 });
    const payload = parseUpdatePayload(body);

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

    if (existingStaff.role === "admin") {
      if (existingStaff.is_active && !payload.isActive) {
        return NextResponse.json({ success: false, message: "Admin accounts cannot be disabled." }, { status: 403 });
      }
      if (payload.role !== "admin") {
        return NextResponse.json({ success: false, message: "Admin roles cannot be removed through staff management." }, { status: 403 });
      }
    }

    const nextValues = {
      full_name: payload.fullName,
      role: payload.role,
      is_active: payload.isActive,
      active_session_id: payload.isActive ? existingStaff.active_session_id : null,
      last_logout_at: payload.isActive ? existingStaff.last_logout_at : manilaTimestamp(),
    };

    const { data: updatedStaff, error: updateError } = await adminSupabase
      .from("staff_users")
      .update(nextValues)
      .eq("id", staffId)
      .eq("role", existingStaff.role)
      .eq("is_active", existingStaff.is_active)
      .select("id, full_name, email, role, is_active, active_session_id, last_login_at, last_logout_at, created_at, updated_at")
      .maybeSingle<StaffUserRecord>();

    if (updateError) {
      return NextResponse.json({ success: false, message: "Failed to update staff user." }, { status: 500 });
    }
    if (!updatedStaff) {
      return NextResponse.json({ success: false, message: "This account changed. Reload staff accounts before trying again." }, { status: 409 });
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
