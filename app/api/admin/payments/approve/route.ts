import { NextResponse } from "next/server";
import { createAuditLog, requireActiveStaff } from "@/lib/server/admin-audit";

interface ApprovePaymentPayload {
  paymentId: string;
}

interface PaymentRow {
  payment_id: string;
  reservation_id: string;
  status: "pending" | "verified";
  amount: number;
}

interface ReservationRow {
  reservation_id: string;
  status: "pending" | "confirmed" | "cancelled" | "completed";
}

interface TransactionRow {
  total_amount: number;
  paid_amount?: number | null;
  status?: "unpaid" | "partial" | "paid";
  balance?: number | null;
}

const parsePayload = (value: unknown): ApprovePaymentPayload | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const payload = value as Partial<ApprovePaymentPayload>;

  if (typeof payload.paymentId !== "string" || !payload.paymentId.trim()) {
    return null;
  }

  return {
    paymentId: payload.paymentId.trim(),
  };
};

const generateReceiptNumber = (paymentId: string) =>
  `RCPT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${paymentId.slice(0, 6).toUpperCase()}`;

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

    const { data: payment, error: paymentError } = await staffContext.supabase
      .from("payments")
      .select("payment_id, reservation_id, status, amount")
      .eq("payment_id", payload.paymentId)
      .maybeSingle<PaymentRow>();

    if (paymentError || !payment) {
      return NextResponse.json(
        {
          success: false,
          message: "Payment record not found.",
        },
        { status: 404 }
      );
    }

    const { data: reservation, error: reservationError } = await staffContext.supabase
      .from("reservations")
      .select("reservation_id, status")
      .eq("reservation_id", payment.reservation_id)
      .maybeSingle<ReservationRow>();

    if (reservationError || !reservation) {
      return NextResponse.json(
        {
          success: false,
          message: "Reservation record not found.",
        },
        { status: 404 }
      );
    }

    if (reservation.status === "cancelled") {
      return NextResponse.json(
        {
          success: false,
          message: "Cannot approve payment for a cancelled reservation.",
        },
        { status: 400 }
      );
    }

    if (payment.status !== "verified") {
      const { error: verifyPaymentError } = await staffContext.supabase
        .from("payments")
        .update({ status: "verified" })
        .eq("payment_id", payload.paymentId);

      if (verifyPaymentError) {
        return NextResponse.json(
          {
            success: false,
            message: "Failed to verify payment.",
          },
          { status: 500 }
        );
      }
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

    const { data: existingInvoice, error: invoiceLookupError } = await staffContext.supabase
      .from("invoices")
      .select("invoice_id")
      .eq("reservation_id", reservation.reservation_id)
      .maybeSingle();

    if (invoiceLookupError) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to validate generated invoice.",
        },
        { status: 500 }
      );
    }

    if (!existingInvoice) {
      const { data: transactionData, error: transactionError } = await staffContext.supabase
        .from("transactions")
        .select("total_amount")
        .eq("reservation_id", reservation.reservation_id)
        .maybeSingle<TransactionRow>();

      if (transactionError) {
        return NextResponse.json(
          {
            success: false,
            message: "Failed to prepare invoice amount.",
          },
          { status: 500 }
        );
      }

      const { error: createInvoiceError } = await staffContext.supabase.from("invoices").insert({
        reservation_id: reservation.reservation_id,
        total_amount: Number(transactionData?.total_amount ?? payment.amount ?? 0),
      });

      if (createInvoiceError && createInvoiceError.code !== "23505") {
        return NextResponse.json(
          {
            success: false,
            message: "Failed to create invoice.",
          },
          { status: 500 }
        );
      }
    }

    const { data: existingReceipt, error: receiptLookupError } = await staffContext.supabase
      .from("receipts")
      .select("receipt_id")
      .eq("payment_id", payment.payment_id)
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
        payment_id: payment.payment_id,
        receipt_number: generateReceiptNumber(payment.payment_id),
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

    const auditSuccess = await createAuditLog(staffContext, {
      action: "Approved payment verification",
      entityType: "payment",
      entityId: payment.payment_id,
    });

    if (!auditSuccess) {
      return NextResponse.json(
        {
          success: false,
          message: "Payment approved but audit logging failed.",
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

    const { data: refreshedTransaction, error: refreshedTransactionError } = await staffContext.supabase
      .from("transactions")
      .select("balance")
      .eq("reservation_id", reservation.reservation_id)
      .maybeSingle<TransactionRow>();

    if (refreshedTransactionError) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to read updated transaction balance.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Payment approved and billing documents generated.",
        reservationId: reservation.reservation_id,
        remainingBalance: Number(refreshedTransaction?.balance ?? 0),
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while approving payment.",
      },
      { status: 500 }
    );
  }
}
