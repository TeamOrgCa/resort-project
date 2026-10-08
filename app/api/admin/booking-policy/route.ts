import { NextResponse } from "next/server";
import { requireAdminStaff } from "@/lib/server/admin-audit";
import type { BookingPolicy } from "@/lib/booking/booking-policy";

export async function GET() {
  const staff = await requireAdminStaff();
  if (!staff) return NextResponse.json({ message: "Admin access required." }, { status: 403 });
  const { data: policy, error } = await staff.supabase.rpc("get_booking_policy", { p_version: null }).maybeSingle<BookingPolicy>();
  if (error || !policy) return NextResponse.json({ message: error?.message ?? "Booking policy is not configured. Apply the policy migration first." }, { status: 500 });
  const { data: history, error: historyError } = await staff.supabase.from("booking_policy_versions")
    .select("version, cancellation_text, refund_text, refund_review_enabled, guest_cancellation_notice_hours, created_at, created_by")
    .order("version", { ascending: false }).limit(20);
  if (historyError) return NextResponse.json({ message: historyError.message }, { status: 500 });
  return NextResponse.json({ policy, history });
}

export async function POST(request: Request) {
  const staff = await requireAdminStaff();
  if (!staff) return NextResponse.json({ message: "Admin access required." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const cancellationText = typeof body?.cancellationText === "string" ? body.cancellationText.trim() : "";
  const refundText = typeof body?.refundText === "string" ? body.refundText.trim() : "";
  const noticeHours = body?.noticeHours;
  const refundReviewEnabled = body?.refundReviewEnabled;
  const expectedVersion = body?.expectedVersion;
  if (cancellationText.length < 20 || cancellationText.length > 5000 ||
      refundText.length < 20 || refundText.length > 5000 ||
      !Number.isInteger(noticeHours) || Number(noticeHours) < 0 || Number(noticeHours) > 8760 ||
      typeof refundReviewEnabled !== "boolean" ||
      !Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) {
    return NextResponse.json({ message: "Enter both policy descriptions and a valid cancellation notice window." }, { status: 400 });
  }
  const { data: version, error } = await staff.supabase.rpc("publish_booking_policy", {
    p_cancellation_text: cancellationText,
    p_refund_text: refundText,
    p_notice_hours: noticeHours,
    p_refund_review_enabled: refundReviewEnabled,
    p_expected_version: expectedVersion,
  });
  if (error) return NextResponse.json({ message: error.message }, { status: error.code === "40001" ? 409 : 500 });
  return NextResponse.json({ version });
}
