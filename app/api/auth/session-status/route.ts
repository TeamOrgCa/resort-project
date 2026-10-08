import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthSessionId } from "@/lib/auth/auth-session";
import { getStaffSessionTokenFromCookieStore } from "@/lib/auth/staff-session";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ status: "none" }, { headers: { "Cache-Control": "no-store" } });

  const { data: staff, error: staffError } = await supabase.from("staff_users")
    .select("is_active, active_session_id").eq("id", user.id).maybeSingle();
  if (staffError) return NextResponse.json({ message: "Unable to check session." }, { status: 503 });
  if (staff) {
    const token = getStaffSessionTokenFromCookieStore(await cookies());
    return NextResponse.json({ kind: "staff", status: staff.is_active && token && staff.active_session_id === token ? "active" : "replaced" }, { headers: { "Cache-Control": "no-store" } });
  }

  const { data: guest, error: guestError } = await supabase.from("guests")
    .select("active_session_id").eq("id", user.id).maybeSingle();
  if (guestError) return NextResponse.json({ message: "Unable to check session." }, { status: 503 });
  const { data: { session } } = await supabase.auth.getSession();
  const sessionId = getAuthSessionId(session?.access_token);
  return NextResponse.json({ kind: "guest", status: guest && sessionId && guest.active_session_id === sessionId ? "active" : "replaced" }, { headers: { "Cache-Control": "no-store" } });
}
