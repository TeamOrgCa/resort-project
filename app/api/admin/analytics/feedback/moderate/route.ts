import { NextResponse } from "next/server";
import { requireAdminStaff } from "@/lib/server/admin-audit";

export async function POST(request: Request) {
  const staff = await requireAdminStaff();
  if (!staff) return NextResponse.json({ message: "Administrator access is required to moderate reviews." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.reviewId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.reviewId)
    || typeof body.approve !== "boolean" || typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.length > 500
    || typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) {
    return NextResponse.json({ message: "Select a pending review and enter a reason of 3 to 500 characters." }, { status: 400 });
  }
  const { data, error } = await staff.supabase.rpc("moderate_guest_review", {
    p_review: body.reviewId, p_approve: body.approve, p_reason: body.reason.trim(), p_expected_updated_at: body.expectedUpdatedAt,
  });
  if (error) return NextResponse.json({ message: ["PGRST202", "42883"].includes(error.code) ? "Apply the review attachment moderation migration before moderating reviews." : error.message },
    { status: error.code === "42501" ? 403 : error.code === "40001" ? 409 : error.code === "P0002" ? 404 : error.code === "22023" ? 400 : 503 });
  return NextResponse.json({ success: true, review: data, message: body.approve ? "Review approved and published with its attachment." : "Review rejected and archived. It remains hidden from the public." });
}
