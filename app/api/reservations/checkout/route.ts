import { NextResponse } from "next/server";
import { createNotifications, NOTIFICATION_AUDIENCES } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeBookingPricing } from "@/lib/booking/pricing";
import { DOWN_PAYMENT_PERCENT, downPaymentAmount, moneyMatches } from "@/lib/booking/payment-policy";
import { inspectPaymentProof } from "@/lib/server/gcash-ocr";
import { checkReservationOverlap } from "@/lib/server/reservation-availability";
import { isValidGuestCounts } from "@/lib/booking/guest-count";

export const runtime = "nodejs";
import { validateBookingWindow, type BookingMode, type WholeDayVariant } from "@/lib/booking/policy";

type PaymentType = "downpayment" | "full";

interface ServiceSelectionInput {
  serviceId: string;
  quantity?: number;
}

interface CheckoutPayload {
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
  selectedServices?: ServiceSelectionInput[];
  payment: {
    paymentMethodId: string;
    type?: PaymentType;
    amount: number;
    referenceNumber: string;
    accountName: string;
    accountNumber?: string | null;
    proofPath: string;
  };
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

interface DbErrorLike {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

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

const isInvoiceConstraintConflict = (error: unknown) => {
  const dbError = toDbError(error);
  const text = `${dbError.message ?? ""} ${dbError.details ?? ""} ${dbError.hint ?? ""}`.toLowerCase();

  return (
    dbError.code === "23505" &&
    (text.includes("invoices") || text.includes("reservation_id"))
  );
};

const isAuditStaffForeignKeyConflict = (error: unknown) => {
  const dbError = toDbError(error);
  const text = `${dbError.message ?? ""} ${dbError.details ?? ""} ${dbError.hint ?? ""}`.toLowerCase();

  return (
    dbError.code === "23503" &&
    (text.includes("audit_logs") || text.includes("staff_users") || text.includes("user_id"))
  );
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

const parsePayload = (value: unknown): CheckoutPayload | null => {
  if (!value || typeof value !== "object") return null;

  const payload = value as Partial<CheckoutPayload>;

  if (
    (payload.bookingMode !== "day" && payload.bookingMode !== "night" && payload.bookingMode !== "whole_day" && payload.bookingMode !== "custom") ||
    typeof payload.startDatetime !== "string" ||
    typeof payload.endDatetime !== "string" ||
    typeof payload.unitId !== "string" ||
    typeof payload.adultCount !== "number" ||
    typeof payload.childCount !== "number" ||
    !payload.payment ||
    typeof payload.payment !== "object"
  ) {
    return null;
  }

  const payment = payload.payment as CheckoutPayload["payment"];

  if (
    typeof payment.paymentMethodId !== "string" ||
    !payment.paymentMethodId.trim() ||
    (payment.type !== "downpayment" && payment.type !== "full") ||
    typeof payment.amount !== "number" ||
    !Number.isFinite(payment.amount) || payment.amount <= 0 ||
    typeof payment.referenceNumber !== "string" ||
    typeof payment.accountName !== "string" ||
    typeof payment.proofPath !== "string"
  ) {
    return null;
  }

  if (!isValidDate(payload.startDatetime) || !isValidDate(payload.endDatetime)) {
    return null;
  }

  if (!isValidGuestCounts(payload.adultCount, payload.childCount)) {
    return null;
  }

  return {
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
    payment: {
      paymentMethodId: payment.paymentMethodId,
      type: payment.type,
      amount: payment.amount,
      referenceNumber: payment.referenceNumber.trim(),
      accountName: payment.accountName.trim(),
      accountNumber: payment.accountNumber?.trim() || null,
      proofPath: payment.proofPath.trim(),
    },
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
          message: "Invalid checkout payload.",
        },
        { status: 400 }
      );
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

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          success: false,
          message: "You must be logged in to complete checkout.",
        },
        { status: 401 }
      );
    }

    if (!payload.payment.proofPath.startsWith(`${user.id}/`) || payload.payment.proofPath.includes("..")) {
      return NextResponse.json({ success: false, message: "Invalid payment proof path." }, { status: 400 });
    }
    const { data: paymentMethod, error: paymentMethodError } = await supabase.from("payment_methods")
      .select("name, type, is_active")
      .eq("payment_method_id", payload.payment.paymentMethodId)
      .maybeSingle<{ name: string; type: string; is_active: boolean }>();
    if (paymentMethodError || !paymentMethod?.is_active) {
      return NextResponse.json({ success: false, message: "Selected payment method is unavailable." }, { status: 400 });
    }

    const { conflict: overlapReservation, error: overlapError } = await checkReservationOverlap(
      payload.startDatetime,
      payload.endDatetime,
      user.id
    );

    if (overlapError) {
      return NextResponse.json(
        {
          success: false,
          message: "Unable to validate overlapping reservations.",
        },
        { status: 500 }
      );
    }

    if (overlapReservation) {
      return NextResponse.json(
        {
          success: false,
          message: "This booking date has already been reserved. Please choose another date.",
        },
        { status: 409 }
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

    const servicesTotal = selectedServices.reduce((sum, service) => {
      const matchedService = servicesById.get(service.serviceId);
      if (!matchedService) return sum;
      return sum + Number(matchedService.price) * (service.quantity ?? 1);
    }, 0);

    const pricing = computeBookingPricing({
      bookingMode: payload.bookingMode,
      startDatetime: payload.startDatetime,
      endDatetime: payload.endDatetime,
      adultCount: payload.adultCount,
      childCount: payload.childCount,
      servicesTotal,
    });
    const totalAmount = pricing.total;

    const expectedAmount = payload.payment.type === "full" ? totalAmount : downPaymentAmount(totalAmount);
    if (!moneyMatches(payload.payment.amount, expectedAmount)) {
      return NextResponse.json(
        {
          success: false,
          message: `Payment amount must equal the ${DOWN_PAYMENT_PERCENT}% down payment or the full reservation total.`,
        },
        { status: 400 }
      );
    }

    const { data: receivingAccount } = await supabase.from("payment_accounts")
      .select("account_name, account_number")
      .eq("payment_method_id", payload.payment.paymentMethodId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle<{ account_name: string; account_number: string | null }>();
    const ocr = await inspectPaymentProof(supabase, {
      userId: user.id,
      proofPath: payload.payment.proofPath,
      methodName: paymentMethod.name,
      methodType: paymentMethod.type,
      amount: expectedAmount,
      reference: payload.payment.referenceNumber,
      recipientName: receivingAccount?.account_name,
      recipientNumber: receivingAccount?.account_number,
    });
    if (!ocr) {
      return NextResponse.json({ success: false, message: "Payment proof is missing or is not a supported image under 8 MB." }, { status: 400 });
    }
    if (ocr.status === "rejected") {
      return NextResponse.json({ success: false, code: "INVALID_PAYMENT_PROOF", message: ocr.notes }, { status: 422 });
    }
    if (ocr.status === "screening_unavailable") {
      return NextResponse.json({ success: false, code: "PROOF_SCREENING_UNAVAILABLE", message: ocr.notes }, { status: 503 });
    }

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
        booking_mode: payload.bookingMode,
        start_datetime: payload.startDatetime,
        end_datetime: payload.endDatetime,
        adult_count: payload.adultCount,
        child_count: payload.childCount,
        special_requests: payload.specialRequests || null,
        status: "pending",
      })
      .select("reservation_id, reference_number, status, payment_deadline_at")
      .single();

    if (reservationError || !reservation) {
      if (reservationError?.code === "23P01") {
        return NextResponse.json({ success: false, code: "DATE_UNAVAILABLE", message: "This booking date has already been reserved. Please choose another date." }, { status: 409 });
      }
      console.error("[checkout] Failed to create reservation", reservationError);
      return NextResponse.json(
        buildDbFailurePayload(reservationError, "Failed to create reservation."),
        { status: 500 }
      );
    }

    reservationId = reservation.reservation_id;

    // Seed transaction total before unit/service triggers run so invoice creation has a non-null amount.
    const { error: seedTransactionError } = await supabase.from("transactions").upsert(
      {
        reservation_id: reservation.reservation_id,
        total_amount: totalAmount,
      },
      {
        onConflict: "reservation_id",
      }
    );

    if (seedTransactionError) {
      console.error("[checkout] Failed to initialize transaction total", seedTransactionError);
      await supabase.from("reservations").delete().eq("reservation_id", reservation.reservation_id);
      return NextResponse.json(
        buildDbFailurePayload(seedTransactionError, "Failed to initialize transaction total."),
        { status: 500 }
      );
    }

    const { error: reservationUnitError } = await supabase.from("reservation_units").insert({
      reservation_id: reservation.reservation_id,
      unit_id: payload.unitId,
      quantity: 1,
      price_per_night: unit.base_price,
    });

    if (reservationUnitError) {
      console.error("[checkout] Failed to attach selected unit", reservationUnitError);
      await supabase.from("reservations").delete().eq("reservation_id", reservation.reservation_id);

      if (isInvoiceConstraintConflict(reservationUnitError)) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Billing trigger conflict detected while creating invoice records. Check invoice uniqueness and trigger constraints.",
          },
          { status: 500 }
        );
      }

      if (isAuditStaffForeignKeyConflict(reservationUnitError)) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Audit logging trigger conflict detected for guest checkout. Update log_service_change() to only write staff user_id values.",
          },
          { status: 500 }
        );
      }

      return NextResponse.json(
        buildDbFailurePayload(reservationUnitError, "Failed to attach selected unit."),
        { status: 500 }
      );
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
        console.error("[checkout] Failed to attach selected services", reservationServicesError);
        await supabase.from("reservations").delete().eq("reservation_id", reservation.reservation_id);

        if (isInvoiceConstraintConflict(reservationServicesError)) {
          return NextResponse.json(
            {
              success: false,
              message:
                "Billing trigger conflict detected while creating invoice records. Check invoice uniqueness and trigger constraints.",
            },
            { status: 500 }
          );
        }

        if (isAuditStaffForeignKeyConflict(reservationServicesError)) {
          return NextResponse.json(
            {
              success: false,
              message:
                "Audit logging trigger conflict detected for guest checkout. Update log_service_change() to only write staff user_id values.",
            },
            { status: 500 }
          );
        }

        return NextResponse.json(
          buildDbFailurePayload(reservationServicesError, "Failed to attach selected services."),
          { status: 500 }
        );
      }
    }

    const { data: payment, error: paymentError } = await createAdminClient()
      .from("payments")
      .insert({
        reservation_id: reservation.reservation_id,
        amount: payload.payment.amount,
        payment_method_id: payload.payment.paymentMethodId,
        payment_type: payload.payment.type,
        status: "pending",
        reference_number: payload.payment.referenceNumber,
        account_name: payload.payment.accountName,
        account_number: payload.payment.accountNumber,
        proof_path: payload.payment.proofPath,
        ocr_status: ocr.status,
        ocr_notes: ocr.notes,
        ocr_checked_at: ocr.status === "not_applicable" ? null : new Date().toISOString(),
      })
      .select("payment_id, status, ocr_status")
      .single();

    if (paymentError || !payment) {
      if (paymentError?.code === "P0001" && /deadline|expired/i.test(paymentError.message)) {
        return NextResponse.json({ success: false, code: "PAYMENT_DEADLINE_EXPIRED", message: "The payment deadline passed during checkout. Please try a new reservation." }, { status: 410 });
      }
      console.error("[checkout] Failed to record payment", paymentError);
      await supabase.from("reservations").delete().eq("reservation_id", reservation.reservation_id);
      return NextResponse.json(
        buildDbFailurePayload(paymentError, "Failed to record payment."),
        { status: 500 }
      );
    }

    const { error: notificationError } = await createNotifications({
      actorId: user.id,
      guestId: user.id,
      staffRoles: NOTIFICATION_AUDIENCES.checkout,
      title: "Reservation checkout submitted",
      message: `Reservation ${reservation.reference_number} and payment were submitted for review.`,
      entityType: "payment",
      entityId: payment.payment_id,
      guestActionUrl: "/manage",
      staffActionUrl: "/admin/transactions",
    });
    if (notificationError) console.warn("Failed to create checkout notifications:", notificationError);

    return NextResponse.json(
      {
        success: true,
        reservation: {
          id: reservation.reservation_id,
          referenceNumber: reservation.reference_number,
          status: reservation.status,
          paymentDeadlineAt: reservation.payment_deadline_at,
          totalAmount,
        },
        payment: {
          id: payment.payment_id,
          status: payment.status,
          amount: payload.payment.amount,
          proofPath: payload.payment.proofPath,
          ocrStatus: payment.ocr_status,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[checkout] Unexpected error", error);

    if (reservationId) {
      const supabase = await createClient();
      await supabase.from("reservations").delete().eq("reservation_id", reservationId);
    }

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? `Unexpected error while creating reservation checkout. ${error.message}`
            : "Unexpected error while creating reservation checkout.",
      },
      { status: 500 }
    );
  }
}
