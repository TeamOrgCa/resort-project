import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { uuidPattern } from "@/lib/booking/reservation-edit";
import { cancellationMessage, type CancellationPreview } from "@/lib/booking/cancellation";
import { cancellationEmail, workflowErrorMessage, workflowErrorStatus } from "@/lib/server/cancellation";

async function authorized() {
  const staff = await requireActiveStaff();
  if (!staff) return { error: NextResponse.json({ message: "Sign in as active staff." }, { status: 401 }) };
  if (!await staffHasPermission(staff.supabase, staff.staffUser.role, "cancel_reservation")) return { error: NextResponse.json({ message: "Cancellation permission required." }, { status: 403 }) };
  return { staff };
}
export async function GET(request: Request) {
  const context = await authorized(); if (context.error) return context.error;
  const { staff } = context;
  const params = new URL(request.url).searchParams, id = params.get("reservationId") ?? "", initiator = params.get("initiator") ?? "guest";
  if (!uuidPattern.test(id) || !["guest", "resort"].includes(initiator)) return NextResponse.json({ message: "Select a valid cancellation." }, { status: 400 });
  if (initiator === "resort" && staff.staffUser.role !== "admin") return NextResponse.json({ message: "Only administrators can cancel for resort-attributable reasons." }, { status: 403 });
  const { data, error } = await staff.supabase.rpc("get_cancellation_preview", { p_reservation: id, p_initiator: initiator });
  if (error) return NextResponse.json({ message: workflowErrorMessage(error) }, { status: workflowErrorStatus(error.code) });
  return NextResponse.json({ preview: data }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const context = await authorized(); if (context.error) return context.error;
  const { staff } = context;
  const body = await request.json().catch(() => null);
  if (!uuidPattern.test(body?.reservationId ?? "") || !["guest", "resort"].includes(body?.initiator) ||
    typeof body?.cancellationReason !== "string" || body.cancellationReason.trim().length < 5 || body.cancellationReason.length > 2000 ||
    typeof body?.quote !== "string" || !/^[a-f0-9]{32}$/.test(body.quote)) return NextResponse.json({ message: "Choose who initiated cancellation, enter a reason and review the refund preview." }, { status: 400 });
  if (body.initiator === "resort" && staff.staffUser.role !== "admin") return NextResponse.json({ message: "Only administrators can cancel for resort-attributable reasons." }, { status: 403 });
  const { data, error } = await staff.supabase.rpc("cancel_reservation_evaluated", { p_reservation: body.reservationId,
    p_reason: body.cancellationReason.trim(), p_initiator: body.initiator, p_expected_quote: body.quote });
  if (error) return NextResponse.json({ message: workflowErrorMessage(error) }, { status: workflowErrorStatus(error.code) });
  const result = data as CancellationPreview & { refundId: string | null };
  const emailSent = await cancellationEmail(staff.supabase, body.reservationId, body.cancellationReason.trim(), result);
  return NextResponse.json({ success: true, ...result, emailSent, message: cancellationMessage(result) });
}
