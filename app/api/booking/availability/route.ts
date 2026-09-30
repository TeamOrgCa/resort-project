import { NextResponse } from "next/server";
import { manilaDateKey } from "@/lib/booking/manila-date";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ message: "Invalid month." }, { status: 400 });
  }

  const [year, monthNumber] = month.split("-").map(Number);
  if (year < 2020 || year > 2100) {
    return NextResponse.json({ message: "Invalid month." }, { status: 400 });
  }
  const firstDay = `${month}-01`;
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  const start = new Date(`${firstDay}T00:00:00+08:00`).toISOString();
  const end = new Date(`${nextMonth}T00:00:00+08:00`).toISOString();

  try {
    const { data, error } = await createAdminClient().from("reservations")
      .select("start_datetime, end_datetime, status, payment_deadline_at")
      .in("status", ["pending", "payment_submitted", "confirmed", "reschedule_requested"])
      .lt("start_datetime", end)
      .gt("end_datetime", start)
      .limit(1000);
    if (error) throw error;

    const booked = new Set<string>();
    const now = Date.now();
    for (const reservation of data ?? []) {
      if (reservation.status === "pending" && reservation.payment_deadline_at &&
        new Date(reservation.payment_deadline_at).getTime() <= now) continue;

      const startDay = manilaDateKey(reservation.start_datetime);
      const endDay = manilaDateKey(new Date(new Date(reservation.end_datetime).getTime() - 1));
      let day = new Date(`${startDay}T00:00:00Z`);
      const last = new Date(`${endDay}T00:00:00Z`);
      while (day <= last) {
        const key = day.toISOString().slice(0, 10);
        if (key.startsWith(month)) booked.add(key);
        day = new Date(day.getTime() + 86_400_000);
      }
    }

    return NextResponse.json({ bookedDates: [...booked].sort() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Booking availability lookup failed:", error);
    return NextResponse.json({ message: "Unable to load booking availability." }, { status: 500 });
  }
}
