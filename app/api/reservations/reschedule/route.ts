import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface ReschedulePayload {
  reservationId: string;
  newStartDatetime: string;
  newEndDatetime: string;
}

interface ReservationRow {
  reservation_id: string;
  guest_id: string;
  start_datetime: string;
  end_datetime: string;
  status:
    | "pending"
    | "confirmed"
    | "cancelled"
    | "completed"
    | "reschedule_requested";
}

const DAY_MS = 24 * 60 * 60 * 1000;
const calculateRescheduleFee = (startDatetime: string) => {
  const start = new Date(startDatetime);

  if (Number.isNaN(start.getTime())) {
    return 500;
  }

  const daysUntilStart = (start.getTime() - Date.now()) / DAY_MS;

  if (daysUntilStart >= 6) {
    return 50;
  }

  if (daysUntilStart >= 3) {
    return 100;
  }

  if (daysUntilStart >= 1) {
    return 300;
  }

  return 500;
};

/* -----------------------------
   VALIDATE PAYLOAD
------------------------------*/
const parsePayload = (value: unknown): ReschedulePayload | null => {
  if (!value || typeof value !== "object") return null;

  const payload = value as Partial<ReschedulePayload>;

  if (
    typeof payload.reservationId !== "string" ||
    typeof payload.newStartDatetime !== "string" ||
    typeof payload.newEndDatetime !== "string"
  ) {
    return null;
  }

  const start = new Date(payload.newStartDatetime);
  const end = new Date(payload.newEndDatetime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  return {
    reservationId: payload.reservationId.trim(),
    newStartDatetime: payload.newStartDatetime,
    newEndDatetime: payload.newEndDatetime,
  };
};

/* -----------------------------
   MAIN HANDLER
------------------------------*/
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = parsePayload(body);

    if (!payload) {
      return NextResponse.json(
        { success: false, message: "Invalid reschedule payload." },
        { status: 400 }
      );
    }

    const newStart = new Date(payload.newStartDatetime);
    const newEnd = new Date(payload.newEndDatetime);

    if (newEnd.getTime() <= newStart.getTime()) {
      return NextResponse.json(
        { success: false, message: "End datetime must be after start datetime." },
        { status: 400 }
      );
    }

    if (newStart.getTime() < new Date().setHours(0, 0, 0, 0)) {
      return NextResponse.json(
        { success: false, message: "Reschedule must be in the future." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    /* -----------------------------
       AUTH CHECK
    ------------------------------*/
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, message: "You must be logged in." },
        { status: 401 }
      );
    }

    /* -----------------------------
       FETCH RESERVATION
    ------------------------------*/
    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select(
        "reservation_id, guest_id, start_datetime, end_datetime, status"
      )
      .eq("reservation_id", payload.reservationId)
      .maybeSingle<ReservationRow>();

    if (reservationError || !reservation) {
      return NextResponse.json(
        { success: false, message: "Reservation not found." },
        { status: 404 }
      );
    }

    /* -----------------------------
       OWNERSHIP CHECK
    ------------------------------*/
    if (reservation.guest_id !== user.id) {
      return NextResponse.json(
        { success: false, message: "Not your reservation." },
        { status: 403 }
      );
    }

    /* -----------------------------
       STATUS CHECK
    ------------------------------*/
    if (["cancelled", "completed"].includes(reservation.status)) {
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
          message: "A reschedule request is already pending.",
        },
        { status: 400 }
      );
    }

    /* -----------------------------
       CHECK EXISTING PENDING REQUEST
    ------------------------------*/
    const { data: pendingRequest, error: pendingError } = await supabase
      .from("reservation_reschedules")
      .select("reschedule_id")
      .eq("reservation_id", reservation.reservation_id)
      .eq("status", "pending")
      .maybeSingle();

    if (pendingError) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to validate existing requests.",
        },
        { status: 500 }
      );
    }

    if (pendingRequest) {
      return NextResponse.json(
        {
          success: false,
          message: "Pending reschedule already exists.",
        },
        { status: 400 }
      );
    }

    /* -----------------------------
       INSERT RESCHEDULE REQUEST
    ------------------------------*/
    const { error: insertError } = await supabase
      .from("reservation_reschedules")
      .insert({
        reservation_id: reservation.reservation_id,
        requested_by: user.id,

        old_start: reservation.start_datetime,
        old_end: reservation.end_datetime,

        new_start: payload.newStartDatetime,
        new_end: payload.newEndDatetime,

        reschedule_fee: calculateRescheduleFee(reservation.start_datetime),

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

    /* -----------------------------
       UPDATE RESERVATION STATUS
    ------------------------------*/
    const { error: updateError } = await supabase
      .from("reservations")
      .update({ status: "reschedule_requested" })
      .eq("reservation_id", reservation.reservation_id);

    if (updateError) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Request created but reservation status update failed.",
        },
        { status: 500 }
      );
    }

    /* -----------------------------
       SUCCESS RESPONSE
    ------------------------------*/
    return NextResponse.json(
      {
        success: true,
        reservationId: reservation.reservation_id,
        status: "reschedule_requested",
        rescheduleFee: calculateRescheduleFee(reservation.start_datetime),
        message: "Reschedule request submitted successfully.",
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected server error.",
      },
      { status: 500 }
    );
  }
}