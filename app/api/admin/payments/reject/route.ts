import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { createNotifications } from "@/lib/notifications";

export async function POST(request: Request) {
  try {
    const staff = await requireActiveStaff();
    if (!staff) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
    if (!(await staffHasPermission(staff.supabase, staff.staffUser.role, "payment_approval"))) {
      return NextResponse.json({ success: false, message: "Payment approval permission required." }, { status: 403 });
    }
    const body = await request.json().catch(() => null) as { paymentId?: unknown; rejectionReason?: unknown } | null;
    const paymentId = typeof body?.paymentId === "string" ? body.paymentId.trim() : "";
    if (!paymentId) return NextResponse.json({ success: false, message: "Payment ID is required." }, { status: 400 });
    const rejectionReason = typeof body?.rejectionReason === "string" ? body.rejectionReason.trim() : "";
    if (rejectionReason.length < 5 || rejectionReason.length > 2000) return NextResponse.json({ success: false, message: "A rejection reason of 5 to 2,000 characters is required." }, { status: 400 });

    const { data: rejected, error } = await staff.supabase.from("payments")
      .update({ status: "rejected", rejection_reason: rejectionReason }).eq("payment_id", paymentId).eq("status", "pending")
      .select("payment_id, reservation_id").maybeSingle<{ payment_id: string; reservation_id: string }>();
    if (error) return NextResponse.json({ success: false, message: ["42703", "PGRST204"].includes(error.code) ? "Apply the payment review and notification migration before rejecting payments." : error.message }, { status: 400 });
    if (!rejected) return NextResponse.json({ success: false, message: "This payment was already reviewed." }, { status: 409 });

    const { data: reservation } = await staff.supabase.from("reservations")
      .select("guest_id, reference_number, status").eq("reservation_id", rejected.reservation_id)
      .maybeSingle<{ guest_id: string | null; reference_number: string; status: string }>();
    let notificationSent: boolean | null = null;
    if (reservation?.guest_id) {
      const { error: notificationError } = await createNotifications({
        actorId: staff.staffUser.id,
        guestId: reservation.guest_id,
        title: "Payment rejected",
        message: reservation.status === "rejected"
          ? `Payment for reservation ${reservation.reference_number} was rejected. Reason: ${rejectionReason}. You can make a new reservation.`
          : `Payment for reservation ${reservation.reference_number} was rejected. Reason: ${rejectionReason}. Please contact the resort about the balance.`,
        entityType: "payment",
        entityId: rejected.payment_id,
        guestActionUrl: "/manage",
      });
      if (notificationError) console.warn("Failed to notify guest of payment rejection:", notificationError);
      notificationSent = !notificationError;
    }
    return NextResponse.json({ success: true, message: "Payment rejected. The reason has been saved.", notificationSent });
  } catch {
    return NextResponse.json({ success: false, message: "Unable to reject payment." }, { status: 500 });
  }
}
