import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidPattern } from "@/lib/booking/reservation-edit";
import { buildBillingBreakdown } from "@/lib/booking/billing-breakdown";

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("reservationId") ?? "";
    if (!uuidPattern.test(id)) return NextResponse.json({ message: "Choose a valid reservation." }, { status: 400 });
    const client = await createClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return NextResponse.json({ message: "Sign in to view your bill." }, { status: 401 });
    const owned = await client.from("reservations")
      .select("reservation_id,booking_mode,start_datetime,end_datetime,adult_count,child_count")
      .eq("reservation_id", id).eq("guest_id", user.id).maybeSingle();
    if (owned.error) throw owned.error;
    if (!owned.data) return NextResponse.json({ message: "Booking not found for this account." }, { status: 403 });
    // Staff reschedule history is private. Return only this owner's billed amounts,
    // never internal reasons, policy snapshots or staff identities.
    const admin = createAdminClient();
    const [bill, services, guestChanges, staffChanges] = await Promise.all([
      admin.from("transactions").select("total_amount,paid_amount,balance").eq("reservation_id", id).maybeSingle(),
      admin.from("reservation_services").select("quantity,price_at_time,services(name)").eq("reservation_id", id),
      admin.from("reservation_reschedules").select("reschedule_fee,rate_adjustment").eq("reservation_id", id).eq("status", "approved"),
      admin.from("reservation_reschedule_adjustments").select("notice_fee,rate_adjustment").eq("reservation_id", id),
    ]);
    if ([bill, services, guestChanges, staffChanges].some(result => result.error) || !bill.data) throw new Error("Billing details unavailable");
    const r = owned.data;
    const fee = (guestChanges.data ?? []).reduce((sum, row) => sum + Number(row.reschedule_fee), 0)
      + (staffChanges.data ?? []).reduce((sum, row) => sum + Number(row.notice_fee), 0);
    const rate = [...(guestChanges.data ?? []), ...(staffChanges.data ?? [])].reduce((sum, row) => sum + Number(row.rate_adjustment), 0);
    const breakdown = buildBillingBreakdown({
      bookingMode: r.booking_mode, startDatetime: r.start_datetime, endDatetime: r.end_datetime,
      adultCount: Number(r.adult_count), childCount: Number(r.child_count), adultRate: null, childRate: null, units: [],
      services: (services.data ?? []).map(row => ({
        name: (Array.isArray(row.services) ? row.services[0]?.name : (row.services as { name: string } | null)?.name) || "Additional service",
        quantity: Number(row.quantity), priceAtBooking: Number(row.price_at_time),
      })),
      recordedTotal: Number(bill.data.total_amount), rescheduleFees: fee, dateRateAdjustment: rate,
    });
    if (breakdown.lines.some(line => !Number.isFinite(line.amount) || line.amount < 0)) throw new Error("Inconsistent billing details");
    return NextResponse.json({ breakdown }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ message: "Unable to load the amount breakdown. Please retry." }, { status: 503 });
  }
}
