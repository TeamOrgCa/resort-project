import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadReservationEditor } from "@/lib/server/reservation-editor";
import { previewReservationEdit, uuidPattern } from "@/lib/booking/reservation-edit";
import { guestEditRestriction, parseGuestBookingEdit, type GuestEditDetail } from "@/lib/booking/guest-edit";
import { createNotifications, NOTIFICATION_AUDIENCES } from "@/lib/notifications";

async function ownedDetail(request: Request) {
  const id = new URL(request.url).searchParams.get("reservationId") ?? "";
  if (!uuidPattern.test(id)) return { error: NextResponse.json({ message: "Choose a valid reservation." }, { status: 400 }) };
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return { error: NextResponse.json({ message: "Sign in to edit your booking." }, { status: 401 }) };
  const owner = await client.from("reservations").select("reservation_id").eq("reservation_id", id).eq("guest_id", user.id).maybeSingle();
  if (owner.error) return { error: NextResponse.json({ message: "Unable to verify your booking. Please retry." }, { status: 503 }) };
  if (!owner.data) return { error: NextResponse.json({ message: "Booking not found for this account." }, { status: 403 }) };
  const loaded = await loadReservationEditor(id);
  if (!loaded || loaded.reservation.guest_id !== user.id) return { error: NextResponse.json({ message: "Booking not found." }, { status: 404 }) };
  const refunds = await createAdminClient().from("refund_requests").select("refund_id").eq("reservation_id", id).in("status", ["pending", "reviewed", "approved", "payout_submitted"]).limit(1);
  if (refunds.error) throw new Error("Unable to check open refunds. Please retry.");
  const lockedReason = loaded.lockedReason ?? (refunds.data?.length ? "Resolve the open refund before editing this booking." : null);
  const detail: GuestEditDetail = { reservation: loaded.reservation, services: loaded.services,
    catalogServices: loaded.catalogServices.filter(service => service.is_active || loaded.services.some(old => old.service_id === service.service_id)),
    bill: loaded.bill, packageRates: loaded.packageRates, version: loaded.version, lockedReason,
    canChangeGuests: !lockedReason && loaded.canChangeDetails,
    canReduceServices: !lockedReason && loaded.canChangeDetails && loaded.bill.paid_amount < loaded.bill.total_amount };
  return { id, user, loaded, detail };
}

export async function GET(request: Request) {
  try {
    const result = await ownedDetail(request);
    if (result.error) return result.error;
    return NextResponse.json(result.detail, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to load this booking." }, { status: 503 }); }
}

export async function POST(request: Request) {
  const edit = parseGuestBookingEdit(await request.json().catch(() => null));
  if (!edit) return NextResponse.json({ message: "Enter valid guest counts and service quantities, then review the total." }, { status: 400 });
  try {
    const result = await ownedDetail(request);
    if (result.error) return result.error;
    const { detail, loaded, user, id } = result;
    if (edit.version !== detail.version) return NextResponse.json({ message: "This booking changed. Reload it before saving." }, { status: 409 });
    const restriction = guestEditRestriction(detail, edit);
    if (restriction) return NextResponse.json({ message: restriction }, { status: 409 });
    const r = detail.reservation;
    const preview = previewReservationEdit(r, detail.bill, detail.services, detail.catalogServices,
      { ...edit, bookingMode: r.booking_mode, startDatetime: r.start_datetime, endDatetime: r.end_datetime }, detail.packageRates);
    if (Math.abs(preview.total - edit.expectedTotal) > 0.001) return NextResponse.json({ message: "The bill changed. Reload and review the new total." }, { status: 409 });
    const { data, error } = await createAdminClient().rpc("edit_guest_reservation_bill", { p_reservation: id, p_guest: user.id,
      p_expected: loaded.snapshot, p_patch: { adultCount: edit.adultCount, childCount: edit.childCount, services: edit.services, packageDelta: preview.packageDelta, expectedTotal: preview.total } });
    if (error) {
      const missing = ["PGRST202", "42883"].includes(error.code);
      return NextResponse.json({ message: missing ? "Booking editing needs the guest-booking-edit migration. Contact the resort administrator." : error.message },
        { status: missing ? 503 : error.code === "42501" ? 403 : ["40001", "23505"].includes(error.code) ? 409 : error.code === "22023" ? 400 : 503 });
    }
    try {
      await createNotifications({ actorId: user.id, guestId: user.id, staffRoles: NOTIFICATION_AUDIENCES.reservation,
        title: "Booking updated", message: `Guest counts or services for ${r.reference_number} were updated. Remaining balance: PHP ${Number(data.remainingBalance).toFixed(2)}.`,
        entityType: "reservation", entityId: id, guestActionUrl: "/manage", staffActionUrl: "/admin/reservations" });
    } catch { /* The audited bill is committed; notification delivery must not prompt duplicate saves. */ }
    return NextResponse.json({ success: true, ...data, message: "Booking updated. Your total and remaining balance have been recalculated." });
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to update this booking." }, { status: 503 }); }
}
