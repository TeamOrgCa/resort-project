import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAdvanceBookingWindow } from "@/lib/server/advance-booking";
import { createClient } from "@/lib/supabase/server";
import { uuidPattern } from "@/lib/booking/reservation-edit";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  let from = query.get("startDatetime"), to = query.get("endDatetime");
  const month = query.get("month");
  if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    from = `${month}-01T00:00:00+08:00`;
    const [y, m] = month.split("-").map(Number);
    to = new Date(Date.UTC(y, m, 2) - 8 * 3600000).toISOString();
  }
  if (!from || !to || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 35 * 86400000) return NextResponse.json({ message: "Choose a valid room availability interval." }, { status: 400 });
  try {
    const db = createAdminClient();
    const exclude = query.get("excludeReservationId");
    if (exclude) {
      if (!uuidPattern.test(exclude)) return NextResponse.json({ message: "Choose a valid reservation." }, { status: 400 });
      const client = await createClient(), { data: { user } } = await client.auth.getUser();
      if (!user) return NextResponse.json({ message: "Sign in to edit your rooms." }, { status: 401 });
      const owned = await client.from("reservations").select("reservation_id").eq("reservation_id", exclude).eq("guest_id", user.id).maybeSingle();
      if (owned.error) throw owned.error;
      if (!owned.data) return NextResponse.json({ message: "Booking not found for this account." }, { status: 403 });
    }
    const [{ data, error }, advance] = await Promise.all([exclude ? db.rpc("swimming_room_edit_catalog", { p_reservation: exclude }) : db.rpc("room_guest_catalog", { p_from: from, p_to: to }), loadAdvanceBookingWindow(db)]);
    if (error) throw error;
    return NextResponse.json({ success: true, ...data, maxBookingDate: advance.maxBookingDate }, { headers: { "Cache-Control": exclude ? "private, no-store" : "no-store" } });
  } catch { return NextResponse.json({ success: false, message: "Room availability is unavailable. Please retry or contact the resort." }, { status: 503 }); }
}
