import { NextResponse } from "next/server";
import { createAuditLog, requireActiveStaff } from "@/lib/server/admin-audit";
import { computeBookingPricing } from "@/lib/booking/pricing";
import { validateBookingWindow, type BookingMode, type WholeDayVariant } from "@/lib/booking/policy";

interface ManualReservationPayload {
  guestEmail?: string;
  guestId?: string;
  bookingMode: BookingMode;
  startDatetime: string;
  endDatetime: string;
  wholeDayVariant?: WholeDayVariant | null;
  customStartTime?: string | null;
  customEndTime?: string | null;
  adultCount: number;
  childCount: number;
  unitId: string;
  specialRequests?: string;
}

interface GuestRow {
  id: string;
  email: string;
}

interface UnitRow {
  unit_id: string;
  base_price: number;
  is_active: boolean;
  archived_at: string | null;
}

const isValidDate = (value: string) => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
};

const parsePayload = (value: unknown): ManualReservationPayload | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Partial<ManualReservationPayload>;

  if (
    (payload.bookingMode !== "day" && payload.bookingMode !== "night" && payload.bookingMode !== "whole_day" && payload.bookingMode !== "custom") ||
    typeof payload.startDatetime !== "string" ||
    typeof payload.endDatetime !== "string" ||
    typeof payload.unitId !== "string" ||
    typeof payload.adultCount !== "number" ||
    typeof payload.childCount !== "number"
  ) {
    return null;
  }

  if (!payload.guestEmail && !payload.guestId) {
    return null;
  }

  if (!isValidDate(payload.startDatetime) || !isValidDate(payload.endDatetime)) {
    return null;
  }

  if (!Number.isInteger(payload.adultCount) || payload.adultCount <= 0) {
    return null;
  }

  if (!Number.isInteger(payload.childCount) || payload.childCount < 0) {
    return null;
  }

  return {
    guestEmail: typeof payload.guestEmail === "string" ? payload.guestEmail.trim() : undefined,
    guestId: typeof payload.guestId === "string" ? payload.guestId.trim() : undefined,
    bookingMode: payload.bookingMode,
    startDatetime: payload.startDatetime,
    endDatetime: payload.endDatetime,
    wholeDayVariant:
      payload.wholeDayVariant === "day_to_night" || payload.wholeDayVariant === "night_to_day"
        ? payload.wholeDayVariant
        : null,
    customStartTime: typeof payload.customStartTime === "string" ? payload.customStartTime : null,
    customEndTime: typeof payload.customEndTime === "string" ? payload.customEndTime : null,
    adultCount: payload.adultCount,
    childCount: payload.childCount,
    unitId: payload.unitId.trim(),
    specialRequests: typeof payload.specialRequests === "string" ? payload.specialRequests.trim() : "",
  };
};

type StaffContext = NonNullable<Awaited<ReturnType<typeof requireActiveStaff>>>;

