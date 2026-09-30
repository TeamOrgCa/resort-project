import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { createNotifications } from "@/lib/notifications";

export async function POST(request: Request) {
  try {
    const staff = await requireActiveStaff();
    if (!staff) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
    if (staff.staffUser.role !== "admin" && staff.staffUser.role !== "cashier") {
      return NextResponse.json({ success: false, message: "Only admin or cashier can reject payments." }, { status: 403 });
    }
    const body = await request.json().catch(() => null) as { paymentId?: unknown } | null;
    const paymentId = typeof body?.paymentId === "string" ? body.paymentId.trim() : "";
    if (!paymentId) return NextResponse.json({ success: false, message: "Payment ID is required." }, { status: 400 });

    const { data: rejected, error } = await staff.supabase.from("payments")
      .update({ status: "rejected" }).eq("payment_id", paymentId).eq("status", "pending")
      .select("payment_id, reservation_id").maybeSingle<{ payment_id: string; reservation_id: string }>();
    if (error) return NextResponse.json({ success: false, message: error.message }, { status: 400 });
    if (!rejected) return NextResponse.json({ success: false, message: "This payment was already reviewed." }, { status: 409 });

    const { data: reservation } = await staff.supabase.from("reservations")
      .select("guest_id, reference_number, status").eq("reservation_id", rejected.reservation_id)
      .maybeSingle<{ guest_id: string | null; reference_number: string; status: string }>();
    if (reservation?.guest_id) {
      const { error: notificationError } = await createNotifications({
        actorId: staff.staffUser.id,
        guestId: reservation.guest_id,
        title: "Payment rejected",
        message: reservation.status === "rejected"
          ? `Payment for reservation ${reservation.reference_number} was rejected. You can make a new reservation.`
          : `Payment for reservation ${reservation.reference_number} was rejected. Please contact the resort about the balance.`,
        entityType: "payment",
        entityId: rejected.payment_id,
        guestActionUrl: "/manage",
      });
      if (notificationError) console.warn("Failed to notify guest of payment rejection:", notificationError);
    }
    return NextResponse.json({ success: true, message: "Payment rejected." });
  } catch {
    return NextResponse.json({ success: false, message: "Unable to reject payment." }, { status: 500 });
  }
}
