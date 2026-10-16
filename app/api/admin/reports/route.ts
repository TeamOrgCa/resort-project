import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { generateReport } from "@/lib/server/reports";

export async function GET(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  if (!(await staffHasPermission(staff.supabase, staff.staffUser.role, "reports"))) return NextResponse.json({ success: false, message: "Forbidden." }, { status: 403 });
  const tab = new URL(request.url).searchParams.get("tab") ?? "Sales Report";
  if (tab !== "Sales Report" && tab !== "Staff Report" && tab !== "Guest Report") return NextResponse.json({ success: false, message: "Unsupported report." }, { status: 400 });
  return generateReport(request, tab);
}
