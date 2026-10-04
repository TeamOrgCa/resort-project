import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createNotifications, NOTIFICATION_AUDIENCES } from "@/lib/notifications";

type ServiceInput = { serviceId: string; quantity: number };
type BillResult = { totalAmount: number; paidAmount: number; remainingBalance: number; status: string; addedCharge: number };
const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function parsePayload(value: unknown): { reservationId: string; services: ServiceInput[] } | null {
  if (!value || typeof value !== "object") return null;
  const body = value as { reservationId?: unknown; services?: unknown };
  if (typeof body.reservationId !== "string" || !uuidPattern.test(body.reservationId) ||
      !Array.isArray(body.services) || body.services.length < 1 || body.services.length > 100) return null;
  const services: ServiceInput[] = [];
  const seen = new Set<string>();
  for (const item of body.services) {
    if (!item || typeof item !== "object") return null;
    const candidate = item as { serviceId?: unknown; quantity?: unknown };
    if (typeof candidate.serviceId !== "string" || !uuidPattern.test(candidate.serviceId) ||
        !Number.isInteger(candidate.quantity) || Number(candidate.quantity) < 1 || Number(candidate.quantity) > 10000 ||
        seen.has(candidate.serviceId)) return null;
    services.push({ serviceId: candidate.serviceId, quantity: Number(candidate.quantity) });
    seen.add(candidate.serviceId);
  }
  return { reservationId: body.reservationId, services };
}

export async function POST(request: Request) {
  const payload = parsePayload(await request.json().catch(() => null));
  if (!payload) return NextResponse.json({ success: false, message: "Choose valid services and quantities." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ success: false, message: "Log in to update services." }, { status: 401 });

  const { data, error } = await supabase.rpc("update_reservation_services_bill", {
    p_reservation: payload.reservationId, p_services: payload.services,
  });
  if (error) {
    return NextResponse.json({ success: false, message: error.message, errorCode: error.code },
      { status: error.code === "42501" ? 403 : error.code === "22023" ? 400 : 500 });
  }
  const bill = data as BillResult;
  if (bill.addedCharge > 0) {
    const notice = await createNotifications({
      actorId: user.id, staffRoles: NOTIFICATION_AUDIENCES.reservation,
      title: "Reservation services added",
      message: `Additional services were added to a reservation. New balance: PHP ${Number(bill.remainingBalance).toFixed(2)}.`,
      entityType: "reservation", entityId: payload.reservationId,
      staffActionUrl: "/admin/transactions",
    });
    if (notice.error) console.warn("Failed to notify staff of additional service charge:", notice.error);
  }
  return NextResponse.json({ success: true, reservationId: payload.reservationId, ...bill,
    message: bill.remainingBalance > 0
      ? "Services added to your bill. Pay the new balance to receive a receipt for that payment."
      : "Services updated. No balance remains." });
}