const generateReferenceNumber = async (supabase: StaffContext["supabase"]) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `MB-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

    const { data } = await supabase
      .from("reservations")
      .select("reservation_id")
      .eq("reference_number", candidate)
      .maybeSingle();

    if (!data) {
      return candidate;
    }
  }

  return null;
};

export async function POST(request: Request) {
  try {
    const staffContext = await requireActiveStaff();

    if (!staffContext) {
      return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json();
    const payload = parsePayload(body);

    if (!payload) {
      return NextResponse.json({ success: false, message: "Invalid request payload." }, { status: 400 });
    }

    const bookingValidation = validateBookingWindow({
      bookingMode: payload.bookingMode,
      startDatetime: payload.startDatetime,
      endDatetime: payload.endDatetime,
      wholeDayVariant: payload.wholeDayVariant,
      customStartTime: payload.customStartTime,
      customEndTime: payload.customEndTime,
    });

    if (!bookingValidation.valid) {
      return NextResponse.json(
        {
          success: false,
          message: bookingValidation.message || "Invalid booking window.",
        },
        { status: 400 }
      );
    }

    const guestLookup = payload.guestId
      ? staffContext.supabase.from("guests").select("id, email").eq("id", payload.guestId).maybeSingle<GuestRow>()
      : staffContext.supabase
          .from("guests")
          .select("id, email")
          .eq("email", payload.guestEmail ?? "")
          .maybeSingle<GuestRow>();

    const [{ data: guest, error: guestError }, { data: unit, error: unitError }, { data: overlappingReservation, error: overlapError }] = await Promise.all([
      guestLookup,
      staffContext.supabase
        .from("units")
        .select("unit_id, base_price, is_active, archived_at")
        .eq("unit_id", payload.unitId)
        .maybeSingle<UnitRow>(),
      staffContext.supabase
        .from("reservations")
        .select("reservation_id")
        .in("status", ["pending", "confirmed"])
        .lt("start_datetime", payload.endDatetime)
        .gt("end_datetime", payload.startDatetime)
        .limit(1)
        .maybeSingle(),
    ]);

    if (guestError || !guest) {
      return NextResponse.json(
        {
          success: false,
          message: "Guest profile not found. Please register the guest before creating a manual reservation.",
        },
        { status: 404 }
      );
    }

    if (unitError || !unit || !unit.is_active || unit.archived_at) {
      return NextResponse.json({ success: false, message: "Selected unit is not available." }, { status: 400 });
    }

    if (overlapError) {
      return NextResponse.json(
        { success: false, message: "Unable to validate reservation overlaps." },
        { status: 500 }
      );
    }

    if (overlappingReservation) {
      return NextResponse.json(
        { success: false, message: "The selected schedule overlaps with an existing reservation." },
        { status: 409 }
      );
    }

    const reservationReference = await generateReferenceNumber(staffContext.supabase);

    if (!reservationReference) {
      return NextResponse.json(
        { success: false, message: "Unable to generate reservation reference number." },
        { status: 500 }
      );
    }

    const servicesTotal = 0;
    const pricing = computeBookingPricing({
      bookingMode: payload.bookingMode,
      startDatetime: payload.startDatetime,
      endDatetime: payload.endDatetime,
      adultCount: payload.adultCount,
      childCount: payload.childCount,
      servicesTotal,
    });

    const { data: reservation, error: reservationError } = await staffContext.supabase
      .from("reservations")
      .insert({
        guest_id: guest.id,
        reference_number: reservationReference,
        booking_mode: payload.bookingMode,
        start_datetime: payload.startDatetime,
        end_datetime: payload.endDatetime,
        adult_count: payload.adultCount,
        child_count: payload.childCount,
        special_requests: payload.specialRequests || null,
        booking_type: "walk_in",
        status: "pending",
      })
      .select("reservation_id, reference_number, status")
      .single();

    if (reservationError || !reservation) {
      return NextResponse.json(
        { success: false, message: "Failed to create manual reservation." },
        { status: 500 }
      );
    }

    const { error: reservationUnitError } = await staffContext.supabase.from("reservation_units").insert({
      reservation_id: reservation.reservation_id,
      unit_id: unit.unit_id,
      quantity: 1,
      price_per_night: unit.base_price,
    });

    if (reservationUnitError) {
      await staffContext.supabase.from("reservations").delete().eq("reservation_id", reservation.reservation_id);
      return NextResponse.json(
        { success: false, message: "Failed to attach selected unit." },
        { status: 500 }
      );
    }

    const { error: seedTransactionError } = await staffContext.supabase.from("transactions").upsert(
      {
        reservation_id: reservation.reservation_id,
        total_amount: pricing.total,
        status: "unpaid",
      },
      {
        onConflict: "reservation_id",
      }
    );

    if (seedTransactionError) {
      await staffContext.supabase.from("reservations").delete().eq("reservation_id", reservation.reservation_id);
      return NextResponse.json(
        { success: false, message: "Failed to initialize transaction total." },
        { status: 500 }
      );
    }

    const auditSuccess = await createAuditLog(staffContext, {
      action: "Created manual reservation",
      entityType: "reservation",
      entityId: reservation.reservation_id,
    });

    if (!auditSuccess) {
      return NextResponse.json(
        { success: false, message: "Manual reservation created but audit logging failed." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        reservation: {
          id: reservation.reservation_id,
          referenceNumber: reservation.reference_number,
          status: reservation.status,
          totalAmount: pricing.total,
          bookingType: "walk_in",
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? `Unexpected error while creating manual reservation. ${error.message}`
            : "Unexpected error while creating manual reservation.",
      },
      { status: 500 }
    );
  }
}