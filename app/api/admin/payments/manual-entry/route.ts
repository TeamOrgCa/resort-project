import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { createNotifications } from "@/lib/notifications";
import { emailBillingDocuments, type BillingEmailResult } from "@/lib/server/billing-email";
import { sendReservationConfirmedEmail } from "@/lib/email";
import { isValidPaymentAmount } from "@/lib/booking/payment-policy";
import { MAX_PAYMENT_PROOF_BYTES, PAYMENT_PROOF_BUCKET } from "@/lib/booking/payment-proof";
import { normalizeSenderName, SENDER_NAME_ERROR } from "@/lib/validation/sender-name";

type ManualPaymentMethod = "bank_transfer" | "e_wallet" | "cash" | "non_cash";

interface ManualPaymentPayload {
  reservationId: string;
  amount: number;
  paymentMethod: ManualPaymentMethod;
  paymentReference: string;
  paymentMethodId?: string;
  fundsReceived?: boolean;
  accountName?: string;
  accountNumber?: string;
  proofPath?: string;
  expectedBalance?: number;
  cashReceived?: boolean;
}

interface ReservationRow {
  reservation_id: string;
  guest_id: string | null;
  walk_in_guest_id: string | null;
  reference_number: string;
  start_datetime: string;
  end_datetime: string;
  status: "pending" | "confirmed" | "cancelled" | "completed";
}

