import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createNotifications, NOTIFICATION_AUDIENCES } from "@/lib/notifications";

interface CancelPayload {
  reservationId: string;
  acceptedNoRefundPolicy?: boolean;
}

interface ReservationCancelRow {
  reservation_id: string;
  guest_id: string;
  reference_number: string;
  start_datetime: string;
  status: "pending" | "payment_submitted" | "confirmed" | "expired" | "rejected" | "cancelled" | "completed";
}

const parsePayload = (value: unknown): CancelPayload | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Partial<CancelPayload>;

  if (typeof payload.reservationId !== "string") {
    return null;
  }

  return {
    reservationId: payload.reservationId,
    acceptedNoRefundPolicy: payload.acceptedNoRefundPolicy,
  };
};

export async function POST(request: Request) {
  try {
    const requestBody = await request.json();
    const payload = parsePayload(requestBody);

    if (!payload) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid cancellation request.",
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          success: false,
          message: "You must be logged in to cancel a reservation.",
        },
        { status: 401 }
      );
    }

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("reservation_id, guest_id, reference_number, start_datetime, status")
      .eq("reservation_id", payload.reservationId)
      .maybeSingle<ReservationCancelRow>();

    if (reservationError || !reservation) {
      return NextResponse.json(
        {
          success: false,
          message: "Reservation not found.",
        },
        { status: 404 }
      );
    }

    if (reservation.guest_id !== user.id) {
      return NextResponse.json(
        {
          success: false,
          message: "You can only cancel your own reservation.",
        },
        { status: 403 }
      );
    }

    if (reservation.status === "cancelled") {
      return NextResponse.json(
        {
          success: false,
          message: "This reservation is already cancelled.",
        },
        { status: 400 }
      );
    }

    if (reservation.status === "expired" || reservation.status === "rejected") {
      return NextResponse.json({ success: false, message: "This reservation is no longer active." }, { status: 400 });
    }

    if (reservation.status === "completed") {
      return NextResponse.json(
        {
          success: false,
          message: "Completed reservations can no longer be cancelled.",
        },
        { status: 400 }
      );
    }
    const { data: refundId, error: updateError } = await supabase.rpc("cancel_reservation_with_refund", {
      p_reservation: reservation.reservation_id,
      p_reason: "Guest requested cancellation",
      p_admin: false,
    });

    if (updateError) {
      return NextResponse.json(
        {
          success: false,
          message: updateError.message,
        },
        { status: updateError.code === "22023" ? 400 : 500 }
      );
    }

    const { error: notificationError } = await createNotifications({
      actorId: user.id,
      guestId: reservation.guest_id,
      staffRoles: NOTIFICATION_AUDIENCES.reservation,
      title: "Reservation cancelled",
      message: `Reservation ${reservation.reference_number} was cancelled.`,
      entityType: "reservation",
      entityId: reservation.reservation_id,
      guestActionUrl: "/manage",
      staffActionUrl: "/admin/reservations",
    });

    if (notificationError) {
      console.warn("Failed to create cancellation notifications:", notificationError);
    }

    if (refundId) {
      const refundNotice = await createNotifications({
        actorId: user.id, guestId: reservation.guest_id,
        staffRoles: ["admin", "cashier"], title: "Refund request pending",
        message: `A refund request for reservation ${reservation.reference_number} is awaiting review.`,
        entityType: "refund_request", entityId: refundId,
        guestActionUrl: "/manage", staffActionUrl: "/admin/transactions",
      });
      if (refundNotice.error) console.warn("Failed to create refund notifications:", refundNotice.error);
    }

    return NextResponse.json({
      success: true,
      reservationId: reservation.reservation_id,
      referenceNumber: reservation.reference_number,
      refundId,
      message: refundId ? "Reservation cancelled. Your refund request is pending review." : "Reservation cancelled successfully.",
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while cancelling reservation.",
      },
      { status: 500 }
    );
  }
}
