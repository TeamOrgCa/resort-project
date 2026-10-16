import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotifications, NOTIFICATION_AUDIENCES } from "@/lib/notifications";
import { checkReservationOverlap } from "@/lib/server/reservation-availability";
import { BOOKING_LEAD_MESSAGE, isBookingStartAllowed } from "@/lib/booking/start-time";
import { calculateRescheduleCharges } from "@/lib/booking/reschedule-charges";
import type { BookingMode } from "@/lib/booking/policy";
import { loadPackageRates, PackageRatesError } from "@/lib/server/package-rates";

interface ReschedulePayload {
  reservationId: string;
  newStartDatetime: string;
  newEndDatetime: string;
}

interface ReservationRow {
  package_rate_version: number | null;
  checked_in_at?: string | null;
  reservation_id: string;
  guest_id: string;
  reference_number: string;
  start_datetime: string;
  end_datetime: string;
  booking_mode: BookingMode | null;
  adult_count: number;
  child_count: number;
  status:
    | "pending"
    | "confirmed"
    | "cancelled"
    | "completed"
    | "reschedule_requested";
}

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
    const body = await request.json().catch(() => null);
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

    if (!isBookingStartAllowed(newStart)) {
      return NextResponse.json(
        { success: false, message: BOOKING_LEAD_MESSAGE },
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
      .select("reservation_id, guest_id, reference_number, start_datetime, end_datetime, booking_mode, adult_count, child_count, status, package_rate_version, checked_in_at")
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

    const adminSupabase = createAdminClient();

    /* -----------------------------
       STATUS CHECK
    ------------------------------*/
    if (reservation.checked_in_at || ["cancelled", "completed"].includes(reservation.status)) {
      return NextResponse.json(
        {
          success: false,
          message: reservation.checked_in_at ? "Checked-in reservations cannot be rescheduled." : "This reservation can no longer be rescheduled.",
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
    const { data: pendingRequest, error: pendingError } = await adminSupabase
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

    if (reservation.status !== "confirmed") {
      return NextResponse.json({ success: false, message: "Payment must be approved before rescheduling this reservation." }, { status: 400 });
    }

    if (
      newStart.getTime() === new Date(reservation.start_datetime).getTime() &&
      newEnd.getTime() === new Date(reservation.end_datetime).getTime()
    ) {
      return NextResponse.json(
        { success: false, message: "Choose a different schedule from your current reservation." },
        { status: 400 }
      );
    }

    const originalDuration = new Date(reservation.end_datetime).getTime() - new Date(reservation.start_datetime).getTime();
    if (!reservation.booking_mode || newEnd.getTime() - newStart.getTime() !== originalDuration ||
      (newStart.getTime() - new Date(reservation.start_datetime).getTime()) % 86_400_000 !== 0) {
      return NextResponse.json({ success: false, message: "Keep the original booking duration and package when rescheduling." }, { status: 400 });
    }

    if (!reservation.package_rate_version) return NextResponse.json({ success: false, message: "This reservation needs its package rate history configured. Please contact the resort." }, { status: 503 });
    const packageSchedule = await loadPackageRates(adminSupabase, reservation.package_rate_version);
    const charges = calculateRescheduleCharges({
      rates: packageSchedule.rates,
      originalStart: reservation.start_datetime,
      originalEnd: reservation.end_datetime,
      newStart: payload.newStartDatetime,
      newEnd: payload.newEndDatetime,
      bookingMode: reservation.booking_mode,
      adultCount: reservation.adult_count,
      childCount: reservation.child_count,
    });

    const { conflict, error: overlapError } = await checkReservationOverlap(
      payload.newStartDatetime,
      payload.newEndDatetime,
      reservation.guest_id,
      reservation.reservation_id
    );
    if (overlapError) {
      return NextResponse.json(
        { success: false, message: "Unable to check the requested schedule." },
        { status: 500 }
      );
    }
    if (conflict) {
      return NextResponse.json(
        { success: false, message: "The requested date has already been reserved." },
        { status: 409 }
      );
    }

    /* -----------------------------
       INSERT RESCHEDULE REQUEST
    ------------------------------*/
    const { data: insertedRequest, error: insertError } = await adminSupabase
      .from("reservation_reschedules")
      .insert({
        reservation_id: reservation.reservation_id,
        requested_by: user.id,

        old_start: reservation.start_datetime,
        old_end: reservation.end_datetime,

        new_start: payload.newStartDatetime,
        new_end: payload.newEndDatetime,

        reschedule_fee: charges.noticeFee,
        rate_adjustment: charges.rateAdjustment,

        status: "pending",
      })
      .select("reschedule_id")
      .single<{ reschedule_id: string }>();

    if (insertError) {
      if (insertError.code === "22023" && /Rescheduling requires .* days notice/i.test(insertError.message)) {
        return NextResponse.json({ success: false, message: "Guest reschedule requests are not yet configured. Ask the administrator to apply docs/guest-reschedule-requests-migration.sql, then retry." }, { status: 503 });
      }
      const status = ["40001", "23P01", "23505"].includes(insertError.code) ? 409 : insertError.code === "42501" ? 403 : insertError.code === "22023" ? 400 : 500;
      return NextResponse.json(
        {
          success: false,
          message: status === 500 ? "Failed to create reschedule request. Please retry." : insertError.message,
        },
        { status }
      );
    }

    /* -----------------------------
       UPDATE RESERVATION STATUS
    ------------------------------*/
    const { data: updatedReservation, error: updateError } = await adminSupabase
      .from("reservations")
      .update({ status: "reschedule_requested" })
      .eq("reservation_id", reservation.reservation_id)
      .eq("status", "confirmed")
      .eq("start_datetime", reservation.start_datetime)
      .eq("end_datetime", reservation.end_datetime)
      .select("reservation_id")
      .maybeSingle();

    if (updateError || !updatedReservation) {
      if (insertedRequest) {
        await adminSupabase
          .from("reservation_reschedules")
          .delete()
          .eq("reschedule_id", insertedRequest.reschedule_id)
          .eq("status", "pending");
      }

      return NextResponse.json(
        {
          success: false,
          message:
            "This reservation changed while you were requesting a new date. Refresh Manage Booking before trying again.",
        },
        { status: 409 }
      );
    }

    try {
      const { error: notificationError } = await createNotifications({
        actorId: user.id,
        guestId: reservation.guest_id,
        staffRoles: NOTIFICATION_AUDIENCES.reservation,
        title: "Reschedule requested",
        message: `Reschedule request submitted for reservation ${reservation.reference_number}.`,
        entityType: "reservation_reschedule",
        entityId: reservation.reservation_id,
        guestActionUrl: "/manage",
        staffActionUrl: "/admin/reservations",
      });

      if (notificationError) console.warn("Failed to create reschedule notifications:", notificationError);
    } catch (notificationError) { console.warn("Reschedule request saved but notification failed:", notificationError); }

    /* -----------------------------
       SUCCESS RESPONSE
    ------------------------------*/
    return NextResponse.json(
      {
        success: true,
        reservationId: reservation.reservation_id,
        status: "reschedule_requested",
        rescheduleFee: charges.noticeFee,
        rateAdjustment: charges.rateAdjustment,
        totalAdditional: charges.totalAdditional,
        message: "Reschedule request submitted successfully.",
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof PackageRatesError) return NextResponse.json({ success: false, message: error.message }, { status: error.status });
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected server error.",
      },
      { status: 500 }
    );
  }
}
