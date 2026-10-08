import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { BookingPolicy } from "@/lib/booking/booking-policy";

export async function GET(request: Request) {
  const supabase = await createClient();
  const reservationId = new URL(request.url).searchParams.get("reservationId");
  let version: number | null = null;
  if (reservationId) {
    if (!/^[a-f\d-]{36}$/i.test(reservationId)) return NextResponse.json({ message: "Invalid reservation." }, { status: 400 });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ message: "Sign in to view this reservation's policy." }, { status: 401 });
    const { data: reservation, error } = await supabase.from("reservations")
      .select("guest_id, booking_policy_version").eq("reservation_id", reservationId).maybeSingle();
    if (error || !reservation || reservation.guest_id !== user.id) {
      return NextResponse.json({ message: "Reservation not found." }, { status: 404 });
    }
    version = reservation.booking_policy_version;
  }
  const { data: policy, error } = await supabase.rpc("get_booking_policy", { p_version: version }).maybeSingle<BookingPolicy>();
  if (error || !policy) return NextResponse.json({ message: "Booking policy is unavailable." }, { status: 500 });
  return NextResponse.json({ policy }, { headers: { "Cache-Control": "no-store" } });
}
