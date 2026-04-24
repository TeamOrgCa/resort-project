import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type PaymentMethod = "bank_transfer" | "e_wallet";
type PaymentType = "downpayment" | "full" | "additional";

interface ReservationPaymentPayload {
  reservationId: string;
  payment: {
    method: PaymentMethod;
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
    (payment.method !== "bank_transfer" && payment.method !== "e_wallet") ||
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
      method: payment.method,
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
      .select("reservation_id, guest_id, status")
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
        payment_method: payload.payment.method,
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