const parsePayload = (value: unknown): ManualPaymentPayload | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const payload = value as Partial<ManualPaymentPayload>;

  if (
    typeof payload.reservationId !== "string" ||
    typeof payload.amount !== "number" ||
    !Number.isFinite(payload.amount) || payload.amount <= 0 ||
    typeof payload.paymentReference !== "string" ||
    !payload.paymentReference.trim() ||
    (payload.paymentMethod !== "bank_transfer" && payload.paymentMethod !== "e_wallet" && payload.paymentMethod !== "cash" && payload.paymentMethod !== "non_cash")
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
    expectedBalance: typeof payload.expectedBalance === "number" ? payload.expectedBalance : undefined,
    cashReceived: payload.cashReceived === true,
    fundsReceived: payload.fundsReceived === true,
    paymentMethodId: typeof payload.paymentMethodId === "string" ? payload.paymentMethodId.trim() : undefined,
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

    if (!(await staffHasPermission(staffContext.supabase, staffContext.staffUser.role, "payment_entry"))) {
      return NextResponse.json({ success: false, message: "Payment entry permission required." }, { status: 403 });
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

    if (payload.paymentMethod === "cash") {
      if (!isValidPaymentAmount(payload.amount) || !isValidPaymentAmount(payload.expectedBalance ?? 0) || !payload.cashReceived) {
        return NextResponse.json({ success: false, message: "Enter a valid cash amount and confirm that the cash was received." }, { status: 400 });
      }
      const { data, error } = await staffContext.supabase.rpc("record_staff_cash_payment", {
        p_reservation: payload.reservationId, p_amount: payload.amount, p_reference: payload.paymentReference,
        p_expected_balance: payload.expectedBalance, p_received: payload.cashReceived,
      });
      if (error || !data) {
        const code = error?.code ?? "NO_RESULT";
        console.error("Staff cash payment failed", {
          code, message: error?.message, details: error?.details, hint: error?.hint,
          reservationId: payload.reservationId, paymentReference: payload.paymentReference,
        });
        const status = error?.code === "42501" ? 403 : error?.code === "P0002" ? 404
          : error?.code === "40001" || error?.code === "23505" ? 409
            : error?.code === "22023" || error?.code === "23514" ? 400 : 503;
        const missingRpc = code === "PGRST202" || (code === "42883" && /record_staff_cash_payment/i.test(error?.message ?? ""));
        let message: string;
        if (missingRpc) {
          message = "The cash-payment function is unavailable to the API. If the migration is already installed, run NOTIFY pgrst, 'reload schema'; in the same Supabase project's SQL editor, then retry with the same cash reference.";
        } else if (status < 500 || code === "55000") {
          message = error?.message ?? "Cash payment could not be recorded.";
        } else if (["42P01", "42703", "42883"].includes(code)) {
          message = "Cash payment reached the database, but a required table, column or function is missing. Check the server log for the exact dependency and apply its billing migration. Retry with the same cash reference afterward.";
        } else {
          message = "Cash payment could not be confirmed. Check the server log for the database error and retry with the same cash reference; do not create a new payment reference.";
        }
        return NextResponse.json({ success: false, errorCode: code, message: `${message} (Error ${code})` }, { status });
      }
      let billingEmails: BillingEmailResult = { receiptSent: false, invoiceSent: false };
      let emailSent = false;
      if (!data.alreadyRecorded) {
        try { billingEmails = await emailBillingDocuments(staffContext.supabase, data.reservation, data.payment.payment_id, Number(data.payment.amount)); }
        catch (cause) {
          console.warn("Cash was recorded, but billing email delivery failed.", cause);
          billingEmails.error = "Receipt and invoice email delivery failed. Check the server log; the cash payment was saved.";
        }
        // The cash RPC returns its original reservation snapshot. Read the
        // committed status after payment triggers before confirming the booking.
        let confirmedReservation: ReservationRow | null = null;
        try {
          const { data: current, error: lookupError } = await staffContext.supabase.from("reservations")
            .select("reservation_id,guest_id,walk_in_guest_id,reference_number,start_datetime,end_datetime,status")
            .eq("reservation_id", payload.reservationId).maybeSingle<ReservationRow>();
          if (lookupError) throw lookupError;
          if (current?.status === "confirmed") confirmedReservation = current;
          if (confirmedReservation) {
            const guestQuery = confirmedReservation.guest_id
              ? staffContext.supabase.from("guests").select("email,first_name,last_name").eq("id", confirmedReservation.guest_id)
              : confirmedReservation.walk_in_guest_id
                ? staffContext.supabase.from("walk_in_guests").select("email,first_name,last_name").eq("walk_in_guest_id", confirmedReservation.walk_in_guest_id)
                : null;
            if (guestQuery) {
              const { data: guest, error: guestError } = await guestQuery.maybeSingle();
              if (guestError) throw guestError;
              if (guest?.email) emailSent = await sendReservationConfirmedEmail({
                guestEmail: guest.email,
                guestName: `${guest.first_name ?? ""} ${guest.last_name ?? ""}`.replace(/\s+/g, " ").trim() || "Guest",
                reservationReference: confirmedReservation.reference_number,
                checkInDate: confirmedReservation.start_datetime,
                checkOutDate: confirmedReservation.end_datetime,
              });
            }
          }
        } catch (cause) { console.warn("Cash was recorded, but reservation confirmation email delivery failed.", cause); }
        if (confirmedReservation?.guest_id) {
          try {
            const { error: notificationError } = await createNotifications({ actorId: staffContext.staffUser.id,
              guestId: confirmedReservation.guest_id, title: "Reservation confirmed",
              message: `Your reservation ${confirmedReservation.reference_number} is confirmed. Your cash payment has been received. Remaining balance: PHP ${Number(data.remainingBalance).toFixed(2)}.`,
              entityType: "reservation", entityId: confirmedReservation.reservation_id, guestActionUrl: "/manage" });
            if (notificationError) console.warn("Cash reservation confirmation notification failed.", notificationError);
          } catch (cause) { console.warn("Cash was recorded, but its reservation confirmation notification could not be delivered.", cause); }
        }
        if (data.reservation.guest_id) {
          try { await createNotifications({ actorId: staffContext.staffUser.id, guestId: data.reservation.guest_id,
            title: "Cash payment recorded", message: `The resort recorded your cash payment. Remaining balance: PHP ${Number(data.remainingBalance).toFixed(2)}.`,
            entityType: "payment", entityId: data.payment.payment_id, guestActionUrl: "/manage" }); }
          catch (cause) { console.warn("Cash was recorded, but its notification could not be delivered.", cause); }
        }
      }
      return NextResponse.json({ success: true, payment: data.payment, receipt: data.receipt,
        reservationId: payload.reservationId, remainingBalance: Number(data.remainingBalance), overpaidAmount: Number(data.overpaidAmount ?? 0),
        alreadyRecorded: data.alreadyRecorded, emailSent, billingEmails,
        message: data.alreadyRecorded ? "This cash payment was already recorded. No duplicate payment was created." : "Cash payment recorded and receipt issued." }, { status: data.alreadyRecorded ? 200 : 201 });
    }

    {
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

    const senderName = normalizeSenderName(payload.accountName);
    if (!senderName) return NextResponse.json({ success: false, message: SENDER_NAME_ERROR }, { status: 400 });
    payload.accountName = senderName;

    if (!["staff", "cashier"].includes(staffContext.staffUser.role)) {
      return NextResponse.json({ success: false, message: "Authorized staff payment entry is required." }, { status: 403 });
    }

    if (!isValidPaymentAmount(payload.amount) || !isValidPaymentAmount(payload.expectedBalance ?? 0) || !payload.fundsReceived) {
      return NextResponse.json({ success: false, message: "Enter a valid amount and confirm the actual funds were received." }, { status: 400 });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.paymentMethodId ?? "")) {
      return NextResponse.json({ success: false, message: "Select an active payment method from the catalog." }, { status: 400 });
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9 -]{5,99}$/.test(payload.paymentReference) || !/^[0-9]{6,20}$/.test(payload.accountNumber ?? "")) {
      return NextResponse.json({ success: false, message: "Enter the real transaction reference (6-100 letters/digits) and sender account number (6-20 digits)." }, { status: 400 });
    }
    if (!payload.proofPath?.startsWith(`${staffContext.staffUser.id}/staff/`) || payload.proofPath.includes("..")) {
      return NextResponse.json({ success: false, message: "Upload payment proof using your current staff account." }, { status: 400 });
    }
    const { data: proof, error: proofError } = await staffContext.supabase.storage.from(PAYMENT_PROOF_BUCKET).download(payload.proofPath);
    if (proofError || !proof || proof.size < 1 || proof.size > MAX_PAYMENT_PROOF_BYTES) {
      return NextResponse.json({ success: false, message: "Upload valid payment proof up to 8 MB." }, { status: 400 });
    }
    const bytes = Buffer.from(await proof.arrayBuffer());
    const signatures: Record<string, boolean> = {
      "application/pdf": bytes.subarray(0, 5).toString() === "%PDF-",
      "image/jpeg": bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
      "image/png": bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      "image/webp": bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP",
    };
    if (!signatures[proof.type]) return NextResponse.json({ success: false, message: "Proof must be a valid JPEG, PNG, WebP or PDF file." }, { status: 400 });
    const { data, error } = await staffContext.supabase.rpc("record_staff_payment", {
      p_reservation: payload.reservationId, p_amount: payload.amount, p_reference: payload.paymentReference,
      p_expected_balance: payload.expectedBalance, p_method: payload.paymentMethodId, p_received: payload.fundsReceived,
      p_account_name: payload.accountName, p_account_number: payload.accountNumber, p_proof: payload.proofPath,
    });
    if (error || !data) {
      const code = error?.code ?? "NO_RESULT";
      console.error("Staff payment entry failed", { code, message: error?.message, reservationId: payload.reservationId });
      const status = code === "42501" ? 403 : code === "P0002" ? 404 : ["40001", "23505"].includes(code) ? 409 : ["22023", "23514"].includes(code) ? 400 : 503;
      const message = status < 500 ? error?.message ?? "Payment could not be recorded."
        : "Payment recording could not be confirmed. Check the ledger and retry with the same transaction reference; contact the administrator if this continues.";
      return NextResponse.json({ success: false, errorCode: code, message }, { status });
    }
    let billingEmails: BillingEmailResult = { receiptSent: false, invoiceSent: false };
    let emailSent = false;
    if (!data.alreadyRecorded) {
      try { billingEmails = await emailBillingDocuments(staffContext.supabase, data.reservation, data.payment.payment_id, Number(data.payment.amount)); }
      catch (cause) { console.warn("Payment recorded; billing email delivery failed.", cause); billingEmails.error = "Billing email delivery failed; the payment was saved."; }
      if (data.reservationConfirmed) {
        try {
          const reservation = data.reservation as ReservationRow;
          const guestQuery = reservation.guest_id
            ? staffContext.supabase.from("guests").select("email,first_name,last_name").eq("id", reservation.guest_id)
            : reservation.walk_in_guest_id ? staffContext.supabase.from("walk_in_guests").select("email,first_name,last_name").eq("walk_in_guest_id", reservation.walk_in_guest_id) : null;
          if (guestQuery) {
            const { data: guest } = await guestQuery.maybeSingle();
            if (guest?.email) emailSent = await sendReservationConfirmedEmail({ guestEmail: guest.email,
              guestName: `${guest.first_name ?? ""} ${guest.last_name ?? ""}`.trim() || "Guest",
              reservationReference: reservation.reference_number, checkInDate: reservation.start_datetime, checkOutDate: reservation.end_datetime });
          }
        } catch (cause) { console.warn("Payment recorded; booking confirmation delivery failed.", cause); }
      }
      if (data.reservation.guest_id) {
        try { await createNotifications({ actorId: staffContext.staffUser.id, guestId: data.reservation.guest_id,
          title: "Payment recorded", message: `The resort recorded your payment. Remaining balance: PHP ${Number(data.remainingBalance).toFixed(2)}.`,
          entityType: "payment", entityId: data.payment.payment_id, guestActionUrl: "/manage" }); }
        catch (cause) { console.warn("Payment recorded; notification delivery failed.", cause); }
      }
    }
    return NextResponse.json({ success: true, payment: data.payment, receipt: data.receipt,
      reservationId: payload.reservationId, remainingBalance: Number(data.remainingBalance), overpaidAmount: Number(data.overpaidAmount ?? 0),
      alreadyRecorded: data.alreadyRecorded, billingEmails, emailSent,
      message: data.alreadyRecorded ? "This payment was already recorded. No duplicate payment was created." : "Payment recorded and receipt issued.",
    }, { status: data.alreadyRecorded ? 200 : 201 });
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
