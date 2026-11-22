import { fetchAllPages } from "@/lib/server/fetch-all-pages";
import { NextResponse } from "next/server";

import { createAuditLog, requireAdminStaff } from "@/lib/server/admin-audit";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { isStaffRole, type StaffRole } from "@/lib/auth/staff-auth";
import type { StaffUserRecord } from "@/components/admin/users/types";
import { isValidStaffEmailForRole, staffEmailError } from "@/lib/auth/staff-email";
import { normalizePersonName, PERSON_NAME_ERROR } from "@/lib/validation/name";
import { generateTemporaryPassword } from "@/lib/server/temporary-password";

interface CreateStaffPayload {
  fullName: string;
  email: string;
  role: StaffRole;
  isActive: boolean;
}

interface StaffListResponse {
  success: true;
  currentStaffUserId: string;
  rows: StaffUserRecord[];
}

const parseCreatePayload = (value: unknown): CreateStaffPayload | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const payload = value as Partial<CreateStaffPayload>;
  const fullName = normalizePersonName(payload.fullName);
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const role = typeof payload.role === "string" && isStaffRole(payload.role) ? payload.role : null;
  const isActive = typeof payload.isActive === "boolean" ? payload.isActive : true;

  if (!fullName || !email || !role) {
    return null;
  }

  return { fullName, email, role, isActive };
};

export async function GET() {
  try {
    const staffContext = await requireAdminStaff();

    if (!staffContext) {
      return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
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

    const rows = await fetchAllPages<StaffUserRecord>((from, to) => adminSupabase.from("staff_users")
      .select("id, full_name, email, role, is_active, active_session_id, last_login_at, last_logout_at, created_at, updated_at")
      .order("created_at", { ascending: false }).order("id").range(from, to));

    const response: StaffListResponse = {
      success: true,
      currentStaffUserId: staffContext.staffUser.id,
      rows,
    };

    return NextResponse.json(response, { status: 200 });
  } catch {
    return NextResponse.json({ success: false, message: "Unexpected error while loading staff users." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const staffContext = await requireAdminStaff();

    if (!staffContext) {
      return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!normalizePersonName(body?.fullName)) return NextResponse.json({ success: false, field: "fullName", message: PERSON_NAME_ERROR }, { status: 400 });
    const payload = parseCreatePayload(body);

    if (!payload) {
      return NextResponse.json({ success: false, message: "Invalid staff payload." }, { status: 400 });
    }

    if (!isValidStaffEmailForRole(payload.email, payload.role)) {
      return NextResponse.json({ success: false, field: "email", message: staffEmailError(payload.role) }, { status: 400 });
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

    const { data: existingStaff } = await adminSupabase
      .from("staff_users")
      .select("id")
      .ilike("email", payload.email.replace(/[\\%_]/g, "\\$&"))
      .maybeSingle();

    if (existingStaff) {
      return NextResponse.json({ success: false, message: "That email is already in use." }, { status: 409 });
    }

    const temporaryPassword = generateTemporaryPassword();
    const { data: authUser, error: createAuthError } = await adminSupabase.auth.admin.createUser({
      email: payload.email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        full_name: payload.fullName,
      },
    });

    if (createAuthError || !authUser.user) {
      return NextResponse.json({ success: false, message: createAuthError?.message ?? "Failed to create auth user." }, { status: 500 });
    }

    const { data: createdStaff, error: insertError } = await adminSupabase
      .from("staff_users")
      .insert({
        id: authUser.user.id,
        full_name: payload.fullName,
        email: payload.email,
        role: payload.role,
        is_active: payload.isActive,
        must_change_password: true,
        active_session_id: null,
        last_login_at: null,
        last_logout_at: null,
      })
      .select("id, full_name, email, role, is_active, active_session_id, last_login_at, last_logout_at, created_at, updated_at")
      .single<StaffUserRecord>();

    if (insertError || !createdStaff) {
      await adminSupabase.auth.admin.deleteUser(authUser.user.id);
      return NextResponse.json({ success: false, message: "Failed to create staff profile." }, { status: 500 });
    }

    const auditSuccess = await createAuditLog(staffContext, {
      action: "Staff created",
      entityType: "staff_user",
      entityId: createdStaff.id,
    });

    return NextResponse.json(
      {
        success: true,
        message: auditSuccess ? "Staff user created." : "Staff user created, but audit logging failed.",
        staffUser: createdStaff,
        temporaryPassword,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ success: false, message: "Unexpected error while creating staff user." }, { status: 500 });
  }
}
