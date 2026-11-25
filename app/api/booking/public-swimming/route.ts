import { NextResponse } from "next/server";
import { loadPublicSwimmingCatalog } from "@/lib/server/public-swimming";
import { createClient } from "@/lib/supabase/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { uuidPattern } from "@/lib/booking/reservation-edit";
import { isValidManilaDate } from "@/lib/booking/manila-date";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams, exclude = params.get("excludeReservationId"), month = params.get("month");
    if (month !== null && (!/^\d{4}-\d{2}$/.test(month) || !isValidManilaDate(`${month}-01`) || month < "0001-01" || month > "9998-12")) {
      return NextResponse.json({ message: "Choose a valid calendar month." }, { status: 400 });
    }
    if (exclude) {
      if (!uuidPattern.test(exclude)) return NextResponse.json({ message: "Choose a valid reservation." }, { status: 400 });
      const client = await createClient(), { data: { user } } = await client.auth.getUser();
      if (!user) return NextResponse.json({ message: "Sign in to reschedule your booking." }, { status: 401 });
      const owned = await client.from("reservations").select("reservation_id").eq("reservation_id", exclude).eq("guest_id", user.id).eq("commercial_type", "public_swimming").maybeSingle();
      if (owned.error) throw owned.error;
      if (!owned.data) {
        const staff = await requireActiveStaff();
        if (!staff || !await staffHasPermission(staff.supabase, staff.staffUser.role, "reservations")) return NextResponse.json({ message: "You may only exclude your own public booking." }, { status: 403 });
      }
    }
    const catalog = month ? await loadPublicSwimmingCatalog(exclude ?? undefined, month) : await loadPublicSwimmingCatalog(exclude ?? undefined);
    return NextResponse.json({ success: true, ...catalog }, { headers: { "Cache-Control": exclude ? "private, no-store" : "no-store" } });
  }
  catch { return NextResponse.json({ message: "Public swimming availability is unavailable. Please retry." }, { status: 503 }); }
}
