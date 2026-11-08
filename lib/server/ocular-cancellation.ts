import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidPattern } from "@/lib/booking/reservation-edit";
import { createNotifications } from "@/lib/notifications";
import { sendOcularVisitCancelledEmail } from "@/lib/email";

export async function cancelManagerOcularVisit(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ success: false, message: "Sign in as active resort staff." }, { status: 401 });
  if (staff.staffUser.role !== "staff" || !await staffHasPermission(staff.supabase, staff.staffUser.role, "ocular_approval"))
    return NextResponse.json({ success: false, message: "Only an authorized manager may cancel ocular visits." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const reason = typeof body?.cancellationReason === "string" ? body.cancellationReason.trim() : "";
  if (!uuidPattern.test(body?.visitId ?? "") || reason.length < 5 || reason.length > 2000)
    return NextResponse.json({ success: false, message: "Select a visit and enter a cancellation reason of 5 to 2,000 characters." }, { status: 400 });
  const admin = createAdminClient();
  const { data: visit, error } = await admin.rpc("cancel_manager_ocular_visit", { p_visit: body.visitId, p_reason: reason, p_staff: staff.staffUser.id });
  if (error) return NextResponse.json({ success: false, message: ["PGRST202", "42883", "42703"].includes(error.code)
    ? "Apply docs/manager-ocular-cancellation-migration.sql before cancelling ocular visits." : error.message },
    { status: error.code === "42501" ? 403 : error.code === "22023" ? 400 : error.code === "P0002" ? 404 : error.code === "40001" ? 409 : 503 });
  if (!visit) return NextResponse.json({ success: false, message: "Cancellation could not be confirmed. Refresh the visit." }, { status: 503 });
  let notificationSent = true, emailSent = true;
  if (visit.guest_id && !visit.alreadyCancelled) {
    try {
      const result = await createNotifications({ actorId: staff.staffUser.id, guestId: visit.guest_id, staffRoles: ["admin", "staff"],
        title: "Ocular visit cancelled", message: `Ocular visit ${visit.reference_number} was cancelled by the manager. Reason: ${reason}`,
        entityType: "ocular_visit", entityId: visit.visit_id, guestActionUrl: "/manage", staffActionUrl: "/admin/records?tab=ocular" });
      notificationSent = !result.error;
    } catch { notificationSent = false; }
    try {
      const { data: guest } = await admin.from("guests").select("email,first_name,last_name").eq("id", visit.guest_id).maybeSingle();
      const { data: slot } = visit.time_slot_id ? await admin.from("ocular_time_slots").select("start_time,end_time").eq("slot_id", visit.time_slot_id).maybeSingle() : { data: null };
      emailSent = guest?.email ? await sendOcularVisitCancelledEmail({ guestEmail: guest.email,
        guestName: `${guest.first_name ?? ""} ${guest.last_name ?? ""}`.trim() || "Guest", referenceNumber: visit.reference_number,
        scheduledDate: visit.scheduled_date, timeSlot: slot ? `${slot.start_time} - ${slot.end_time}` : "See your visit details", cancellationReason: reason }) : false;
    } catch { emailSent = false; }
  }
  return NextResponse.json({ success: true, visit, visitId: visit.visit_id, status: "cancelled", cancellationReason: reason, notificationSent, emailSent,
    message: "Ocular visit cancelled. The reason is saved with the visit." });
}
