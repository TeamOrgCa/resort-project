import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotifications, NOTIFICATION_AUDIENCES } from "@/lib/notifications";
import { DOWN_PAYMENT_PERCENT, downPaymentAmount, moneyMatches } from "@/lib/booking/payment-policy";
import { inspectPaymentProof } from "@/lib/server/gcash-ocr";
import { isValidAccountNumber } from "@/lib/helper/validation";

export const runtime = "nodejs";

type PaymentType = "downpayment" | "full";

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
  status: "pending" | "payment_submitted" | "confirmed" | "expired" | "rejected" | "cancelled" | "completed";
  payment_deadline_at: string | null;
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
    (payment.type !== "downpayment" && payment.type !== "full") ||
    typeof payment.amount !== "number" ||
    !Number.isFinite(payment.amount) || payment.amount <= 0 ||
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
      type: payment.type,
      amount: payment.amount,
      referenceNumber: payment.referenceNumber.trim(),
      accountName: payment.accountName.trim(),
      accountNumber: typeof payment.accountNumber === "string" ? payment.accountNumber.trim() || null : null,
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
    const { data: paymentMethod, error: paymentMethodError } = await supabase
      .from("payment_methods")
      .select("payment_method_id, name, type, is_active")
      .eq("payment_method_id", payload.payment.paymentMethodId)
      .maybeSingle<{ payment_method_id: string; name: string; type: string; is_active: boolean }>();

    if (paymentMethodError || !paymentMethod?.is_active) {
      return NextResponse.json({ success: false, message: "Selected payment method is not available." }, { status: 400 });
    }

    if (!paymentMethod.type.toLowerCase().includes("bank") && !isValidAccountNumber(payload.payment.accountNumber ?? "")) {
      return NextResponse.json({ success: false, message: "Account number must contain 6–20 digits." }, { status: 400 });
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
      .select("reservation_id, guest_id, reference_number, status, payment_deadline_at")
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

    const alreadyPaid = Number(transaction.paid_amount ?? 0);
    if (payload.payment.type === "downpayment" && alreadyPaid > 0) {
      return NextResponse.json(
        { success: false, message: "A payment has already been verified. Please pay the outstanding balance." },
        { status: 409 }
      );
    }

    if (reservation.status === "expired" || reservation.status === "rejected") {
      return NextResponse.json({ success: false, code: "RESERVATION_INACTIVE", message: "This reservation is no longer active. Please create a new booking." }, { status: 410 });
    }
    if (reservation.status === "payment_submitted") {
      return NextResponse.json({ success: false, message: "A payment is already awaiting staff review." }, { status: 409 });
    }
    if (reservation.status === "pending" && (!reservation.payment_deadline_at || new Date(reservation.payment_deadline_at).getTime() <= Date.now())) {
      return NextResponse.json({ success: false, code: "PAYMENT_DEADLINE_EXPIRED", message: "The payment deadline has passed. Please make a new reservation." }, { status: 410 });
    }

    if (!payload.payment.proofPath.startsWith(`${user.id}/`) || payload.payment.proofPath.includes("..")) {
      return NextResponse.json({ success: false, message: "Invalid payment proof path." }, { status: 400 });
    }

    const effectiveAmount = payload.payment.type === "full"
      ? remainingBalance
      : downPaymentAmount(Number(transaction.total_amount));
    if (!moneyMatches(payload.payment.amount, effectiveAmount) || effectiveAmount > remainingBalance) {
      return NextResponse.json(
        { success: false, message: `Payment amount does not match the selected ${DOWN_PAYMENT_PERCENT}% down payment or full balance. Refresh the booking and try again.` },
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
      amount: effectiveAmount,
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

    const { data: payment, error: paymentError } = await createAdminClient()
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
        ocr_status: ocr.status,
        ocr_notes: ocr.notes,
        ocr_checked_at: ocr.status === "not_applicable" ? null : new Date().toISOString(),
      })
      .select("payment_id, status, ocr_status")
      .single();

    if (paymentError || !payment) {
      if (paymentError?.code === "P0001" && /deadline|expired/i.test(paymentError.message)) {
        return NextResponse.json({ success: false, code: "PAYMENT_DEADLINE_EXPIRED", message: "The payment deadline has passed. Please make a new reservation." }, { status: 410 });
      }
      if (paymentError?.code === "23505") {
        return NextResponse.json(
          {
            success: false,
            message: "A payment is already pending or this reference number was used. Please review your booking.",
          },
          { status: 409 }
        );
      }

      console.error("[payment] Failed to save payment", paymentError);
      if (
        (paymentError?.code === "42703" || paymentError?.code === "PGRST204") &&
        /ocr_(status|notes|checked_at)/i.test(`${paymentError.message} ${paymentError.details ?? ""}`)
      ) {
        return NextResponse.json(
          {
            success: false,
            code: "PAYMENT_SCHEMA_MIGRATION_REQUIRED",
            message: "Payment processing is being updated. Please ask an administrator to apply docs/account-access-migration.sql, then try again.",
          },
          { status: 503 }
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

    try {
      const { error: notificationError } = await createNotifications({
        actorId: user.id,
        guestId: reservation.guest_id,
        staffRoles: NOTIFICATION_AUDIENCES.payment,
        title: "Payment submitted",
        message: `Payment for reservation ${reservation.reference_number} is pending review.`,
        entityType: "payment",
        entityId: payment.payment_id,
        guestActionUrl: "/manage",
        staffActionUrl: "/admin/transactions",
      });
      if (notificationError) console.warn("Failed to create payment notifications:", notificationError);
    } catch (notificationError) {
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
          ocrStatus: payment.ocr_status,
        },
        reservation: {
          referenceNumber: reservation.reference_number,
          totalAmount: Number(transaction.total_amount ?? 0),
          paidAmount: Number(transaction.paid_amount ?? 0),
          remainingBalance,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[payment] Unexpected error while submitting payment", error);
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while submitting payment. Please try again or contact support.",
      },
      { status: 500 }
    );
  }
}
