import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidPattern } from "@/lib/booking/reservation-edit";

export async function POST(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff || staff.staffUser.role === "admin" || !await staffHasPermission(staff.supabase, staff.staffUser.role, "ocular_approval")) {
    return NextResponse.json({ success: false, message: "Ocular management permission required." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!uuidPattern.test(body?.visitId ?? "")) return NextResponse.json({ success: false, message: "Select a visit." }, { status: 400 });
  const { data: visit, error } = await createAdminClient().rpc("complete_ocular_visit", { p_visit: body.visitId, p_staff: staff.staffUser.id });
  return error ? NextResponse.json({ success: false, message: error.message }, { status: 400 })
    : NextResponse.json({ success: true, visit, message: "Ocular visit marked as visited." });
}
