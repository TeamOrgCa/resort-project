import { NextResponse } from "next/server";
import { createAuditLog, requireActiveStaff } from "@/lib/server/admin-audit";

interface ApproveReschedulePayload {
  rescheduleId: string;
}

interface RescheduleRequestRow {
  reschedule_id: string;
  reservation_id: string;
  status: "pending" | "approved" | "rejected";
  new_check_in: string;
  new_check_out: string;
}

interface ReservationRow {
  reservation_id: string;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "reschedule_requested";
}

interface TransactionRow {
  paid_amount: number | null;
}

const parsePayload = (value: unknown): ApproveReschedulePayload | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const payload = value as Partial<ApproveReschedulePayload>;

  if (typeof payload.rescheduleId !== "string" || !payload.rescheduleId.trim()) {
    return null;
  }

  return { rescheduleId: payload.rescheduleId.trim() };
};

const deriveReservationStatus = (paidAmount: number) => (paidAmount > 0 ? "confirmed" : "pending");

export async function POST(request: Request) {
  try {
    const staffContext = await requireActiveStaff();

    if (!staffContext) {
      return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json();
    const payload = parsePayload(body);

    if (!payload) {
      return NextResponse.json({ success: false, message: "Invalid request payload." }, { status: 400 });
    }

    const { data: requestRow, error: requestError } = await staffContext.supabase
      .from("reservation_reschedules")
      .select("reschedule_id, reservation_id, status, new_check_in, new_check_out")
      .eq("reschedule_id", payload.rescheduleId)
      .maybeSingle<RescheduleRequestRow>();

    if (requestError || !requestRow) {
      return NextResponse.json({ success: false, message: "Reschedule request not found." }, { status: 404 });
    }

    if (requestRow.status !== "pending") {
      return NextResponse.json(
        { success: false, message: "This reschedule request has already been reviewed." },
        { status: 400 }
      );
    }

    const { data: reservation, error: reservationError } = await staffContext.supabase
      .from("reservations")
      .select("reservation_id, status")
      .eq("reservation_id", requestRow.reservation_id)
      .maybeSingle<ReservationRow>();

    if (reservationError || !reservation) {
      return NextResponse.json({ success: false, message: "Reservation not found." }, { status: 404 });
    }

    const { data: transaction, error: transactionError } = await staffContext.supabase
      .from("transactions")
      .select("paid_amount")
      .eq("reservation_id", requestRow.reservation_id)
      .maybeSingle<TransactionRow>();

    if (transactionError) {
      return NextResponse.json({ success: false, message: "Unable to validate reservation billing state." }, { status: 500 });
    }

    const nextReservationStatus = deriveReservationStatus(Number(transaction?.paid_amount ?? 0));

    const { error: updateReservationError } = await staffContext.supabase
      .from("reservations")
      .update({
        check_in_date: requestRow.new_check_in,
        check_out_date: requestRow.new_check_out,
        status: nextReservationStatus,
      })
      .eq("reservation_id", requestRow.reservation_id);

    if (updateReservationError) {
      return NextResponse.json(
        { success: false, message: "Failed to update reservation dates." },
        { status: 500 }
      );
    }

    const { error: updateRequestError } = await staffContext.supabase
      .from("reservation_reschedules")
      .update({
        status: "approved",
        approved_by: staffContext.staffUser.id,
        approved_at: new Date().toISOString(),
        rejection_reason: null,
      })
      .eq("reschedule_id", requestRow.reschedule_id);

    if (updateRequestError) {
      return NextResponse.json(
        { success: false, message: "Reservation updated but reschedule request could not be marked approved." },
        { status: 500 }
      );
    }

    const auditSuccess = await createAuditLog(staffContext, {
      action: "Approved reschedule request",
      entityType: "reservation_reschedule",
      entityId: requestRow.reschedule_id,
    });

    if (!auditSuccess) {
      return NextResponse.json(
        { success: false, message: "Reschedule approved but audit logging failed." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        rescheduleId: requestRow.reschedule_id,
        reservationId: requestRow.reservation_id,
        status: "approved",
        reservation: {
          reservationId: requestRow.reservation_id,
          checkInDate: requestRow.new_check_in,
          checkOutDate: requestRow.new_check_out,
          status: nextReservationStatus,
        },
        message: "Reschedule request approved.",
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { success: false, message: "Unexpected error while approving reschedule request." },
      { status: 500 }
    );
  }
}