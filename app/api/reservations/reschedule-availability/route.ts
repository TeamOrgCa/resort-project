import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidManilaDate } from "@/lib/booking/manila-date";
import { uuidPattern } from "@/lib/booking/reservation-edit";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams, id = params.get("reservationId") ?? "", month = params.get("month") ?? "";
  if (!uuidPattern.test(id) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < "2020-01" || month > "2100-12" || !isValidManilaDate(`${month}-01`)) return NextResponse.json({ message: "Choose a valid reservation and calendar month." }, { status: 400 });
  try {
    const client = await createClient(), { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ message: "Sign in to reschedule your booking." }, { status: 401 });
    const owned = await client.from("reservations").select("reservation_id").eq("reservation_id", id).eq("guest_id", user.id).maybeSingle();
    if (owned.error) throw owned.error;
    if (!owned.data) return NextResponse.json({ message: "Booking not found for this account." }, { status: 403 });
    const [year, number] = month.split("-").map(Number), to = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
    const { data, error } = await createAdminClient().rpc("swimming_room_reschedule_calendar", { p_reservation: id, p_from: `${month}-01`, p_to: to });
    if (error || !Array.isArray(data)) return NextResponse.json({ message: error && ["PGRST202", "42883"].includes(error.code) ? "Room rescheduling needs swimming-guest-manage-migration.sql. Contact the resort administrator." : "Unable to check the booked rooms. Please retry." }, { status: 503 });
    return NextResponse.json({ dates: data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ message: "Unable to check the booked rooms. Please retry." }, { status: 503 }); }
}
