import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";

export async function POST(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff || !await staffHasPermission(staff.supabase, staff.staffUser.role, "analytics")
    || !await staffHasPermission(staff.supabase, staff.staffUser.role, "feedback_moderation")) {
    return NextResponse.json({ message: "Review moderation requires an administrator or a manager with Analytics and review moderation permissions." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body.reviewId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.reviewId)
    || typeof body.approve !== "boolean" || typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.length > 500
    || typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) {
    return NextResponse.json({ message: "Select a pending review and enter a reason of 3 to 500 characters." }, { status: 400 });
  }
  const { data, error } = await staff.supabase.rpc("moderate_guest_review", {
    p_review: body.reviewId, p_approve: body.approve, p_reason: body.reason.trim(), p_expected_updated_at: body.expectedUpdatedAt,
  });
  if (error) return NextResponse.json({ message: ["PGRST202", "42883"].includes(error.code) ? "Apply docs/review-moderation-permissions-migration.sql before moderating reviews." : error.message },
    { status: error.code === "42501" ? 403 : error.code === "40001" ? 409 : error.code === "P0002" ? 404 : error.code === "22023" ? 400 : 503 });
  return NextResponse.json({ success: true, review: data, message: body.approve ? "Review approved and published with its attachment." : "Review rejected and archived. It remains hidden from the public." });
}
