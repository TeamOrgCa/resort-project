import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createNotifications } from "@/lib/notifications";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ message: "Please log in to view refunds." }, { status: 401 });
  const { data, error } = await supabase.rpc("get_guest_refund_overview");
  if (error) {
    console.error("[refund] Unable to load guest refunds", error);
    return NextResponse.json({ message: "Unable to load refund details. Please try again later." }, { status: 503 });
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ message: "Please log in to request a refund." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (typeof body?.reservationId !== "string" || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(body.reservationId)) {
    return NextResponse.json({ message: "Select a valid reservation." }, { status: 400 });
  }
  // The authenticated RPC checks ownership, locks the bill, and calculates the
  // refundable excess. An amount supplied by the browser is never trusted.
  const { data: refundId, error } = await supabase.rpc("request_overpayment_refund", { p_reservation: body.reservationId });
  if (error || !refundId) {
    const status = error?.code === "42501" ? 403 : error?.code === "40001" || error?.code === "23505" ? 409 : error?.code === "22023" ? 400 : 503;
    return NextResponse.json({ message: status === 503 ? "Refund requests are temporarily unavailable. Please try again later." : error?.message }, { status });
  }
  try {
    const notice = await createNotifications({ actorId: user.id, guestId: user.id, staffRoles: ["admin", "staff"],
      title: "Excess payment refund requested", message: "An excess-payment refund request is awaiting staff review.",
      entityType: "refund_request", entityId: refundId, guestActionUrl: "/manage", staffActionUrl: "/admin/transactions" });
    if (notice.error) console.warn("[refund] Notification failed", notice.error);
  } catch (error) { console.warn("[refund] Notification failed", error); }
  return NextResponse.json({ success: true, refundId, message: "Your excess refund request is pending staff review." }, { status: 201 });
}
