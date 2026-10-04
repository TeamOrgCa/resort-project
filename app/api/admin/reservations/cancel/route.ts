import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { createNotifications } from "@/lib/notifications";
import { sendReservationCancelledEmail } from "@/lib/email";

const cancellationReasons = [
  "Guest requested for cancellation",
  "Maintenance",
  "Emergency Situation",
] as const;

type CancellationReason = (typeof cancellationReasons)[number];

interface CancelReservationPayload {
  reservationId: string;
  cancellationReason: CancellationReason;
}

interface ReservationRow {
  reservation_id: string;
  guest_id: string | null;
  walk_in_guest_id?: string | null;
  reference_number: string;
  start_datetime: string;
  end_datetime: string;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "reschedule_requested";
}

interface GuestEmailRow {
  email: string;
  first_name: string | null;
  last_name: string | null;
}

const parsePayload = (value: unknown): CancelReservationPayload | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const payload = value as Partial<CancelReservationPayload>;

  if (typeof payload.reservationId !== "string" || !payload.reservationId.trim()) {
    return null;
  }

  if (
    typeof payload.cancellationReason !== "string" ||
    !cancellationReasons.includes(payload.cancellationReason as CancellationReason)
  ) {
    return null;
  }

  return {
    reservationId: payload.reservationId.trim(),
    cancellationReason: payload.cancellationReason as CancellationReason,
  };
};

export async function POST(request: Request) {
  try {
    const staffContext = await requireActiveStaff();

    if (!staffContext) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized.",
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    const payload = parsePayload(body);

    if (!payload) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid cancellation payload.",
        },
        { status: 400 }
      );
    }

    const { data: reservation, error: reservationError } = await staffContext.supabase
      .from("reservations")
      .select("reservation_id, guest_id, walk_in_guest_id, reference_number, start_datetime, end_datetime, status")
      .eq("reservation_id", payload.reservationId)
      .maybeSingle<ReservationRow>();

    if (reservationError || !reservation) {
      return NextResponse.json(
        {
          success: false,
          message: "Reservation not found.",
        },
        { status: 404 }
      );
    }

    if (reservation.status === "cancelled") {
      return NextResponse.json(
        {
          success: false,
          message: "Reservation is already cancelled.",
        },
        { status: 400 }
      );
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

    const { data: refundId, error: cancelError } = await staffContext.supabase.rpc("cancel_reservation_with_refund", {
      p_reservation: reservation.reservation_id,
      p_reason: payload.cancellationReason,
      p_admin: true,
    });

    if (cancelError) {
      return NextResponse.json(
        {
          success: false,
          message: cancelError.message,
        },
        { status: 500 }
      );
    }

    let emailSent = false;

    const guestLookup = reservation.guest_id
      ? staffContext.supabase
          .from("guests")
          .select("email, first_name, last_name")
          .eq("id", reservation.guest_id)
          .maybeSingle<GuestEmailRow>()
      : reservation.walk_in_guest_id
        ? staffContext.supabase
            .from("walk_in_guests")
            .select("email, first_name, last_name")
            .eq("walk_in_guest_id", reservation.walk_in_guest_id)
            .maybeSingle<GuestEmailRow>()
        : Promise.resolve({ data: null, error: null });

    const { data: guest, error: guestLookupError } = await guestLookup;

    if (guestLookupError) {
      console.error("Failed to read guest email for cancellation notice.", guestLookupError);
    } else if (guest?.email) {
      emailSent = await sendReservationCancelledEmail({
        guestEmail: guest.email,
        guestName: `${guest.first_name ?? ""} ${guest.last_name ?? ""}`.replace(/\s+/g, " ").trim() || "Guest",
        reservationReference: reservation.reference_number,
        checkInDate: reservation.start_datetime,
        checkOutDate: reservation.end_datetime,
        cancellationReason: payload.cancellationReason,
      });
    }

    if (reservation.guest_id) {
      const { error: notificationError } = await createNotifications({
        actorId: staffContext.staffUser.id,
        guestId: reservation.guest_id,
        title: "Reservation cancelled",
        message: `Reservation ${reservation.reference_number} was cancelled.`,
        entityType: "reservation",
        entityId: reservation.reservation_id,
        guestActionUrl: "/manage",
      });
      if (notificationError) console.warn("Failed to notify guest of reservation cancellation:", notificationError);
    }

    if (refundId) {
      const { error: refundNoticeError } = await createNotifications({
        actorId: staffContext.staffUser.id, guestId: reservation.guest_id,
        staffRoles: ["admin", "cashier"], title: "Refund request pending",
        message: `A refund request for reservation ${reservation.reference_number} is awaiting review.`,
        entityType: "refund_request", entityId: refundId,
        guestActionUrl: "/manage", staffActionUrl: "/admin/transactions",
      });
      if (refundNoticeError) console.warn("Failed to create refund notifications:", refundNoticeError);
    }

    return NextResponse.json(
      {
        success: true,
        reservationId: reservation.reservation_id,
        status: "cancelled",
        cancellationReason: payload.cancellationReason,
        refundId,
        message: emailSent
          ? "Reservation cancelled successfully and cancellation email sent."
          : "Reservation cancelled successfully. Email delivery could not be confirmed.",
        emailSent,
      },
      { status: 200 }
    );
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
