import { NextResponse } from "next/server";
import { createAuditLog, requireActiveStaff } from "@/lib/server/admin-audit";
import { sendOcularVisitApprovedEmail } from "@/lib/email";
import { createNotifications } from "@/lib/notifications";
import { hasPermission } from "@/lib/auth/role-access";

export async function POST(request: Request) {
  try {
    const staffContext = await requireActiveStaff();
    if (!staffContext) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
    const role = staffContext.staffUser.role;
    const { data: grants, error: grantsError } = role === "admin"
      ? { data: null, error: null }
      : await staffContext.supabase.from("role_permissions").select("permissions").eq("role", role).maybeSingle();
    if (grantsError || !hasPermission(role, grants?.permissions ?? [], "ocular_approval")) {
      return NextResponse.json({ success: false, message: "Ocular approval permission is required." }, { status: 403 });
    }

    const body = await request.json().catch(() => null) as { visitId?: unknown } | null;
    const visitId = typeof body?.visitId === "string" ? body.visitId.trim() : "";
    if (!visitId) return NextResponse.json({ success: false, message: "Select an ocular visit." }, { status: 400 });

    const { data: visit, error: visitError } = await staffContext.supabase.from("ocular_visits")
      .select("visit_id, status, reference_number, scheduled_date, time_slot_id, guest_id")
      .eq("visit_id", visitId)
      .maybeSingle<{ visit_id: string; status: string; reference_number: string; scheduled_date: string; time_slot_id: string | null; guest_id: string }>();
    if (visitError || !visit) return NextResponse.json({ success: false, message: "Ocular visit not found." }, { status: 404 });
    if (visit.status === "confirmed") return NextResponse.json({ success: true, message: "Ocular visit is already confirmed." });
    if (visit.status !== "pending") return NextResponse.json({ success: false, message: "Only pending visits can be approved." }, { status: 409 });

    const { data: slot } = visit.time_slot_id ? await staffContext.supabase.from("ocular_time_slots")
      .select("start_time, end_time").eq("slot_id", visit.time_slot_id)
      .maybeSingle<{ start_time: string; end_time: string }>() : { data: null };
    if (!slot) return NextResponse.json({ success: false, message: "The visit time slot no longer exists." }, { status: 409 });
    if (new Date(`${visit.scheduled_date}T${slot.start_time.slice(0, 5)}:00+08:00`).getTime() <= Date.now()) {
      return NextResponse.json({ success: false, message: "Past ocular visits cannot be approved." }, { status: 409 });
    }

    const { data: approvedVisit, error: updateError } = await staffContext.supabase.from("ocular_visits")
      .update({ status: "confirmed" }).eq("visit_id", visitId).eq("status", "pending")
      .select("visit_id").maybeSingle();
    if (updateError || !approvedVisit) return NextResponse.json({
      success: false, message: "This visit changed before approval. Refresh the records.",
    }, { status: updateError ? 500 : 409 });

    const { data: guest } = await staffContext.supabase.from("guests")
      .select("email, first_name, last_name").eq("id", visit.guest_id)
      .maybeSingle<{ email: string | null; first_name: string | null; last_name: string | null }>();
    if (guest?.email) {
      try {
        const sent = await sendOcularVisitApprovedEmail({
          guestEmail: guest.email,
          guestName: `${guest.first_name ?? ""} ${guest.last_name ?? ""}`.trim() || "Guest",
          referenceNumber: visit.reference_number,
          scheduledDate: visit.scheduled_date,
          timeSlot: `${slot.start_time.slice(0, 5)}-${slot.end_time.slice(0, 5)}`,
        });
        if (!sent) console.warn("Ocular visit approved, but its email was not delivered:", visitId);
      } catch (emailError) {
        console.warn("Ocular approval email failed:", emailError);
      }
    }

    try {
      const auditSuccess = await createAuditLog(staffContext, {
        action: "Approved ocular visit", entityType: "ocular_visit", entityId: visitId,
      });
      if (!auditSuccess) console.error("Ocular visit approved but audit logging failed:", visitId);
    } catch (auditError) { console.error("Ocular visit approved but audit logging failed:", auditError); }

    try { const { error: notificationError } = await createNotifications({
      actorId: staffContext.staffUser.id,
      guestId: visit.guest_id,
      title: "Ocular visit confirmed",
      message: `Ocular visit ${visit.reference_number} was confirmed.`,
      entityType: "ocular_visit", entityId: visitId, guestActionUrl: "/ocular",
    });
    if (notificationError) console.warn("Failed to notify guest of ocular approval:", notificationError);
    } catch (notificationError) { console.warn("Failed to notify guest of ocular approval:", notificationError); }
    return NextResponse.json({ success: true, message: "Ocular visit approved." });
  } catch (error) {
    console.error("Ocular approval failed:", error);
    return NextResponse.json({ success: false, message: "Unexpected error while approving ocular visit." }, { status: 500 });
  }
}
