import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ message: "Sign in as active resort staff." }, { status: 401 });
  if (!await staffHasPermission(staff.supabase, staff.staffUser.role, "edit_reservation")) return NextResponse.json({ message: "You cannot record guest check-in." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.reservationId ?? "") || body.arrivalConfirmed !== true) {
    return NextResponse.json({ message: "Select a reservation and confirm the guest has arrived." }, { status: 400 });
  }
  const { data, error } = await createAdminClient().rpc("check_in_reservation", { p_reservation: body.reservationId, p_staff: staff.staffUser.id });
  if (error) return NextResponse.json({ message: ["PGRST202", "42703", "42883"].includes(error.code) ? "Apply the reservation calendar attendance migration before recording check-ins."
    : error.code === "40001" ? error.message : "Unable to record check-in. Please refresh and retry." }, { status: error.code === "42501" ? 403 : error.code === "40001" ? 409 : 500 });
  return NextResponse.json({ success: true, reservation: data, message: "Guest check-in recorded. Cancellation and rescheduling are now locked." });
}
