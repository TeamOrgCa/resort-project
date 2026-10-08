import { NextResponse } from "next/server";

import { requireActiveStaff } from "@/lib/server/admin-audit";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const staffContext = await requireActiveStaff();
    if (!staffContext) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });

    const body = await request.json() as { password?: unknown; confirmPassword?: unknown };
    const password = typeof body.password === "string" ? body.password : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
    if (password.length < 8 || password.length > 128) {
      return NextResponse.json({ success: false, message: "Password must be between 8 and 128 characters." }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ success: false, message: "Passwords do not match." }, { status: 400 });
    }

    const supabase = await createClient();
    const { error: updateAuthError } = await supabase.auth.updateUser({ password });
    if (updateAuthError) return NextResponse.json({ success: false, message: updateAuthError.message }, { status: 400 });

    const { error: updateProfileError } = await staffContext.supabase
      .from("staff_users")
      .update({ must_change_password: false })
      .eq("id", staffContext.staffUser.id);
    if (updateProfileError) throw updateProfileError;

    return NextResponse.json({ success: true, message: "Password updated successfully." });
  } catch {
    return NextResponse.json({ success: false, message: "Unable to update your password." }, { status: 500 });
  }
}