import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface CancelPayload {
  reservationId: string;
  acceptedNoRefundPolicy: boolean;
}

interface ReservationCancelRow {
  reservation_id: string;
  guest_id: string;
  reference_number: string;
  check_in_date: string;
  status: "pending" | "confirmed" | "cancelled" | "completed";
}

const MIN_CANCELLATION_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

const parsePayload = (value: unknown): CancelPayload | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Partial<CancelPayload>;

  if (typeof payload.reservationId !== "string" || typeof payload.acceptedNoRefundPolicy !== "boolean") {
    return null;
  }

  return {
    reservationId: payload.reservationId,
    acceptedNoRefundPolicy: payload.acceptedNoRefundPolicy,
  };
};

const hasTwoDayLeadTime = (checkInDate: string) => {
  const checkIn = new Date(`${checkInDate}T00:00:00`);
  if (Number.isNaN(checkIn.getTime())) {
    return false;
  }

  const now = new Date();
  const diffDays = (checkIn.getTime() - now.getTime()) / DAY_MS;
  return diffDays >= MIN_CANCELLATION_DAYS;
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

    if (!payload.acceptedNoRefundPolicy) {
      return NextResponse.json(
        {
          success: false,
          message: "You must agree to the no-refund cancellation terms.",
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
      .select("reservation_id, guest_id, reference_number, check_in_date, status")
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

    if (reservation.status === "completed") {
      return NextResponse.json(
        {
          success: false,
          message: "Completed reservations can no longer be cancelled.",
        },
        { status: 400 }
      );
    }

    if (!hasTwoDayLeadTime(reservation.check_in_date)) {
      return NextResponse.json(
        {
          success: false,
          message: "Cancellation is only allowed at least 2 days before check-in.",
        },
        { status: 400 }
      );
    }

    const { error: updateError } = await supabase
      .from("reservations")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: "Guest cancellation (no-refund policy accepted).",
      })
      .eq("reservation_id", reservation.reservation_id)
      .eq("guest_id", user.id);

    if (updateError) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to cancel reservation.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      reservationId: reservation.reservation_id,
      referenceNumber: reservation.reference_number,
      message: "Reservation cancelled successfully.",
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
