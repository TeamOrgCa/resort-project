import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotifications } from "@/lib/notifications";
import { uuidPattern } from "@/lib/booking/reservation-edit";

export async function POST(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ message: "Sign in as active resort staff." }, { status: 401 });
  if (!await staffHasPermission(staff.supabase, staff.staffUser.role, "edit_reservation")) return NextResponse.json({ message: "You cannot record guest checkout." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!uuidPattern.test(body?.reservationId ?? "") || body?.departureConfirmed !== true) return NextResponse.json({ message: "Select a reservation and confirm the guest is checking out." }, { status: 400 });
  const { data, error } = await createAdminClient().rpc("check_out_reservation", { p_reservation: body.reservationId, p_staff: staff.staffUser.id });
  if (error) return NextResponse.json({ message: ["PGRST202", "42703", "42883"].includes(error.code) ? "Apply docs/stay-completion-migration.sql before recording checkout." : ["40001", "42501", "P0002"].includes(error.code) ? error.message : "Unable to record checkout. Refresh the calendar and retry." }, { status: error.code === "42501" ? 403 : error.code === "40001" ? 409 : error.code === "P0002" ? 404 : 500 });
  if (!data) return NextResponse.json({ message: "Checkout could not be confirmed. Refresh the calendar." }, { status: 503 });
  let notificationSent = true;
  if (data.guest_id && !data.alreadyCheckedOut) {
    try {
      const result = await createNotifications({ actorId: staff.staffUser.id, guestId: data.guest_id, title: "Stay completed", message: `You have checked out of reservation ${data.reference_number}. Thank you for staying with us. You can now share your experience in Reviews.`, entityType: "reservation", entityId: body.reservationId, guestActionUrl: "/reviews" });
      notificationSent = !result.error;
    } catch { notificationSent = false; }
  }
  return NextResponse.json({ success: true, reservation: data, notificationSent, message: "Guest checked out. The reservation is completed." });
}
