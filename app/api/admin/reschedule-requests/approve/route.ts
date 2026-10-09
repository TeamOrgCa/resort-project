import { NextResponse } from "next/server";
import { createAuditLog, requireActiveStaff } from "@/lib/server/admin-audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotifications } from "@/lib/notifications";
import { checkReservationOverlap } from "@/lib/server/reservation-availability";
import { hasPermission } from "@/lib/auth/role-access";
import { BOOKING_LEAD_MESSAGE, isBookingStartAllowed } from "@/lib/booking/start-time";

type RescheduleRow = {
  reschedule_id: string;
  reservation_id: string;
  status: string;
  new_start: string;
  new_end: string;
  reschedule_fee: number;
  rate_adjustment: number;
};

export async function POST(request: Request) {
  try {
    const staffContext = await requireActiveStaff();
    if (!staffContext) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
    const role = staffContext.staffUser.role;
    const { data: grants, error: grantsError } = role === "admin"
      ? { data: null, error: null }
      : await staffContext.supabase.from("role_permissions").select("permissions").eq("role", role).maybeSingle();
    if (grantsError || !hasPermission(role, grants?.permissions ?? [], "reschedule_approval")) {
      return NextResponse.json({ success: false, message: "Reschedule approval permission is required." }, { status: 403 });
    }

    const body = await request.json().catch(() => null) as { rescheduleId?: unknown } | null;
    const rescheduleId = typeof body?.rescheduleId === "string" ? body.rescheduleId.trim() : "";
    if (!rescheduleId) return NextResponse.json({ success: false, message: "Select a reschedule request." }, { status: 400 });

    const admin = createAdminClient();
    const { data: requestRow, error: requestError } = await admin.from("reservation_reschedules")
      .select("reschedule_id, reservation_id, status, new_start, new_end, reschedule_fee, rate_adjustment")
      .eq("reschedule_id", rescheduleId).maybeSingle<RescheduleRow>();
    if (requestError || !requestRow) return NextResponse.json({ success: false, message: "Reschedule request not found." }, { status: 404 });
    if (requestRow.status !== "pending") return NextResponse.json({ success: false, message: "This request has already been reviewed." }, { status: 409 });
    if (!isBookingStartAllowed(requestRow.new_start)) {
      return NextResponse.json({ success: false, message: BOOKING_LEAD_MESSAGE }, { status: 409 });
    }

    const { data: reservation, error: reservationError } = await admin.from("reservations")
      .select("guest_id, reference_number, status")
      .eq("reservation_id", requestRow.reservation_id)
      .maybeSingle<{ guest_id: string | null; reference_number: string; status: string }>();
    if (reservationError || !reservation || reservation.status !== "reschedule_requested") {
      return NextResponse.json({ success: false, message: "Reservation is no longer awaiting reschedule approval." }, { status: 409 });
    }

    const { conflict, error: overlapError } = await checkReservationOverlap(
      requestRow.new_start, requestRow.new_end, reservation.guest_id, requestRow.reservation_id,
    );
    if (overlapError) return NextResponse.json({ success: false, message: "Unable to check the requested schedule." }, { status: 500 });
    if (conflict) return NextResponse.json({ success: false, message: "The requested date was reserved by another guest." }, { status: 409 });

    const { data, error } = await admin.rpc("approve_reschedule_request", {
      p_reschedule_id: rescheduleId,
      p_staff_id: staffContext.staffUser.id,
    });
    if (error) {
      console.error("Reschedule approval failed:", error);
      const conflict = error.code === "23P01" || error.code === "P0001";
      return NextResponse.json({ success: false, message: conflict
        ? "This request can no longer be approved. Refresh the records and check its date and status."
        : "Unable to approve the request. Apply the reschedule approval migration if it is not installed." }, { status: conflict ? 409 : 500 });
    }

    const result = data as { totalAmount: number; paidAmount: number; additionalCharge: number };
    const additionalCharge = Number(result.additionalCharge ?? 0);
    try {
      const auditSuccess = await createAuditLog(staffContext, {
        action: `Approved reschedule request (additional charge: PHP ${additionalCharge.toFixed(2)})`,
        entityType: "reservation_reschedule", entityId: rescheduleId,
      });
      if (!auditSuccess) console.error("Reschedule approved but audit logging failed:", rescheduleId);
    } catch (auditError) {
      console.error("Reschedule approved but audit logging failed:", auditError);
    }

    if (reservation.guest_id) {
      try { const { error: notificationError } = await createNotifications({
        actorId: staffContext.staffUser.id,
        guestId: reservation.guest_id,
        title: "Reschedule approved",
        message: `Reservation ${reservation.reference_number} was rescheduled. Additional charge: PHP ${additionalCharge.toFixed(2)}. Pay the updated balance in Manage Booking.`,
        entityType: "reservation_reschedule",
        entityId: rescheduleId,
        guestActionUrl: "/manage",
      });
      if (notificationError) console.warn("Failed to notify guest of reschedule approval:", notificationError);
      } catch (notificationError) { console.warn("Failed to notify guest of reschedule approval:", notificationError); }
    }

    return NextResponse.json({
      success: true, rescheduleId, reservationId: requestRow.reservation_id,
      status: "approved", rescheduleFee: Number(requestRow.reschedule_fee),
      rateAdjustment: Number(requestRow.rate_adjustment), additionalCharge,
      totalAmount: Number(result.totalAmount), paidAmount: Number(result.paidAmount),
      message: "Reschedule approved. The guest's balance includes the additional charge.",
    });
  } catch (error) {
    console.error("Unexpected reschedule approval error:", error);
    return NextResponse.json({ success: false, message: "Unexpected error while approving reschedule request." }, { status: 500 });
  }
}
