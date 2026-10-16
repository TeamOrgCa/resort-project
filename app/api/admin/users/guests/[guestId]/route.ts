import { NextResponse } from "next/server";
import { requireAdminStaff } from "@/lib/server/admin-audit";

export async function PATCH(request: Request, context: { params: Promise<{ guestId: string }> }) {
  try {
    const staff = await requireAdminStaff();
    if (!staff) return NextResponse.json({ success: false, message: "Administrator access is required." }, { status: 403 });
    const { guestId } = await context.params;
    const body = await request.json().catch(() => null);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guestId)
      || !body || typeof body.isActive !== "boolean" || typeof body.expectedActive !== "boolean"
      || (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 1000))) {
      return NextResponse.json({ success: false, message: "Invalid guest account status." }, { status: 400 });
    }
    const { data, error } = await staff.supabase.rpc("set_guest_account_status", {
      p_guest: guestId, p_is_active: body.isActive, p_expected_active: body.expectedActive, p_reason: body.reason?.trim() || null,
    });
    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "40001" ? 409 : error.code === "22023" ? 400 : 503;
      const message = status < 500 ? error.message : "Unable to change guest access. Check that the guest account status migration is installed, then try again.";
      return NextResponse.json({ success: false, message }, { status });
    }
    return NextResponse.json({ success: true, guest: data, message: body.isActive
      ? "Guest account reactivated. The guest can sign in again." : "Guest account deactivated. Sign-in is blocked and the existing website session has ended." });
  } catch {
    return NextResponse.json({ success: false, message: "Unable to update the guest account." }, { status: 500 });
  }
}
