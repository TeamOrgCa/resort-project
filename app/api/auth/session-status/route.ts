import { NextResponse } from "next/server";
import { getAuthSessionId } from "@/lib/auth/auth-session";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "UNAUTHORIZED", status: "none" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { data: { session } } = await supabase.auth.getSession();
  const sessionId = getAuthSessionId(session?.access_token);

  const { data: staff, error: staffError } = await supabase.from("staff_users")
    .select("is_active, active_session_id").eq("id", user.id).maybeSingle();
  if (staffError) return NextResponse.json({ message: "Unable to check session." }, { status: 503 });
  if (staff) {
    if (!staff.is_active || !sessionId) return NextResponse.json({ kind: "staff", status: "none", code: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const active = staff.active_session_id === sessionId;
    return NextResponse.json({ kind: "staff", status: active ? "active" : "replaced", ...(active ? {} : { code: "SESSION_REPLACED" }) }, { status: active ? 200 : 401, headers: { "Cache-Control": "no-store" } });
  }

  const { data: guest, error: guestError } = await supabase.from("guests")
    .select("active_session_id").eq("id", user.id).maybeSingle();
  if (guestError) return NextResponse.json({ message: "Unable to check session." }, { status: 503 });
  if (!guest || !sessionId) return NextResponse.json({ kind: "guest", status: "none", code: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const active = guest.active_session_id === sessionId;
  return NextResponse.json({ kind: "guest", status: active ? "active" : "replaced", ...(active ? {} : { code: "SESSION_REPLACED" }) }, { status: active ? 200 : 401, headers: { "Cache-Control": "no-store" } });
}
