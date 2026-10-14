import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uuidPattern } from "@/lib/booking/reservation-edit";
import { cancellationMessage, type CancellationPreview } from "@/lib/booking/cancellation";
import { cancellationEmail, workflowErrorMessage, workflowErrorStatus } from "@/lib/server/cancellation";

export async function GET(request: Request) {
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return NextResponse.json({ message: "Please log in to view cancellation terms." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("reservationId") ?? "";
  if (!uuidPattern.test(id)) return NextResponse.json({ message: "Select a valid reservation." }, { status: 400 });
  const { data: owned, error: ownershipError } = await client.from("reservations").select("guest_id").eq("reservation_id", id).eq("guest_id", user.id).maybeSingle();
  if (ownershipError) return NextResponse.json({ message: "Unable to verify the reservation owner. Please retry." }, { status: 503 });
  if (!owned || owned.guest_id !== user.id) return NextResponse.json({ message: "You can only cancel your own reservation." }, { status: 403 });
  const { data, error } = await client.rpc("get_cancellation_preview", { p_reservation: id, p_initiator: "guest" });
  if (error) return NextResponse.json({ message: workflowErrorMessage(error) }, { status: workflowErrorStatus(error.code) });
  return NextResponse.json({ preview: data }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return NextResponse.json({ message: "Please log in to cancel a reservation." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!uuidPattern.test(body?.reservationId ?? "") || typeof body?.quote !== "string" || !/^[a-f0-9]{32}$/.test(body.quote))
    return NextResponse.json({ message: "Review the cancellation amount before confirming." }, { status: 400 });
  const reason = "Guest requested cancellation";
  const { data: owned, error: ownershipError } = await client.from("reservations").select("guest_id").eq("reservation_id", body.reservationId).eq("guest_id", user.id).maybeSingle();
  if (ownershipError) return NextResponse.json({ message: "Unable to verify the reservation owner. Please retry." }, { status: 503 });
  if (!owned || owned.guest_id !== user.id) return NextResponse.json({ message: "You can only cancel your own reservation." }, { status: 403 });
  const { data, error } = await client.rpc("cancel_reservation_evaluated", { p_reservation: body.reservationId,
    p_reason: reason, p_initiator: "guest", p_expected_quote: body.quote });
  if (error) return NextResponse.json({ message: workflowErrorMessage(error) }, { status: workflowErrorStatus(error.code) });
  const result = data as CancellationPreview & { refundId: string | null };
  const emailSent = await cancellationEmail(client, body.reservationId, reason, result);
  return NextResponse.json({ success: true, ...result, emailSent, message: cancellationMessage(result) });
}
