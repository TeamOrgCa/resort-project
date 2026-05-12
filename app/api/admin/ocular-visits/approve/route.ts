import { NextResponse } from "next/server";
import { createAuditLog, requireActiveStaff } from "@/lib/server/admin-audit";
import { sendOcularVisitApprovedEmail } from "@/lib/email";

interface ApproveOcularVisitPayload {
  visitId: string;
}

const parsePayload = (value: unknown): ApproveOcularVisitPayload | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const payload = value as Partial<ApproveOcularVisitPayload>;

  if (typeof payload.visitId !== "string" || !payload.visitId.trim()) {
    return null;
  }

  return {
    visitId: payload.visitId.trim(),
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

    const { data: visit, error: visitError } = await staffContext.supabase
  .from("ocular_visits")
  .select(`
    visit_id,
    status,
    reference_number,
    scheduled_date,
    time_slot,
    guest_id,
    guest:guest_id (
      email,
      first_name,
      last_name
    )
  `)
  .eq("visit_id", payload.visitId)
  .maybeSingle<{
    visit_id: string;
    status: string;
    reference_number: string;
    scheduled_date: string;
    time_slot: string;
    guest_id: string;
    guest: {
      email: string | null;
      first_name: string | null;
      last_name: string | null;
    } | null;
  }>();

      if (visitError) {
      console.error(visitError);
    }

    if (visitError || !visit) {
      return NextResponse.json(
        {
          success: false,
          message: "Ocular visit not found.",
        },
        { status: 404 }
      );
    }

    if (visit.status === "cancelled") {
      return NextResponse.json(
        {
          success: false,
          message: "Cancelled visits cannot be approved.",
        },
        { status: 400 }
      );
    }

    if (visit.status !== "confirmed") {
  const { error: updateError } = await staffContext.supabase
    .from("ocular_visits")
    .update({ status: "confirmed" })
    .eq("visit_id", payload.visitId);

  if (updateError) {
    return NextResponse.json(
      {
        success: false,
        message: "Failed to approve ocular visit.",
      },
      { status: 500 }
    );
  }
}

if (visit.guest?.email) {
  await sendOcularVisitApprovedEmail({
    guestEmail: visit.guest.email,
    guestName:
  `${visit.guest.first_name ?? ""} ${visit.guest.last_name ?? ""}`.trim() ||
  "Guest",
    referenceNumber: visit.reference_number,
    scheduledDate: visit.scheduled_date,
    timeSlot: visit.time_slot,
  });
}

    

    const auditSuccess = await createAuditLog(staffContext, {
      action: "Approved ocular visit",
      entityType: "ocular_visit",
      entityId: payload.visitId,
    });

    if (!auditSuccess) {
      return NextResponse.json(
        {
          success: false,
          message: "Ocular visit approved but audit logging failed.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: "Ocular visit approved." }, { status: 200 });
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while approving ocular visit.",
      },
      { status: 500 }
    );
  }
}
