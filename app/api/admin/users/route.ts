import { NextResponse } from "next/server";

import { createAuditLog, requireAdminStaff } from "@/lib/server/admin-audit";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { isStaffRole, type StaffRole } from "@/lib/auth/staff-auth";
import type { StaffUserRecord } from "@/components/admin/users/types";

interface CreateStaffPayload {
  fullName: string;
  email: string;
  role: StaffRole;
  password: string;
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
  const fullName = typeof payload.fullName === "string" ? payload.fullName.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  const role = typeof payload.role === "string" && isStaffRole(payload.role) ? payload.role : null;
  const isActive = typeof payload.isActive === "boolean" ? payload.isActive : true;

  if (!fullName || !email || !password || password.length < 8 || !role) {
    return null;
  }

  return { fullName, email, role, password, isActive };
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

    const { data, error } = await adminSupabase
      .from("staff_users")
      .select(
        "id, full_name, email, role, is_active, active_session_id, last_login_at, last_logout_at, created_at, updated_at"
      )
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, message: "Failed to load staff users." }, { status: 500 });
    }

    const rows = (data as StaffUserRecord[] | null) ?? [];

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

    const payload = parseCreatePayload(await request.json());

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

    const { data: existingStaff } = await adminSupabase
      .from("staff_users")
      .select("id")
      .ilike("email", payload.email)
      .maybeSingle();

    if (existingStaff) {
      return NextResponse.json({ success: false, message: "That email is already in use." }, { status: 409 });
    }

    const { data: authUser, error: createAuthError } = await adminSupabase.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
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

    if (!auditSuccess) {
      return NextResponse.json({ success: false, message: "Staff created but audit logging failed." }, { status: 500 });
    }

    return NextResponse.json(
      {
        success: true,
        message: "Staff user created.",
        staffUser: createdStaff,
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ success: false, message: "Unexpected error while creating staff user." }, { status: 500 });
  }
}