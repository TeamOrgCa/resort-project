import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type DbErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

interface ServiceSelectionInput {
  serviceId: string;
  quantity?: number;
}

interface CreateReservationPayload {
  checkInDate: string;
  checkOutDate: string;
  adultCount: number;
  childCount: number;
  unitId: string;
  specialRequests?: string;
  selectedServices?: ServiceSelectionInput[];
}

interface UnitRow {
  unit_id: string;
  base_price: number;
  is_active: boolean;
  archived_at: string | null;
}

interface ServiceRow {
  service_id: string;
  price: number;
  is_active: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ADULT_RATE_PER_NIGHT = 150;
const CHILD_RATE_PER_NIGHT = 120;
const TAX_RATE = 0.12;

const toDbError = (error: unknown): DbErrorLike => {
  if (typeof error === "object" && error !== null) {
    return error as DbErrorLike;
  }
  return {};
};

const formatDbError = (error: unknown, fallback: string) => {
  const dbError = toDbError(error);
  const parts = [dbError.message, dbError.details, dbError.hint].filter(Boolean);
  if (!parts.length) {
    return fallback;
  }
  return `${fallback} (${parts.join(" | ")})`;
};

const buildDbFailurePayload = (error: unknown, fallback: string) => {
  const dbError = toDbError(error);

  return {
    success: false,
    message: formatDbError(error, fallback),
    errorCode: dbError.code ?? null,
    errorDetails: dbError.details ?? null,
    errorHint: dbError.hint ?? null,
  };
};

const isValidDate = (value: string) => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
};

const parsePayload = (value: unknown): CreateReservationPayload | null => {
  if (!value || typeof value !== "object") return null;

  const payload = value as Partial<CreateReservationPayload>;

  if (
    typeof payload.checkInDate !== "string" ||
    typeof payload.checkOutDate !== "string" ||
    typeof payload.unitId !== "string" ||
    typeof payload.adultCount !== "number" ||
    typeof payload.childCount !== "number"
  ) {
    return null;
  }

  if (!isValidDate(payload.checkInDate) || !isValidDate(payload.checkOutDate)) {
    return null;
  }

  if (!Number.isInteger(payload.adultCount) || payload.adultCount <= 0) {
    return null;
  }

  if (!Number.isInteger(payload.childCount) || payload.childCount < 0) {
    return null;
  }

  return {
    checkInDate: payload.checkInDate,
    checkOutDate: payload.checkOutDate,
    adultCount: payload.adultCount,
    childCount: payload.childCount,
    unitId: payload.unitId,
    specialRequests: typeof payload.specialRequests === "string" ? payload.specialRequests.trim() : "",
    selectedServices: Array.isArray(payload.selectedServices)
      ? payload.selectedServices
          .filter((item): item is ServiceSelectionInput => typeof item?.serviceId === "string")
          .map((item) => ({
            serviceId: item.serviceId,
            quantity: Number.isInteger(item.quantity) && (item.quantity ?? 0) > 0 ? item.quantity : 1,
          }))
      : [],
  };
};

