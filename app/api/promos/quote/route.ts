import { NextResponse } from "next/server";
import { BookingPromoError, loadBookingPromo } from "@/lib/server/booking-discounts";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    const promo = await loadBookingPromo(body?.code);
    if (!promo) return NextResponse.json({ message: "Enter a promo code." }, { status: 400 });
    return NextResponse.json({ promo }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to validate promo." }, { status: error instanceof BookingPromoError ? error.status : 503 }); }
}
