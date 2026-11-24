import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { savePublicBooking } from "@/lib/server/public-booking-request";
export async function POST(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff || !await staffHasPermission(staff.supabase, staff.staffUser.role, "create_reservation")) return NextResponse.json({ message: "Reservation creation permission required." }, { status: 403 });
  try { return await savePublicBooking(request, staff.staffUser.id, staff.supabase, true); }
  catch { return NextResponse.json({ message: "Unable to save public swimming. Please retry." }, { status: 503 }); }
}
