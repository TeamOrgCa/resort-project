import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadReservationEditor } from "@/lib/server/reservation-editor";
import { computeBookingPricing } from "@/lib/booking/pricing";
import { uuidPattern } from "@/lib/booking/reservation-edit";
import { emailUpdatedBillingStatement } from "@/lib/server/billing-email";

async function authorized() {
  const staff = await requireActiveStaff(); if (!staff) return null;
  const role = staff.staffUser.role;
  return role === "admin" || role === "staff" && await staffHasPermission(staff.supabase, role, "edit_reservation")
    || role === "cashier" && await staffHasPermission(staff.supabase, role, "payment_entry") && await staffHasPermission(staff.supabase, role, "transactions") ? staff : null;
}
export async function GET(request: Request) {
  if (!await authorized()) return NextResponse.json({ message: "Manager or cashier billing permission required." }, { status: 403 });
  const id = new URL(request.url).searchParams.get("reservationId") ?? "";
  if (!uuidPattern.test(id)) return NextResponse.json({ message: "Choose a reservation." }, { status: 400 });
  try {
    const detail = await loadReservationEditor(id); if (!detail) return NextResponse.json({ message: "Reservation not found." }, { status: 404 });
    const r = detail.reservation;
    let packagePrice: number, packagePriceLabel = "Package price";
    if (r.commercial_type === "public_swimming" && !r.room_pricing) {
      if (r.public_admission_amount == null || !Number.isFinite(Number(r.public_admission_amount)) || Number(r.public_admission_amount) < 0) {
        return NextResponse.json({ message: "The saved public swimming admission amount is unavailable. Reload the reservation or contact the administrator." }, { status: 503 });
      }
      packagePrice = Number(r.public_admission_amount);
      packagePriceLabel = "Public swimming admission";
    } else if (r.room_pricing || r.commercial_type === "room_accommodation") {
      const charges = await createAdminClient().from("room_charges").select("amount").eq("reservation_id", id).eq("kind", "accommodation");
      if (charges.error) throw new Error("Room discount basis unavailable");
      packagePrice = (charges.data ?? []).reduce((total, charge) => total + Number(charge.amount), 0);
      packagePriceLabel = "Accommodation";
    } else {
      if (!detail.packageRates) throw new Error("Booked private package rates unavailable");
      packagePrice = computeBookingPricing({ bookingMode: r.booking_mode ?? "day", startDatetime: r.start_datetime, endDatetime: r.end_datetime, adultCount: r.adult_count, childCount: r.child_count }, detail.packageRates).packageRate;
    }
    return NextResponse.json({ headCount: r.adult_count + r.child_count, packagePrice, packagePriceLabel, bill: detail.bill, locked: detail.billingLocked ?? Boolean(detail.lockedReason) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ message: "Unable to load booking discounts. Reload the transaction and try again." }, { status: 503 }); }
}
export async function POST(request: Request) {
  const staff = await authorized(); if (!staff) return NextResponse.json({ message: "Manager or cashier billing permission required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!uuidPattern.test(body?.reservationId ?? "") || !Number.isSafeInteger(body?.eligibleGuests) || body.eligibleGuests < 0 || body.eligibleGuests > 30 ||
    !Number.isFinite(body.expectedTotal) || typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.length > 1000 ||
    body.promoCode !== null && body.promoCode !== undefined && (typeof body.promoCode !== "string" || body.promoCode.length > 40)) return NextResponse.json({ message: "Enter a valid eligible guest count, promo code and verification reason." }, { status: 400 });
  const { data, error } = await createAdminClient().rpc("set_booking_discount", { p_reservation: body.reservationId, p_actor: staff.staffUser.id,
    p_eligible: body.eligibleGuests, p_code: body.promoCode || null, p_expected_total: body.expectedTotal, p_reason: body.reason.trim(), p_guest: false });
  if (error) return NextResponse.json({ message: error.message }, { status: error.code === "42501" ? 403 : error.code === "40001" ? 409 : error.code === "22023" ? 400 : 503 });
  const billingEmail = await emailUpdatedBillingStatement(body.reservationId, Number(data.totalAmount)).catch(() => ({ sent: false, error: "Email delivery failed; the bill was saved." }));
  return NextResponse.json({ success: true, ...data, billingEmail, message: "Discount and bill updated. Only the larger discount was applied." });
}
