import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notifyGuestAndStaff } from "@/lib/notifications";
import { getAllSettings } from "@/lib/settings/settingsService";

type PaymentType = "downpayment" | "full" | "additional";

interface ReservationPaymentPayload {
  reservationId: string;
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

interface ReservationRow {
  reservation_id: string;
  guest_id: string;
  reference_number: string;
  status: "pending" | "confirmed" | "cancelled" | "completed";
}

interface TransactionRow {
  total_amount: number;
  paid_amount: number | null;
  balance: number | null;
}

const parsePayload = (value: unknown): ReservationPaymentPayload | null => {
  if (!value || typeof value !== "object") return null;

  const payload = value as Partial<ReservationPaymentPayload>;

  if (
    typeof payload.reservationId !== "string" ||
    !payload.payment ||
    typeof payload.payment !== "object"
  ) {
    return null;
  }

  const payment = payload.payment as ReservationPaymentPayload["payment"];

  if (
    typeof payment.paymentMethodId !== "string" ||
    !payment.paymentMethodId.trim() ||
    typeof payment.amount !== "number" ||
    payment.amount <= 0 ||
    typeof payment.referenceNumber !== "string" ||
    !payment.referenceNumber.trim() ||
    typeof payment.accountName !== "string" ||
    !payment.accountName.trim() ||
    typeof payment.proofPath !== "string" ||
    !payment.proofPath.trim()
  ) {
    return null;
  }

  return {
    reservationId: payload.reservationId.trim(),
    payment: {
      paymentMethodId: payment.paymentMethodId.trim(),
      type:
        payment.type === "full" || payment.type === "additional" || payment.type === "downpayment"
          ? payment.type
          : "downpayment",
      amount: payment.amount,
      referenceNumber: payment.referenceNumber.trim(),
      accountName: payment.accountName.trim(),
      accountNumber: payment.accountNumber?.trim() || null,
      proofPath: payment.proofPath.trim(),
    },
  };
};

export async function POST(request: Request) {
  try {
    const requestBody = await request.json();
    const payload = parsePayload(requestBody);

    if (!payload) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid payment payload.",
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const [{ data: paymentMethod, error: paymentMethodError }, settings] = await Promise.all([
      supabase
        .from("payment_methods")
        .select("payment_method_id, is_active")
        .eq("payment_method_id", payload.payment.paymentMethodId)
        .maybeSingle<{ payment_method_id: string; is_active: boolean }>(),
      getAllSettings(supabase),
    ]);

    if (paymentMethodError || !paymentMethod?.is_active) {
      return NextResponse.json({ success: false, message: "Selected payment method is not available." }, { status: 400 });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          success: false,
          message: "You must be logged in to submit payment.",
        },
        { status: 401 }
      );
    }

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("reservation_id, guest_id, reference_number, status")
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
          message: "You can only submit payment for your own reservation.",
        },
        { status: 403 }
      );
    }

    const { data: pendingPayment, error: pendingPaymentError } = await supabase
      .from("payments")
      .select("payment_id")
      .eq("reservation_id", reservation.reservation_id)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();

    if (pendingPaymentError) {
      return NextResponse.json(
        {
          success: false,
          message: "Unable to validate pending payments.",
        },
        { status: 500 }
      );
    }

    if (pendingPayment) {
      return NextResponse.json(
        {
          success: false,
          message: "A payment for this reservation is already pending review. Please wait for approval before submitting another one.",
        },
        { status: 409 }
      );
    }

    if (payload.payment.type === "downpayment") {
      const { data: verifiedDownpayment, error: verifiedDownpaymentError } = await supabase
        .from("payments")
        .select("payment_id")
        .eq("reservation_id", reservation.reservation_id)
        .eq("payment_type", "downpayment")
        .eq("status", "verified")
        .limit(1)
        .maybeSingle();

      if (verifiedDownpaymentError) {
        return NextResponse.json(
          {
            success: false,
            message: "Unable to validate existing downpayments.",
          },
          { status: 500 }
        );
      }

      if (verifiedDownpayment) {
        return NextResponse.json(
          {
            success: false,
            message: "This reservation already has a verified downpayment. Only the remaining balance can be paid.",
          },
          { status: 409 }
        );
      }
    }

    if (reservation.status === "cancelled" || reservation.status === "completed") {
      return NextResponse.json(
        {
          success: false,
          message: "Cannot submit payment for this reservation status.",
        },
        { status: 400 }
      );
    }

    const { data: transaction, error: transactionError } = await supabase
      .from("transactions")
      .select("total_amount, paid_amount, balance")
      .eq("reservation_id", reservation.reservation_id)
      .maybeSingle<TransactionRow>();

    if (transactionError || !transaction) {
      return NextResponse.json(
        {
          success: false,
          message: "Unable to validate reservation balance for payment.",
        },
        { status: 500 }
      );
    }

    const remainingBalance = Number(transaction.balance ?? 0);

    if (remainingBalance <= 0) {
      return NextResponse.json(
        {
          success: false,
          message: "This reservation has no remaining balance.",
        },
        { status: 400 }
      );
    }

    const requestedAmount = Number(payload.payment.amount ?? 0);
    const effectiveAmount = payload.payment.type === "full" ? remainingBalance : requestedAmount;

    if (payload.payment.type === "downpayment") {
      const configuredRate = Number(settings["reservation.downpayment_percentage"] ?? 20) / 100;
      const minimumDownpayment = Number(transaction.total_amount ?? 0) * configuredRate;
      if (requestedAmount + 0.0001 < minimumDownpayment) {
        return NextResponse.json(
          {
            success: false,
            message: `Downpayment must be at least ${configuredRate * 100}% of total (₱${minimumDownpayment.toLocaleString("en-PH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}).`,
          },
          { status: 400 }
        );
      }
    }

    if (payload.payment.type !== "full" && requestedAmount > remainingBalance) {
      return NextResponse.json(
        {
          success: false,
          message: "Payment amount cannot exceed remaining balance.",
        },
        { status: 400 }
      );
    }

    if (effectiveAmount <= 0) {
      return NextResponse.json(
        {
          success: false,
          message: "This reservation has no remaining balance.",
        },
        { status: 400 }
      );
    }

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .insert({
        reservation_id: reservation.reservation_id,
        amount: effectiveAmount,
        payment_method_id: payload.payment.paymentMethodId,
        payment_type: payload.payment.type,
        status: "pending",
        reference_number: payload.payment.referenceNumber,
        account_name: payload.payment.accountName,
        account_number: payload.payment.accountNumber,
        proof_path: payload.payment.proofPath,
      })
      .select("payment_id, status")
      .single();

    if (paymentError || !payment) {
      if (paymentError?.code === "23505") {
        return NextResponse.json(
          {
            success: false,
            message: "Payment reference already exists. Please provide a unique reference number.",
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          message: "Failed to save payment record.",
        },
        { status: 500 }
      );
    }

    const { error: notificationError } = await notifyGuestAndStaff(supabase, {
      actorId: user.id,
      guestId: reservation.guest_id,
      title: "Payment submitted",
      message: `Payment for reservation ${reservation.reference_number} is pending review.`,
      entityType: "payment",
      entityId: payment.payment_id,
      guestActionUrl: "/manage",
      staffActionUrl: "/admin/reservations",
    });

    if (notificationError) {
      console.warn("Failed to create payment notifications:", notificationError);
    }

    return NextResponse.json(
      {
        success: true,
        payment: {
          id: payment.payment_id,
          status: payment.status,
          amount: effectiveAmount,
          proofPath: payload.payment.proofPath,
        },
        reservation: {
          totalAmount: Number(transaction.total_amount ?? 0),
          paidAmount: Number(transaction.paid_amount ?? 0),
          remainingBalance,
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
            ? `Unexpected error while submitting payment. ${error.message}`
            : "Unexpected error while submitting payment.",
      },
      { status: 500 }
    );
  }
}
