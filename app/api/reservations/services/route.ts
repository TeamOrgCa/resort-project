import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface DbErrorLike {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

interface ServiceUpdateInput {
  serviceId: string;
  quantity: number;
}

interface UpdateReservationServicesPayload {
  reservationId: string;
  services: ServiceUpdateInput[];
}

interface ReservationRow {
  reservation_id: string;
  guest_id: string;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "reschedule_requested";
  start_datetime: string;
  end_datetime: string;
  adult_count: number;
  child_count: number;
}

interface ExistingReservationServiceRow {
  service_id: string;
  quantity: number;
  price_at_time: number;
}

interface ServiceCatalogRow {
  service_id: string;
  price: number;
  is_active: boolean;
}

interface ReservationUnitRow {
  quantity: number;
  price_per_night: number;
}

interface TransactionSnapshotRow {
  paid_amount: number | null;
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

const buildDbFailurePayload = (fallback: string, error?: unknown) => {
  const dbError = toDbError(error);
  const detailParts = [dbError.message, dbError.details, dbError.hint].filter(Boolean);

  return {
    success: false,
    message: detailParts.length ? `${fallback} (${detailParts.join(" | ")})` : fallback,
    errorCode: dbError.code ?? null,
    errorDetails: dbError.details ?? null,
    errorHint: dbError.hint ?? null,
  };
};

const parsePayload = (value: unknown): UpdateReservationServicesPayload | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Partial<UpdateReservationServicesPayload>;

  if (typeof payload.reservationId !== "string" || !payload.reservationId.trim() || !Array.isArray(payload.services)) {
    return null;
  }

  const parsedServices = payload.services
    .filter((item) => typeof item === "object" && item !== null)
    .map((item) => ({
      serviceId: typeof item.serviceId === "string" ? item.serviceId.trim() : "",
      quantity: Number(item.quantity),
    }))
    .filter((item) => item.serviceId && Number.isInteger(item.quantity) && item.quantity > 0);

  const uniqueServiceIds = new Set(parsedServices.map((item) => item.serviceId));

  if (parsedServices.length === 0 || uniqueServiceIds.size !== parsedServices.length) {
    return null;
  }

  return {
    reservationId: payload.reservationId.trim(),
    services: parsedServices,
  };
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = parsePayload(body);

    if (!payload) {
      return NextResponse.json(
        buildDbFailurePayload("Invalid services update payload."),
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
          message: "You must be logged in to update reservation services.",
        },
        { status: 401 }
      );
    }

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("reservation_id, guest_id, status, start_datetime, end_datetime, adult_count, child_count")
      .eq("reservation_id", payload.reservationId)
      .maybeSingle<ReservationRow>();

    if (reservationError || !reservation) {
      return NextResponse.json(
        buildDbFailurePayload("Reservation not found.", reservationError),
        { status: 404 }
      );
    }

    if (reservation.guest_id !== user.id) {
      return NextResponse.json(
        {
          success: false,
          message: "You can only update your own reservation services.",
        },
        { status: 403 }
      );
    }

    if (reservation.status === "cancelled" || reservation.status === "completed") {
      return NextResponse.json(
        {
          success: false,
          message: "Services can only be updated for active reservations.",
        },
        { status: 400 }
      );
    }

    const { data: existingServices, error: existingServicesError } = await supabase
      .from("reservation_services")
      .select("service_id, quantity, price_at_time")
      .eq("reservation_id", reservation.reservation_id);

    if (existingServicesError) {
      console.error("[reservation-services] Failed to read existing reservation services", existingServicesError);
      return NextResponse.json(
        buildDbFailurePayload("Failed to validate existing reservation services.", existingServicesError),
        { status: 500 }
      );
    }

    const existingRows = (existingServices as ExistingReservationServiceRow[] | null) ?? [];
    const existingByServiceId = new Map(existingRows.map((row) => [row.service_id, row]));
    const requestedByServiceId = new Map(payload.services.map((item) => [item.serviceId, item]));

    for (const existing of existingRows) {
      const requested = requestedByServiceId.get(existing.service_id);

      if (!requested) {
        return NextResponse.json(
          {
            success: false,
            message: "Removing existing services is not allowed after booking.",
          },
          { status: 400 }
        );
      }

      if (requested.quantity < Number(existing.quantity ?? 0)) {
        return NextResponse.json(
          {
            success: false,
            message: "Reducing existing service quantities is not allowed after booking.",
          },
          { status: 400 }
        );
      }
    }

    const requestedServiceIds = payload.services.map((item) => item.serviceId);

    const { data: serviceCatalogRows, error: serviceCatalogError } = await supabase
      .from("services")
      .select("service_id, price, is_active")
      .in("service_id", requestedServiceIds);

    if (serviceCatalogError) {
      console.error("[reservation-services] Failed to validate selected services", serviceCatalogError);
      return NextResponse.json(
        buildDbFailurePayload("Failed to validate selected services.", serviceCatalogError),
        { status: 500 }
      );
    }

    const catalog = (serviceCatalogRows as ServiceCatalogRow[] | null) ?? [];
    const catalogById = new Map(catalog.map((row) => [row.service_id, row]));

    const invalidRequest = payload.services.some((item) => {
      const service = catalogById.get(item.serviceId);
      return !service || !service.is_active;
    });

    if (invalidRequest) {
      return NextResponse.json(
        {
          success: false,
          message: "One or more selected services are unavailable.",
        },
        { status: 400 }
      );
    }

    const upsertRows = payload.services.map((item) => {
      const existing = existingByServiceId.get(item.serviceId);
      const service = catalogById.get(item.serviceId)!;

      return {
        reservation_id: reservation.reservation_id,
        service_id: item.serviceId,
        quantity: item.quantity,
        // Keep original captured price for previously booked services.
        price_at_time: Number(existing?.price_at_time ?? service.price ?? 0),
      };
    });

    const { error: upsertError } = await supabase.from("reservation_services").upsert(upsertRows, {
      onConflict: "reservation_id,service_id",
    });

    if (upsertError) {
      console.error("[reservation-services] Failed to update reservation services", upsertError);
      return NextResponse.json(
        buildDbFailurePayload("Failed to update reservation services.", upsertError),
        { status: 500 }
      );
    }

    const nights = Math.max(
      1,
      Math.ceil(
        (new Date(reservation.end_datetime).getTime() - new Date(reservation.start_datetime).getTime()) / DAY_MS
      )
    );

    const { data: reservationUnitsData, error: reservationUnitsError } = await supabase
      .from("reservation_units")
      .select("quantity, price_per_night")
      .eq("reservation_id", reservation.reservation_id);

    if (reservationUnitsError) {
      console.error("[reservation-services] Failed to read reservation units", reservationUnitsError);
      return NextResponse.json(
        buildDbFailurePayload("Services were updated but failed to recompute reservation total.", reservationUnitsError),
        { status: 500 }
      );
    }

    const roomTotal = ((reservationUnitsData as ReservationUnitRow[] | null) ?? []).reduce((sum, unit) => {
      return sum + Number(unit.quantity ?? 0) * Number(unit.price_per_night ?? 0) * nights;
    }, 0);

    const servicesTotal = upsertRows.reduce((sum, row) => {
      return sum + Number(row.quantity ?? 0) * Number(row.price_at_time ?? 0);
    }, 0);

    const guestsTotal =
      nights *
      (Number(reservation.adult_count ?? 0) * ADULT_RATE_PER_NIGHT +
        Number(reservation.child_count ?? 0) * CHILD_RATE_PER_NIGHT);

    const recomputedTotal = Number(((roomTotal + servicesTotal + guestsTotal) * (1 + TAX_RATE)).toFixed(2));

    const { data: transactionSnapshot, error: transactionSnapshotError } = await supabase
      .from("transactions")
      .select("paid_amount")
      .eq("reservation_id", reservation.reservation_id)
      .maybeSingle<TransactionSnapshotRow>();

    if (transactionSnapshotError) {
      console.error("[reservation-services] Failed to read transaction snapshot", transactionSnapshotError);
      return NextResponse.json(
        buildDbFailurePayload("Services were updated but failed to refresh transaction status.", transactionSnapshotError),
        { status: 500 }
      );
    }

    if (transactionSnapshot) {
      const paidAmount = Number(transactionSnapshot.paid_amount ?? 0);

      const nextStatus =
        paidAmount >= recomputedTotal && recomputedTotal > 0
          ? "paid"
          : paidAmount > 0
            ? "partial"
            : "unpaid";

      const { error: transactionStatusError } = await supabase
        .from("transactions")
        .update({ total_amount: recomputedTotal, status: nextStatus })
        .eq("reservation_id", reservation.reservation_id);

      if (transactionStatusError) {
        console.error("[reservation-services] Failed to update transaction status", transactionStatusError);
        return NextResponse.json(
          buildDbFailurePayload("Services were updated but failed to refresh transaction status.", transactionStatusError),
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      {
        success: true,
        reservationId: reservation.reservation_id,
        message: "Reservation services updated successfully.",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[reservation-services] Unexpected error", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? `Unexpected error while updating reservation services. ${error.message}`
            : "Unexpected error while updating reservation services.",
      },
      { status: 500 }
    );
  }
}
