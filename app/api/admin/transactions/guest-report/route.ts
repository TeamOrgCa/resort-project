import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { generateReport } from "@/lib/server/reports";

export async function GET(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  // Compatibility for existing links; guest reporting belongs to Reports.
  if (!(await staffHasPermission(staff.supabase, staff.staffUser.role, "reports"))) return NextResponse.json({ success: false, message: "Forbidden." }, { status: 403 });
  return generateReport(request, "Guest Report");
}
