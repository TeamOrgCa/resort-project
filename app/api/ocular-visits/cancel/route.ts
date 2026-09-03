import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notifyGuestAndStaff } from "@/lib/notifications";
import { sendOcularVisitCancelledEmail } from "@/lib/email";

interface CancelPayload {
  visitId: string;
  referenceNumber?: string;
}

interface OcularVisitRow {
  visit_id: string;
  guest_id: string | null;
  reference_number: string;
  scheduled_date: string;
  time_slot_id: string | null;
  ocular_time_slots: { start_time: string; end_time: string } | { start_time: string; end_time: string }[] | null;
  status: "pending" | "confirmed" | "cancelled" | "completed";
}

const parsePayload = (value: unknown): CancelPayload | null => {
  if (typeof value !== "object" || value === null) return null;
  const p = value as Partial<CancelPayload>;

  const visitId = typeof p.visitId === "string" ? p.visitId.trim() : "";
  const referenceNumber = typeof p.referenceNumber === "string" ? p.referenceNumber.trim() : "";

  if (!visitId && !referenceNumber) return null;

  return {
    visitId,
    referenceNumber: referenceNumber || undefined,
  };
};

const getSlotLabel = (slot: OcularVisitRow["ocular_time_slots"]) => {
  const value = Array.isArray(slot) ? slot[0] : slot;
  return value ? `${value.start_time}-${value.end_time}` : "-";
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const payload = parsePayload(body);

    console.log("[ocular-cancel] incoming payload", {
      hasVisitId: Boolean(payload?.visitId),
      hasReferenceNumber: Boolean(payload?.referenceNumber),
      visitId: payload?.visitId ?? null,
      referenceNumber: payload?.referenceNumber ?? null,
    });

    if (!payload) {
      console.warn("[ocular-cancel] rejected payload: invalid shape", body);
      return NextResponse.json({ success: false, message: "Invalid payload." }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
    }

    let ocularQuery = supabase
      .from("ocular_visits")
      .select("visit_id, guest_id, reference_number, scheduled_date, time_slot_id, status, ocular_time_slots(start_time, end_time)");

    if (payload.visitId) {
      ocularQuery = ocularQuery.eq("visit_id", payload.visitId);
    } else if (payload.referenceNumber) {
      ocularQuery = ocularQuery.eq("reference_number", payload.referenceNumber);
    }

    const { data: ocularVisit, error: ocularError } = await ocularQuery.maybeSingle<OcularVisitRow>();

    if (ocularError || !ocularVisit) {
      console.warn("[ocular-cancel] visit lookup failed", {
        error: ocularError?.message ?? null,
        visitId: payload.visitId || null,
        referenceNumber: payload.referenceNumber || null,
        userId: user.id,
      });
      return NextResponse.json({ success: false, message: "Ocular visit not found." }, { status: 404 });
    }

    // Only allow the guest who created the visit to cancel it (walk-in uses walk_in_guest_id)
    if (ocularVisit.guest_id !== user.id) {
      return NextResponse.json({ success: false, message: "Forbidden." }, { status: 403 });
    }

    if (ocularVisit.status === "cancelled") {
      return NextResponse.json({ success: false, message: "Ocular visit is already cancelled." }, { status: 400 });
    }

    if (ocularVisit.status === "completed") {
      return NextResponse.json({ success: false, message: "Completed ocular visits can no longer be cancelled." }, { status: 400 });
    }

    const { error: updateError } = await supabase
      .from("ocular_visits")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancellation_reason: "Guest requested for cancellation" })
      .eq("visit_id", ocularVisit.visit_id);

    if (updateError) {
      return NextResponse.json({ success: false, message: "Failed to cancel ocular visit." }, { status: 500 });
    }

    // Notify staff and guest + attempt to send email
    try {
      await notifyGuestAndStaff(supabase, {
        actorId: user.id,
        guestId: user.id,
        title: "Ocular visit cancelled",
        message: `Ocular visit ${ocularVisit.reference_number} was cancelled by guest.`,
        entityType: "ocular_visit",
        entityId: ocularVisit.visit_id,
        guestActionUrl: "/ocular",
        staffActionUrl: "/admin/reservations",
      });

      await sendOcularVisitCancelledEmail({
        guestEmail: user.email ?? "",
        guestName: user.user_metadata?.full_name || user.user_metadata?.name || "Guest",
        referenceNumber: ocularVisit.reference_number,
        scheduledDate: ocularVisit.scheduled_date,
        timeSlot: getSlotLabel(ocularVisit.ocular_time_slots),
        cancellationReason: "Guest requested for cancellation",
      });
    } catch (e) {
      // non-fatal
      console.warn("Notification/email failed for ocular cancel:", e);
    }

    return NextResponse.json({ success: true, visitId: ocularVisit.visit_id, status: "cancelled" }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, message: "Unexpected error while cancelling ocular visit." }, { status: 500 });
  }
}
