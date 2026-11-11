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
  expectedAdditional?: number;
  rescheduleReason: string;
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
    | "no_show"
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
  if (payload.expectedAdditional !== undefined && (typeof payload.expectedAdditional !== "number"
    || !Number.isFinite(payload.expectedAdditional) || payload.expectedAdditional < 0)) return null;

  return {
    reservationId: payload.reservationId.trim(),
    newStartDatetime: payload.newStartDatetime,
    newEndDatetime: payload.newEndDatetime,
    expectedAdditional: payload.expectedAdditional,
    rescheduleReason: typeof payload.rescheduleReason === "string" ? payload.rescheduleReason.trim() : "",
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
    if (payload.rescheduleReason.length < 5 || typeof body.rescheduleReason !== "string" || body.rescheduleReason.length > 2000) {
      return NextResponse.json({ success: false, message: "Enter a reschedule reason between 5 and 2,000 characters." }, { status: 400 });
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
    if (reservation.checked_in_at || ["cancelled", "completed", "no_show"].includes(reservation.status)) {
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
    if (payload.expectedAdditional !== undefined && Math.abs(payload.expectedAdditional - charges.totalAdditional) > 0.001) {
      return NextResponse.json({ success: false, message: "Reschedule charges changed. Review the updated fee before saving." }, { status: 409 });
    }

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

    const { data: result, error: saveError } = await adminSupabase.rpc("reschedule_guest_reservation", {
      p_reservation: reservation.reservation_id,
      p_guest: user.id,
      p_expected: {
        startDatetime: reservation.start_datetime, endDatetime: reservation.end_datetime,
        adultCount: reservation.adult_count, childCount: reservation.child_count,
        bookingMode: reservation.booking_mode, packageRateVersion: reservation.package_rate_version,
      },
      p_new_start: payload.newStartDatetime,
      p_new_end: payload.newEndDatetime,
      p_notice_fee: charges.noticeFee,
      p_rate_adjustment: charges.rateAdjustment,
      p_reason: payload.rescheduleReason,
    });
    if (saveError) {
      const missing = ["PGRST202", "42883"].includes(saveError.code);
      const status = missing ? 503 : ["40001", "23P01", "23505", "40P01"].includes(saveError.code) ? 409
        : saveError.code === "42501" ? 403 : saveError.code === "22023" ? 400 : 500;
      return NextResponse.json({ success: false, message: missing
        ? "Automatic rescheduling needs docs/guest-auto-reschedule-migration.sql. Contact the resort administrator."
        : status === 500 ? "Unable to reschedule this reservation. Please retry." : saveError.message }, { status });
    }
    if (!result) return NextResponse.json({ success: false, message: "Unable to confirm the saved reschedule." }, { status: 500 });

    try {
      const { error: notificationError } = await createNotifications({
        actorId: user.id, guestId: reservation.guest_id,
        staffRoles: NOTIFICATION_AUDIENCES.reservation,
        title: "Reservation rescheduled",
        message: `Reservation ${reservation.reference_number} was automatically rescheduled. Additional charge: PHP ${Number(result.totalAdditional).toFixed(2)}. Remaining balance: PHP ${Number(result.remainingBalance).toFixed(2)}.`,
        entityType: "reservation_reschedule", entityId: reservation.reservation_id,
        guestActionUrl: "/manage", staffActionUrl: "/admin/reservations",
      });
      if (notificationError) console.warn("Failed to create reschedule notifications:", notificationError);
    } catch (notificationError) { console.warn("Reschedule saved but notification failed:", notificationError); }
    return NextResponse.json({ success: true, ...result, message: "Reservation rescheduled and automatically approved. The additional charge has been added to your bill." });
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
