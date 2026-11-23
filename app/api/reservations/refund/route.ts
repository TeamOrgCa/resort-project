import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createNotifications } from "@/lib/notifications";
import { uuidPattern } from "@/lib/booking/reservation-edit";

export async function PATCH(request: Request) {
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return NextResponse.json({ message: "Sign in to submit refund payment details." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!uuidPattern.test(body?.refundId ?? "") || typeof body?.method !== "string" || body.method.length > 120 ||
    typeof body.accountName !== "string" || body.accountName.trim().length < 2 || body.accountName.length > 120 ||
    typeof body.accountNumber !== "string" || body.accountNumber.trim().length < 3 || body.accountNumber.length > 120) {
    return NextResponse.json({ message: "Provide a payment method, account name and account number." }, { status: 400 });
  }
  const { error } = await client.rpc("submit_refund_destination", { p_refund: body.refundId, p_method: body.method,
    p_name: body.accountName.trim(), p_number: body.accountNumber.trim() });
  if (error) return NextResponse.json({ message: error.message }, { status: error.code === "42501" ? 403 : error.code === "40001" ? 409 : error.code === "22023" ? 400 : 503 });
  return NextResponse.json({ success: true, message: "Payment details sent. Staff will review them before transferring your refund." });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ message: "Please log in to view refunds." }, { status: 401 });
  const { data, error } = await supabase.rpc("get_guest_refund_overview");
  if (error) {
    console.error("[refund] Unable to load guest refunds", error);
    return NextResponse.json({ message: "Unable to load refund details. Please try again later." }, { status: 503 });
  }
  const [destinations, methods] = await Promise.all([
    supabase.from("refund_requests").select("refund_id,destination_requested_at,destination_method,destination_account_name,destination_account_number,destination_submitted_at").eq("guest_id", user.id),
    supabase.from("payment_methods").select("payment_method_id,name,type").eq("is_active", true),
  ]);
  if (destinations.error || methods.error) return NextResponse.json({ message: "Unable to load refund payment details. Please retry." }, { status: 503 });
  const details = new Map((destinations.data ?? []).map(row => [row.refund_id, row]));
  return NextResponse.json({ ...data, refunds: (data.refunds ?? []).map((row: { refund_id: string }) => ({ ...row, ...details.get(row.refund_id) })), paymentMethods: (methods.data ?? []).filter(row => row.name.trim().toLowerCase() !== "cash" && row.type.trim().toLowerCase() !== "cash") }, { headers: { "Cache-Control": "private, no-store" } });
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
      title: "Excess payment refund requested", message: "An excess-payment refund request is awaiting manager approval.",
      entityType: "refund_request", entityId: refundId, guestActionUrl: "/manage", staffActionUrl: "/admin/transactions" });
    if (notice.error) console.warn("[refund] Notification failed", notice.error);
  } catch (error) { console.warn("[refund] Notification failed", error); }
  return NextResponse.json({ success: true, refundId, message: "Your excess refund request is awaiting manager approval." }, { status: 201 });
}
