import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { sendReservationConfirmedEmail } from "@/lib/email";
import { createNotifications } from "@/lib/notifications";
import { emailBillingDocuments } from "@/lib/server/billing-email";

interface ApprovePaymentPayload {
  paymentId: string;
}

interface PaymentRow {
  payment_id: string;
  reservation_id: string;
  status: "pending" | "verified" | "rejected";
  amount: number;
}

interface ReservationRow {
  reservation_id: string;
  guest_id: string | null;
  walk_in_guest_id: string | null;
  reference_number: string;
  start_datetime: string;
  end_datetime: string;
  status: string;
}

interface GuestEmailRow {
  email: string;
  first_name: string | null;
  last_name: string | null;
}

interface TransactionRow {
  total_amount: number;
  paid_amount?: number | null;
  status?: "unpaid" | "partial" | "paid";
  balance?: number | null;
  overpaid_amount?: number | null;
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

    if (staffContext.staffUser.role !== "admin" && staffContext.staffUser.role !== "cashier") {
      return NextResponse.json({ success: false, message: "Only admin or cashier can approve payments." }, { status: 403 });
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

    if (payment.status !== "pending") {
      return NextResponse.json({ success: false, message: "This payment has already been reviewed." }, { status: 409 });
    }

    const { data: reservation, error: reservationError } = await staffContext.supabase
      .from("reservations")
      .select("reservation_id, guest_id, walk_in_guest_id, reference_number, start_datetime, end_datetime, status")
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

    if (reservation.status !== "payment_submitted" && reservation.status !== "confirmed") {
      return NextResponse.json(
        {
          success: false,
          message: "This reservation is not eligible for payment approval.",
        },
        { status: 400 }
      );
    }

    const { data: verifiedPayment, error: verifyPaymentError } = await staffContext.supabase
      .from("payments")
      .update({ status: "verified" })
      .eq("payment_id", payload.paymentId)
      .eq("status", "pending")
      .select("payment_id")
      .maybeSingle();
    if (verifyPaymentError || !verifiedPayment) {
      return NextResponse.json({ success: false, message: verifyPaymentError?.message ?? "This payment has already been reviewed." },
        { status: verifyPaymentError ? 500 : 409 });
    }

    // Invoice creation is handled by database triggers.

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

    // The database trigger records the reviewer and audit entry atomically.

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
      .select("balance, overpaid_amount")
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

    let emailSent = false;

    const guestLookup = reservation.guest_id
      ? staffContext.supabase
          .from("guests")
          .select("email, first_name, last_name")
          .eq("id", reservation.guest_id)
          .maybeSingle<GuestEmailRow>()
      : reservation.walk_in_guest_id
        ? staffContext.supabase
            .from("walk_in_guests")
            .select("email, first_name, last_name")
            .eq("walk_in_guest_id", reservation.walk_in_guest_id)
            .maybeSingle<GuestEmailRow>()
        : Promise.resolve({ data: null, error: null });

    const { data: guest, error: guestLookupError } = await guestLookup;

    if (guestLookupError) {
      console.error("Failed to read guest email for confirmation notice.", guestLookupError);
    } else if (guest?.email) {
      emailSent = await sendReservationConfirmedEmail({
        guestEmail: guest.email,
        guestName: `${guest.first_name ?? ""} ${guest.last_name ?? ""}`.replace(/\s+/g, " ").trim() || "Guest",
        reservationReference: reservation.reference_number,
        checkInDate: reservation.start_datetime,
        checkOutDate: reservation.end_datetime,
      });
    }

    let billingEmails = { receiptSent: false, invoiceSent: false };
    try {
      billingEmails = await emailBillingDocuments(staffContext.supabase, reservation, payment.payment_id, Number(payment.amount));
    } catch (error) {
      console.error("Unable to email billing documents after payment approval.", error);
    }

    if (reservation.guest_id) {
      const { error: notificationError } = await createNotifications({
        actorId: staffContext.staffUser.id,
        guestId: reservation.guest_id,
        title: "Payment approved",
        message: `Payment for reservation ${reservation.reference_number} was approved.`,
        entityType: "payment",
        entityId: payment.payment_id,
        guestActionUrl: "/manage",
      });
      if (notificationError) console.warn("Failed to notify guest of payment approval:", notificationError);
    }

    return NextResponse.json(
      {
        success: true,
        message: emailSent
          ? "Payment approved, billing documents generated, and confirmation email sent."
          : "Payment approved and billing documents generated. Confirmation email delivery could not be confirmed.",
        reservationId: reservation.reservation_id,
        remainingBalance: Number(refreshedTransaction?.balance ?? 0),
        overpaidAmount: Number(refreshedTransaction?.overpaid_amount ?? 0),
        emailSent,
        billingEmails,
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
