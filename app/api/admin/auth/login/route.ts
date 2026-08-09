import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  STAFF_SESSION_COOKIE,
  parseStaffLoginPayload,
  type StaffAuthErrorResponse,
  type StaffAuthSuccessResponse,
  type StaffUserProfile,
} from "@/lib/auth/staff-auth";
import { createStaffSessionCookieOptions } from "@/lib/auth/staff-session";

export async function POST(request: Request) {
  try {
    const requestBody = await request.json();
    const credentials = parseStaffLoginPayload(requestBody);

    if (!credentials) {
      return NextResponse.json<StaffAuthErrorResponse>(
        {
          success: false,
          message: "Please provide a valid email and password.",
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const adminSupabase = serviceRoleKey ? createAdminClient() : null;

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: credentials.email,
      password: credentials.password,
    });

    if (signInError || !signInData.user) {
      return NextResponse.json<StaffAuthErrorResponse>(
        {
          success: false,
          message: "Invalid credentials.",
        },
        { status: 401 }
      );
    }

    const { data: staffUser, error: staffUserError } = await supabase
      .from("staff_users")
      .select("id, full_name, email, role, is_active, active_session_id")
      .eq("id", signInData.user.id)
      .maybeSingle<StaffUserProfile>();

    if (staffUserError || !staffUser) {
      await supabase.auth.signOut();

      return NextResponse.json<StaffAuthErrorResponse>(
        {
          success: false,
          message: "Staff account not found.",
        },
        { status: 403 }
      );
    }

    if (!staffUser.is_active) {
      await supabase.auth.signOut();

      return NextResponse.json<StaffAuthErrorResponse>(
        {
          success: false,
          message: "Your staff account is inactive.",
        },
        { status: 403 }
      );
    }

    const sessionToken = crypto.randomUUID();

    if (staffUser.active_session_id && staffUser.active_session_id !== sessionToken && adminSupabase) {
      await adminSupabase.from("audit_logs").insert({
        user_id: staffUser.id,
        action: "Session invalidated by another login",
        entity_type: "staff_session",
        entity_id: staffUser.active_session_id,
      });
    }

    const { error: updateError } = await supabase
      .from("staff_users")
      .update({
        active_session_id: sessionToken,
        last_login_at: new Date().toISOString(),
        ...(staffUser.active_session_id
          ? {
              last_logout_at: new Date().toISOString(),
            }
          : {}),
      })
      .eq("id", staffUser.id);

    if (updateError) {
      await supabase.auth.signOut();

      return NextResponse.json<StaffAuthErrorResponse>(
        {
          success: false,
          message: "Unable to initialize staff session.",
        },
        { status: 500 }
      );
    }

    if (adminSupabase) {
      await adminSupabase.from("audit_logs").insert({
        user_id: staffUser.id,
        action: "Login",
        entity_type: "staff_session",
        entity_id: sessionToken,
      });
    }

    const response: StaffAuthSuccessResponse = {
      success: true,
      message: "Staff authentication successful.",
      staffUser: {
        id: staffUser.id,
        fullName: staffUser.full_name,
        email: staffUser.email,
        role: staffUser.role,
      },
    };

    const successResponse = NextResponse.json<StaffAuthSuccessResponse>(response, { status: 200 });
    successResponse.cookies.set(STAFF_SESSION_COOKIE, sessionToken, createStaffSessionCookieOptions());

    return successResponse;
  } catch {
    return NextResponse.json<StaffAuthErrorResponse>(
      {
        success: false,
        message: "Unable to process login request.",
      },
      { status: 500 }
    );
  }
}
