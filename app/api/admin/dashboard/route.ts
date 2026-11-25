import { isReservationTypeFilter } from "@/lib/booking/commercial-types";
import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { getRolePermissions } from "@/lib/server/role-permissions";
import { hasPermission, PERMISSIONS } from "@/lib/auth/role-access";
import { generateDashboard } from "@/lib/server/dashboard";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  try {
    const staff = await requireActiveStaff();
    if (!staff) return json({ success: false, message: "Please sign in with an active staff account." }, 401);
    const granted = await getRolePermissions(staff.supabase, staff.staffUser.role);
    if (!hasPermission(staff.staffUser.role, granted, "dashboard")) return json({ success: false, message: "You do not have access to the dashboard." }, 403);
    const filter = request ? new URL(request.url).searchParams.get("reservationType") ?? "all" : "all";
    if (!isReservationTypeFilter(filter)) return json({ success: false, message: "Choose a valid reservation type." }, 400);
    const permissions = PERMISSIONS.filter(p => hasPermission(staff.staffUser.role, granted, p));
    return json({ success: true, dashboard: { ...await generateDashboard(new Date(), filter), permissions } });
  } catch (error) {
    console.error("Dashboard load failed", error);
    return json({ success: false, message: "Unable to load the dashboard. Refresh to try again." }, 500);
  }
}
