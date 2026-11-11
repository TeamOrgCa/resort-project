import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidPattern } from "@/lib/booking/reservation-edit";

export async function POST(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ message: "Sign in as an active manager." }, { status: 401 });
  if (staff.staffUser.role !== "staff" || !await staffHasPermission(staff.supabase, staff.staffUser.role, "edit_reservation")) {
    return NextResponse.json({ message: "Only a manager with Edit reservations permission can record a no-show." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (typeof body?.reservationId !== "string" || !uuidPattern.test(body.reservationId) || body.noShowConfirmed !== true || reason.length < 5 || reason.length > 2000) {
    return NextResponse.json({ message: "Choose a reservation, enter a reason of 5–2,000 characters and confirm that the guest did not arrive." }, { status: 400 });
  }
  const { data, error } = await createAdminClient().rpc("mark_reservation_no_show", {
    p_reservation: body.reservationId, p_staff: staff.staffUser.id, p_reason: reason,
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "22023" ? 400 : ["40001", "23514"].includes(error.code) ? 409 : 503;
    return NextResponse.json({ message: ["PGRST202", "42703", "42883"].includes(error.code)
      ? "Apply docs/reservation-no-show-migration.sql before recording no-shows."
      : [400, 403, 404, 409].includes(status) ? error.message : "Unable to record the no-show. Refresh the reservation and retry." }, { status });
  }
  if (!data) return NextResponse.json({ message: "The no-show could not be confirmed. Refresh the reservation." }, { status: 503 });
  return NextResponse.json({ success: true, reservation: data, message: data.alreadyMarkedNoShow ? "This reservation is already marked No show." : "Reservation marked No show. The guest was notified when linked to a registered account." });
}
