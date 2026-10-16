import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidPattern } from "@/lib/booking/reservation-edit";
import { createNotifications } from "@/lib/notifications";
import { sendOcularVisitReviewedEmail } from "@/lib/email";

export async function reviewOcularVisit(request: Request, action: "approve" | "reject") {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ success: false, message: "Sign in as active resort staff." }, { status: 401 });
  if (!await staffHasPermission(staff.supabase, staff.staffUser.role, "ocular_approval")) return NextResponse.json({ success: false, message: "Ocular approval permission is required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const reason = typeof body?.reviewReason === "string" ? body.reviewReason.trim() : "";
  if (!uuidPattern.test(body?.visitId ?? "") || reason.length < 5 || reason.length > 2000) return NextResponse.json({ success: false, message: "Select a visit and enter a review reason of 5 to 2,000 characters." }, { status: 400 });
  const admin = createAdminClient();
  const { data: visit, error } = await admin.rpc("review_ocular_visit", { p_visit: body.visitId, p_action: action, p_reason: reason, p_staff: staff.staffUser.id });
  if (error) return NextResponse.json({ success: false, message: ["PGRST202", "42883", "42703"].includes(error.code) ? "Apply docs/ocular-review-migration.sql before reviewing ocular visits." : ["40001", "22023", "42501", "P0002"].includes(error.code) ? error.message : "Unable to review the visit. Refresh and retry." }, { status: error.code === "42501" ? 403 : error.code === "22023" ? 400 : error.code === "P0002" ? 404 : error.code === "40001" ? 409 : 500 });
  if (!visit) return NextResponse.json({ success: false, message: "The review could not be confirmed. Refresh the calendar." }, { status: 503 });
  let notificationSent = true, emailSent = true;
  if (visit.guest_id && !visit.alreadyReviewed) {
    try {
      const result = await createNotifications({ actorId: staff.staffUser.id, guestId: visit.guest_id, title: action === "approve" ? "Ocular visit confirmed" : "Ocular visit rejected", message: `Ocular visit ${visit.reference_number} was ${action === "approve" ? "confirmed" : "rejected"}. Reason: ${reason}`, entityType: "ocular_visit", entityId: visit.visit_id, guestActionUrl: "/ocular" });
      notificationSent = !result.error;
    } catch { notificationSent = false; }
    try {
      const { data: guest } = await admin.from("guests").select("email,first_name,last_name").eq("id", visit.guest_id).maybeSingle();
      emailSent = guest?.email ? await sendOcularVisitReviewedEmail({ guestEmail: guest.email, guestName: `${guest.first_name ?? ""} ${guest.last_name ?? ""}`.trim(), referenceNumber: visit.reference_number, scheduledDate: visit.scheduled_date, approved: action === "approve", reason }) : false;
    } catch { emailSent = false; }
  }
  return NextResponse.json({ success: true, visit, notificationSent, emailSent, message: `Ocular visit ${action === "approve" ? "approved" : "rejected"}.` });
}
