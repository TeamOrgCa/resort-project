import { NextResponse } from "next/server";
import { createAuditLog, requireActiveStaff } from "@/lib/server/admin-audit";
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
  guest_id: string;
  reference_number: string;
  check_in_date: string;
  check_out_date: string;
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
      .select("reservation_id, guest_id, reference_number, check_in_date, check_out_date, status")
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

    const { error: cancelError } = await staffContext.supabase
      .from("reservations")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: payload.cancellationReason,
      })
      .eq("reservation_id", reservation.reservation_id);

    if (cancelError) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to cancel reservation.",
        },
        { status: 500 }
      );
    }

    const auditSuccess = await createAuditLog(staffContext, {
      action: `Cancelled reservation (cancellation_reason: ${payload.cancellationReason})`,
      entityType: "reservation",
      entityId: reservation.reservation_id,
    });

    if (!auditSuccess) {
      return NextResponse.json(
        {
          success: false,
          message: "Reservation cancelled but audit logging failed.",
        },
        { status: 500 }
      );
    }

    let emailSent = false;

    const { data: guest, error: guestLookupError } = await staffContext.supabase
      .from("guests")
      .select("email, first_name, last_name")
      .eq("id", reservation.guest_id)
      .maybeSingle<GuestEmailRow>();

    if (guestLookupError) {
      console.error("Failed to read guest email for cancellation notice.", guestLookupError);
    } else if (guest?.email) {
      emailSent = await sendReservationCancelledEmail({
        guestEmail: guest.email,
        guestName: `${guest.first_name ?? ""} ${guest.last_name ?? ""}`.replace(/\s+/g, " ").trim() || "Guest",
        reservationReference: reservation.reference_number,
        checkInDate: reservation.check_in_date,
        checkOutDate: reservation.check_out_date,
        cancellationReason: payload.cancellationReason,
      });
    }

    return NextResponse.json(
      {
        success: true,
        reservationId: reservation.reservation_id,
        status: "cancelled",
        cancellationReason: payload.cancellationReason,
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
