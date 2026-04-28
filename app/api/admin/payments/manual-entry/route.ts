import { NextResponse } from "next/server";
import { createAuditLog, requireActiveStaff } from "@/lib/server/admin-audit";

type ManualPaymentMethod = "bank_transfer" | "e_wallet" | "cash";

interface ManualPaymentPayload {
  reservationId: string;
  amount: number;
  paymentMethod: ManualPaymentMethod;
  paymentReference: string;
  accountName?: string;
  accountNumber?: string;
  proofPath?: string;
}

interface ReservationRow {
  reservation_id: string;
  status: "pending" | "confirmed" | "cancelled" | "completed";
}

interface TransactionRow {
  balance: number | null;
  overpaid_amount?: number | null;
  total_amount?: number;
  paid_amount?: number | null;
  status?: "unpaid" | "partial" | "paid";
}

interface CreatedPaymentRow {
  payment_id: string;
  reservation_id: string;
  amount: number;
  payment_method: "bank_transfer" | "e_wallet" | "cash";
  payment_type: "downpayment" | "full" | "additional";
  status: "pending" | "verified";
  paid_at: string | null;
  reference_number: string;
  proof_path: string;
}

const generateReceiptNumber = (paymentId: string) =>
  `RCPT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${paymentId.slice(0, 6).toUpperCase()}`;

const parsePayload = (value: unknown): ManualPaymentPayload | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const payload = value as Partial<ManualPaymentPayload>;

  if (
    typeof payload.reservationId !== "string" ||
    typeof payload.amount !== "number" ||
    payload.amount <= 0 ||
    typeof payload.paymentReference !== "string" ||
    !payload.paymentReference.trim() ||
    (payload.paymentMethod !== "bank_transfer" && payload.paymentMethod !== "e_wallet" && payload.paymentMethod !== "cash")
  ) {
    return null;
  }

  return {
    reservationId: payload.reservationId.trim(),
    amount: payload.amount,
    paymentMethod: payload.paymentMethod,
    paymentReference: payload.paymentReference.trim(),
    accountName: typeof payload.accountName === "string" ? payload.accountName.trim() : undefined,
    accountNumber: typeof payload.accountNumber === "string" ? payload.accountNumber.trim() : undefined,
    proofPath: typeof payload.proofPath === "string" ? payload.proofPath.trim() : undefined,
  };
};

