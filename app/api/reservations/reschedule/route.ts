import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface ReschedulePayload {
  reservationId: string;
  newCheckInDate: string;
  newCheckOutDate: string;
}

interface ReservationRow {
  reservation_id: string;
  guest_id: string;
  check_in_date: string;
  check_out_date: string;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "reschedule_requested";
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_RESCHEDULE_DAYS = 2;

const parsePayload = (value: unknown): ReschedulePayload | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Partial<ReschedulePayload>;

  if (
    typeof payload.reservationId !== "string" ||
    !payload.reservationId.trim() ||
    typeof payload.newCheckInDate !== "string" ||
    typeof payload.newCheckOutDate !== "string"
  ) {
    return null;
  }

  const newCheckIn = new Date(payload.newCheckInDate);
  const newCheckOut = new Date(payload.newCheckOutDate);

  if (Number.isNaN(newCheckIn.getTime()) || Number.isNaN(newCheckOut.getTime())) {
    return null;
  }

  return {
    reservationId: payload.reservationId.trim(),
    newCheckInDate: payload.newCheckInDate,
    newCheckOutDate: payload.newCheckOutDate,
  };
};

const hasLeadTime = (checkInDate: string) => {
  const checkIn = new Date(`${checkInDate}T00:00:00`);
  if (Number.isNaN(checkIn.getTime())) {
    return false;
  }

  const now = new Date();
  return (checkIn.getTime() - now.getTime()) / DAY_MS >= MIN_RESCHEDULE_DAYS;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = parsePayload(body);

    if (!payload) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid reschedule payload.",
        },
        { status: 400 }
      );
    }

    const newCheckIn = new Date(payload.newCheckInDate);
    const newCheckOut = new Date(payload.newCheckOutDate);

    if (newCheckOut.getTime() <= newCheckIn.getTime()) {
      return NextResponse.json(
        {
          success: false,
          message: "Check-out date must be after check-in date.",
        },
        { status: 400 }
      );
    }

    if (newCheckIn.getTime() < new Date().setHours(0, 0, 0, 0)) {
      return NextResponse.json(
        {
          success: false,
          message: "Reschedule dates must be in the future.",
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
          message: "You must be logged in to request a reschedule.",
        },
        { status: 401 }
      );
    }

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("reservation_id, guest_id, check_in_date, check_out_date, status")
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

    if (reservation.guest_id !== user.id) {
      return NextResponse.json(
        {
          success: false,
          message: "You can only request a reschedule for your own reservation.",
        },
        { status: 403 }
      );
    }

    if (reservation.status === "cancelled" || reservation.status === "completed") {
      return NextResponse.json(
        {
          success: false,
          message: "This reservation can no longer be rescheduled.",
        },
        { status: 400 }
      );
    }

    if (reservation.status === "reschedule_requested") {
      return NextResponse.json(
        {
          success: false,
          message: "A reschedule request is already pending for this reservation.",
        },
        { status: 400 }
      );
    }

    // if (!hasLeadTime(reservation.check_in_date)) {
    //   return NextResponse.json(
    //     {
    //       success: false,
    //       message: "Reschedule requests must be submitted at least 2 days before check-in.",
    //     },
    //     { status: 400 }
    //   );
    // }

    const { data: pendingRequest, error: pendingRequestError } = await supabase
      .from("reservation_reschedules")
      .select("reschedule_id")
      .eq("reservation_id", reservation.reservation_id)
      .eq("status", "pending")
      .maybeSingle();

    if (pendingRequestError) {
      return NextResponse.json(
        {
          success: false,
          message: "Unable to validate existing reschedule requests.",
        },
        { status: 500 }
      );
    }

    if (pendingRequest) {
      return NextResponse.json(
        {
          success: false,
          message: "A pending reschedule request already exists for this reservation.",
        },
        { status: 400 }
      );
    }

    const { error: insertError } = await supabase.from("reservation_reschedules").insert({
      reservation_id: reservation.reservation_id,
      requested_by: user.id,
      old_check_in: reservation.check_in_date,
      old_check_out: reservation.check_out_date,
      new_check_in: payload.newCheckInDate,
      new_check_out: payload.newCheckOutDate,
      status: "pending",
    });

    if (insertError) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to create reschedule request.",
        },
        { status: 500 }
      );
    }

    const { error: updateError } = await supabase
      .from("reservations")
      .update({ status: "reschedule_requested" })
      .eq("reservation_id", reservation.reservation_id)
      .eq("guest_id", user.id);

    if (updateError) {
      return NextResponse.json(
        {
          success: false,
          message: "Reschedule request was created but reservation status could not be updated.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        reservationId: reservation.reservation_id,
        status: "reschedule_requested",
        message: "Reschedule request submitted successfully.",
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while submitting reschedule request.",
      },
      { status: 500 }
    );
  }
}