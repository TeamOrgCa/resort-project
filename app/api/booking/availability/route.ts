import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? "";
  const excludeReservationId = params.get("excludeReservationId");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ message: "Invalid month." }, { status: 400 });
  }

  const [year, monthNumber] = month.split("-").map(Number);
  if (year < 2020 || year > 2100) {
    return NextResponse.json({ message: "Invalid month." }, { status: 400 });
  }
  // Only authorized staff may exclude the booking they are currently editing.
  // Public booking requests still include every active reservation.
  if (excludeReservationId !== null) {
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(excludeReservationId)) {
      return NextResponse.json({ message: "Invalid reservation." }, { status: 400 });
    }
    const staff = await requireActiveStaff();
    if (!staff) return NextResponse.json({ message: "Sign in as active resort staff." }, { status: 401 });
    if (!await staffHasPermission(staff.supabase, staff.staffUser.role, "reservations")) {
      return NextResponse.json({ message: "You cannot view reservation availability." }, { status: 403 });
    }
  }
  const firstDay = `${month}-01`;
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  const dayAfterNextMonth = new Date(Date.UTC(year, monthNumber, 2)).toISOString().slice(0, 10);
  // Include the following day because night and whole-day packages cross midnight.
  const start = new Date(`${firstDay}T00:00:00+08:00`).toISOString();
  const end = new Date(new Date(`${nextMonth}T00:00:00+08:00`).getTime() + 86_400_000).toISOString();

  try {
    const admin = createAdminClient();
    let query = admin.from("reservations")
      .select("start_datetime, end_datetime, status, payment_deadline_at")
      .in("status", ["pending", "payment_submitted", "confirmed", "reschedule_requested"])
      .lt("start_datetime", end)
      .gt("end_datetime", start)
      .limit(1000);
    if (excludeReservationId) query = query.neq("reservation_id", excludeReservationId);
    const { data, error } = await query;
    if (error) throw error;

    const { data: blocks, error: blocksError } = await admin.from("maintenance_blocks")
      .select("start_date, end_date").eq("status", "active")
      .lt("start_date", dayAfterNextMonth).gte("end_date", firstDay).limit(1000);
    if (blocksError) throw blocksError;

    const now = Date.now();
    const reservations = (data ?? []).filter((reservation) =>
      reservation.status !== "pending" || !reservation.payment_deadline_at ||
      new Date(reservation.payment_deadline_at).getTime() > now
    ).map(({ start_datetime, end_datetime }) => ({ start_datetime, end_datetime }));

    return NextResponse.json({ reservations, blockedDates: blocks ?? [] }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Booking availability lookup failed:", error);
    return NextResponse.json({ message: "Unable to load booking availability." }, { status: 500 });
  }
}