const generateReferenceNumber = async (supabase: Awaited<ReturnType<typeof createClient>>) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `SR-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
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
  let reservationId: string | null = null;

  try {
    const requestBody = await request.json();
    const payload = parsePayload(requestBody);

    if (!payload) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid reservation payload.",
        },
        { status: 400 }
      );
    }

    const checkIn = new Date(payload.checkInDate);
    const checkOut = new Date(payload.checkOutDate);
    const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / DAY_MS);

    if (nights <= 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Check-out date must be after check-in date.",
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
          message: "You must be logged in to save your booking.",
        },
        { status: 401 }
      );
    }

    const { data: unit, error: unitError } = await supabase
      .from("units")
      .select("unit_id, base_price, is_active, archived_at")
      .eq("unit_id", payload.unitId)
      .maybeSingle<UnitRow>();

    if (unitError || !unit || !unit.is_active || unit.archived_at) {
      return NextResponse.json(
        {
          success: false,
          message: "Selected unit is not available.",
        },
        { status: 400 }
      );
    }

    const uniqueServiceIds = [...new Set(payload.selectedServices?.map((item) => item.serviceId) ?? [])];

    const { data: servicesData, error: servicesError } = uniqueServiceIds.length
      ? await supabase
          .from("services")
          .select("service_id, price, is_active")
          .in("service_id", uniqueServiceIds)
      : { data: [], error: null };

    if (servicesError) {
      return NextResponse.json(
        {
          success: false,
          message: "Unable to validate selected services.",
        },
        { status: 400 }
      );
    }

    const servicesById = new Map<string, ServiceRow>();
    (servicesData ?? []).forEach((service) => {
      servicesById.set(service.service_id, service as ServiceRow);
    });

    const selectedServices = payload.selectedServices ?? [];
    const hasInvalidService = selectedServices.some((service) => {
      const matched = servicesById.get(service.serviceId);
      return !matched || !matched.is_active;
    });

    if (hasInvalidService) {
      return NextResponse.json(
        {
          success: false,
          message: "One or more selected services are not available.",
        },
        { status: 400 }
      );
    }

    const roomTotal = Number(unit.base_price) * nights;
    const guestsTotal =
      nights *
      (Number(payload.adultCount ?? 0) * ADULT_RATE_PER_NIGHT +
        Number(payload.childCount ?? 0) * CHILD_RATE_PER_NIGHT);
    const servicesTotal = selectedServices.reduce((sum, service) => {
      const matchedService = servicesById.get(service.serviceId);
      if (!matchedService) return sum;
      return sum + Number(matchedService.price) * (service.quantity ?? 1);
    }, 0);
    const subtotal = roomTotal + guestsTotal + servicesTotal;
    const totalAmount = Number((subtotal * (1 + TAX_RATE)).toFixed(2));

    const reservationReference = await generateReferenceNumber(supabase);

    if (!reservationReference) {
      return NextResponse.json(
        {
          success: false,
          message: "Unable to generate reservation reference number.",
        },
        { status: 500 }
      );
    }

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .insert({
        guest_id: user.id,
        reference_number: reservationReference,
        check_in_date: payload.checkInDate,
        check_out_date: payload.checkOutDate,
        adult_count: payload.adultCount,
        child_count: payload.childCount,
        special_requests: payload.specialRequests || null,
        status: "pending",
      })
      .select("reservation_id, reference_number, status")
      .single();

    if (reservationError || !reservation) {
      return NextResponse.json(buildDbFailurePayload(reservationError, "Failed to create reservation."), { status: 500 });
    }

    reservationId = reservation.reservation_id;

    const { error: reservationUnitError } = await supabase.from("reservation_units").insert({
      reservation_id: reservation.reservation_id,
      unit_id: payload.unitId,
      quantity: 1,
      price_per_night: unit.base_price,
    });

    if (reservationUnitError) {
      await supabase.from("reservations").delete().eq("reservation_id", reservation.reservation_id);
      return NextResponse.json(buildDbFailurePayload(reservationUnitError, "Failed to attach selected unit."), {
        status: 500,
      });
    }

    if (selectedServices.length > 0) {
      const reservationServicesPayload = selectedServices.map((service) => {
        const matchedService = servicesById.get(service.serviceId)!;
        return {
          reservation_id: reservation.reservation_id,
          service_id: service.serviceId,
          quantity: service.quantity ?? 1,
          price_at_time: matchedService.price,
        };
      });

      const { error: reservationServicesError } = await supabase
        .from("reservation_services")
        .insert(reservationServicesPayload);

      if (reservationServicesError) {
        await supabase.from("reservations").delete().eq("reservation_id", reservation.reservation_id);
        return NextResponse.json(
          buildDbFailurePayload(reservationServicesError, "Failed to attach selected services."),
          { status: 500 }
        );
      }
    }

    const { error: seedTransactionError } = await supabase.from("transactions").upsert(
      {
        reservation_id: reservation.reservation_id,
        total_amount: totalAmount,
        status: "unpaid",
      },
      {
        onConflict: "reservation_id",
      }
    );

    if (seedTransactionError) {
      await supabase.from("reservations").delete().eq("reservation_id", reservation.reservation_id);
      return NextResponse.json(
        buildDbFailurePayload(seedTransactionError, "Failed to initialize transaction total."),
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
          totalAmount,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (reservationId) {
      const supabase = await createClient();
      await supabase.from("reservations").delete().eq("reservation_id", reservationId);
    }

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? `Unexpected error while saving reservation. ${error.message}`
            : "Unexpected error while saving reservation.",
      },
      { status: 500 }
    );
  }
}
