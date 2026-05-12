import { NextResponse } from "next/server";
import { createAuditLog, requireActiveStaff } from "@/lib/server/admin-audit";
import { sendOcularVisitCancelledEmail } from "@/lib/email";

const cancellationReasons = [
  "Guest requested for cancellation",
  "Schedule conflict",
  "Emergency Situation",
] as const;

type CancellationReason = (typeof cancellationReasons)[number];

interface CancelOcularPayload {
  visitId: string;
  cancellationReason: CancellationReason;
}

interface OcularVisitRow {
  visit_id: string;
  guest_id: string | null;
  reference_number: string;
  scheduled_date: string;
  time_slot: string;
  status: "pending" | "confirmed" | "cancelled" | "completed";
}

interface GuestEmailRow {
  email: string;
  first_name: string | null;
  last_name: string | null;
}

const parsePayload = (value: unknown): CancelOcularPayload | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const payload = value as Partial<CancelOcularPayload>;

  if (typeof payload.visitId !== "string" || !payload.visitId.trim()) {
    return null;
  }

  if (
    typeof payload.cancellationReason !== "string" ||
    !cancellationReasons.includes(payload.cancellationReason as CancellationReason)
  ) {
    return null;
  }

  return {
    visitId: payload.visitId.trim(),
    cancellationReason: payload.cancellationReason as CancellationReason,
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
          message: "Invalid cancellation payload.",
        },
        { status: 400 }
      );
    }

    const { data: ocularVisit, error: ocularError } = await staffContext.supabase
      .from("ocular_visits")
      .select(`
        visit_id,
        guest_id,
        walk_in_guest_id,
        reference_number,
        scheduled_date,
        time_slot,
        status
      `)
      .eq("visit_id", payload.visitId)
      .maybeSingle<OcularVisitRow>();

    if (ocularError || !ocularVisit) {
      return NextResponse.json(
        {
          success: false,
          message: "Ocular visit not found.",
        },
        { status: 404 }
      );
    }

    if (ocularVisit.status === "cancelled") {
      return NextResponse.json(
        {
          success: false,
          message: "Ocular visit is already cancelled.",
        },
        { status: 400 }
      );
    }

    if (ocularVisit.status === "completed") {
      return NextResponse.json(
        {
          success: false,
          message: "Completed ocular visits can no longer be cancelled.",
        },
        { status: 400 }
      );
    }

    const { error: cancelError } = await staffContext.supabase
      .from("ocular_visits")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: payload.cancellationReason,
      })
      .eq("visit_id", ocularVisit.visit_id);

    if (cancelError) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to cancel ocular visit.",
        },
        { status: 500 }
      );
    }

    const auditSuccess = await createAuditLog(staffContext, {
      action: `Cancelled ocular visit (cancellation_reason: ${payload.cancellationReason})`,
      entityType: "ocular_visit",
      entityId: ocularVisit.visit_id,
    });

    if (!auditSuccess) {
      return NextResponse.json(
        {
          success: false,
          message: "Ocular visit cancelled but audit logging failed.",
        },
        { status: 500 }
      );
    }

    let emailSent = false;

    const guestLookup = ocularVisit.guest_id
      ? staffContext.supabase
          .from("guests")
          .select("email, first_name, last_name")
          .eq("id", ocularVisit.guest_id)
          .maybeSingle<GuestEmailRow>()
      : Promise.resolve({ data: null, error: null });

    const { data: guest } = await guestLookup;

    if (guest?.email) {
      emailSent = await sendOcularVisitCancelledEmail({
        guestEmail: guest.email,
        guestName:
          `${guest.first_name ?? ""} ${guest.last_name ?? ""}`
            .replace(/\s+/g, " ")
            .trim() || "Guest",
        referenceNumber: ocularVisit.reference_number,
        scheduledDate: ocularVisit.scheduled_date,
        timeSlot: ocularVisit.time_slot,
        cancellationReason: payload.cancellationReason,
      });
    }

    return NextResponse.json(
      {
        success: true,
        visitId: ocularVisit.visit_id,
        status: "cancelled",
        cancellationReason: payload.cancellationReason,
        emailSent,
        message: emailSent
          ? "Ocular visit cancelled successfully and email sent."
          : "Ocular visit cancelled successfully.",
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while cancelling ocular visit.",
      },
      { status: 500 }
    );
  }
}