export async function POST(request: Request) {
  try {
    const staffContext = await requireActiveStaff();

    if (!staffContext) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized.",
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    const payload = parsePayload(body);

    if (!payload) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid request payload.",
        },
        { status: 400 }
      );
    }

    if (payload.paymentMethod !== "cash") {
      if (!payload.accountName || !payload.accountNumber || !payload.proofPath) {
        return NextResponse.json(
          {
            success: false,
            message: "Account details and payment proof are required for this payment method.",
          },
          { status: 400 }
        );
      }
    }

    const { data: reservation, error: reservationError } = await staffContext.supabase
      .from("reservations")
      .select("reservation_id, status")
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

    if (reservation.status === "cancelled") {
      return NextResponse.json(
        {
          success: false,
          message: "Cannot add payment to a cancelled reservation.",
        },
        { status: 400 }
      );
    }

    const { data: transaction, error: transactionError } = await staffContext.supabase
      .from("transactions")
      .select("balance")
      .eq("reservation_id", reservation.reservation_id)
      .maybeSingle<TransactionRow>();

    if (transactionError) {
      return NextResponse.json(
        {
          success: false,
          message: "Unable to validate remaining balance.",
        },
        { status: 500 }
      );
    }

    const remainingBalance = Number(transaction?.balance ?? 0);

    if (remainingBalance <= 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Reservation has no remaining balance.",
        },
        { status: 400 }
      );
    }

    const { data: insertedPayment, error: insertError } = await staffContext.supabase
      .from("payments")
      .insert({
        reservation_id: reservation.reservation_id,
        amount: payload.amount,
        payment_method: payload.paymentMethod,
        payment_type: "additional",
        status: "pending",
        reference_number: payload.paymentReference,
        account_name: payload.paymentMethod === "cash" ? "Cash Payment" : payload.accountName,
        account_number: payload.paymentMethod === "cash" ? null : payload.accountNumber,
        proof_path: payload.paymentMethod === "cash" ? "" : payload.proofPath,
      })
      .select(
        "payment_id, reservation_id, amount, payment_method, payment_type, status, paid_at, reference_number, proof_path"
      )
      .single<CreatedPaymentRow>();

    if (insertError || !insertedPayment) {
      if (insertError?.code === "23505") {
        return NextResponse.json(
          {
            success: false,
            message: "Generated payment reference already exists. Please try again.",
          },
          { status: 409 }
        );
      }

      if (insertError?.code === "23514" && payload.paymentMethod === "cash") {
        return NextResponse.json(
          {
            success: false,
            message:
              "Cash method is blocked by current database constraint. Please update payments.payment_method check to include 'cash'.",
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          message: "Failed to create payment entry.",
        },
        { status: 500 }
      );
    }

    const { error: verifyPaymentError } = await staffContext.supabase
      .from("payments")
      .update({ status: "verified" })
      .eq("payment_id", insertedPayment.payment_id);

    if (verifyPaymentError) {
      return NextResponse.json(
        {
          success: false,
          message: "Payment entry created but verification failed.",
        },
        { status: 500 }
      );
    }

    if (reservation.status !== "confirmed") {
      const { error: confirmReservationError } = await staffContext.supabase
        .from("reservations")
        .update({ status: "confirmed" })
        .eq("reservation_id", reservation.reservation_id);

      if (confirmReservationError) {
        return NextResponse.json(
          {
            success: false,
            message: "Payment verified but failed to confirm reservation.",
          },
          { status: 500 }
        );
      }
    }

    // Invoice creation is handled by database triggers.

    const { data: existingReceipt, error: receiptLookupError } = await staffContext.supabase
      .from("receipts")
      .select("receipt_id")
      .eq("payment_id", insertedPayment.payment_id)
      .maybeSingle();

    if (receiptLookupError) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to validate generated receipt.",
        },
        { status: 500 }
      );
    }

    if (!existingReceipt) {
      const { error: createReceiptError } = await staffContext.supabase.from("receipts").insert({
        payment_id: insertedPayment.payment_id,
        receipt_number: generateReceiptNumber(insertedPayment.payment_id),
      });

      if (createReceiptError && createReceiptError.code !== "23505") {
        return NextResponse.json(
          {
            success: false,
            message: "Failed to create receipt.",
          },
          { status: 500 }
        );
      }
    }

    const { data: createdPayment, error: paymentReloadError } = await staffContext.supabase
      .from("payments")
      .select(
        "payment_id, reservation_id, amount, payment_method, payment_type, status, paid_at, reference_number, proof_path"
      )
      .eq("payment_id", insertedPayment.payment_id)
      .maybeSingle<CreatedPaymentRow>();

    if (paymentReloadError || !createdPayment) {
      return NextResponse.json(
        {
          success: false,
          message: "Payment created but failed to fetch updated payment status.",
        },
        { status: 500 }
      );
    }

    const { data: transactionSummary, error: transactionSummaryError } = await staffContext.supabase
      .from("transactions")
      .select("total_amount")
      .eq("reservation_id", reservation.reservation_id)
      .maybeSingle<TransactionRow>();

    if (transactionSummaryError) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to read transaction summary.",
        },
        { status: 500 }
      );
    }

    const { data: verifiedPayments, error: verifiedPaymentsError } = await staffContext.supabase
      .from("payments")
      .select("amount")
      .eq("reservation_id", reservation.reservation_id)
      .eq("status", "verified");

    if (verifiedPaymentsError) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to aggregate verified payments.",
        },
        { status: 500 }
      );
    }

    const paidAmount = ((verifiedPayments as Array<{ amount: number }> | null) ?? []).reduce(
      (sum, payment) => sum + Number(payment.amount ?? 0),
      0
    );

    const totalAmount = Number(transactionSummary?.total_amount ?? 0);
    const transactionStatus: "unpaid" | "partial" | "paid" =
      paidAmount <= 0 ? "unpaid" : paidAmount >= totalAmount ? "paid" : "partial";

    const { error: syncError } = await staffContext.supabase.from("transactions").upsert(
      {
        reservation_id: reservation.reservation_id,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        status: transactionStatus,
      },
      {
        onConflict: "reservation_id",
      }
    );

    if (syncError) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to synchronize transaction totals.",
        },
        { status: 500 }
      );
    }

    const { data: updatedTransaction, error: updatedTransactionError } = await staffContext.supabase
      .from("transactions")
      .select("balance, overpaid_amount")
      .eq("reservation_id", reservation.reservation_id)
      .maybeSingle<TransactionRow>();

    if (updatedTransactionError) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to read updated transaction balance.",
        },
        { status: 500 }
      );
    }

    const auditSuccess = await createAuditLog(staffContext, {
      action: "Created manual payment entry",
      entityType: "payment",
      entityId: createdPayment.payment_id,
    });

    if (!auditSuccess) {
      return NextResponse.json(
        {
          success: false,
          message: "Payment entry created but audit logging failed.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        payment: createdPayment,
        reservationId: reservation.reservation_id,
        remainingBalance: Number(updatedTransaction?.balance ?? 0),
        overpaidAmount: Number(updatedTransaction?.overpaid_amount ?? 0),
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while creating manual payment entry.",
      },
      { status: 500 }
    );
  }
}
