import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  parseStaffLoginPayload,
  type StaffAuthErrorResponse,
  type StaffAuthSuccessResponse,
  type StaffUserProfile,
} from "@/lib/auth/staff-auth";

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
      .select("id, full_name, email, role, is_active")
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

    return NextResponse.json<StaffAuthSuccessResponse>(response, { status: 200 });
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
