import { createAdminClient } from "@/lib/supabase/admin";
import { manilaDateKey } from "@/lib/booking/manila-date";

// Half-open intervals: a booking ending exactly when another begins is allowed.
export async function checkReservationOverlap(
  startDatetime: string,
  endDatetime: string,
  guestId: string | null,
  excludeReservationId?: string
) {
  if (!guestId) return { conflict: false, error: null };
  const startDay = manilaDateKey(startDatetime);
  const endDay = manilaDateKey(new Date(new Date(endDatetime).getTime() - 1));
  const rangeStart = new Date(`${startDay}T00:00:00+08:00`).toISOString();
  const rangeEnd = new Date(new Date(`${endDay}T00:00:00+08:00`).getTime() + 24 * 60 * 60 * 1000).toISOString();
  let query = createAdminClient()
    .from("reservations")
    .select("reservation_id")
    .eq("guest_id", guestId)
    .in("status", ["pending", "payment_submitted", "confirmed", "reschedule_requested"])
    .lt("start_datetime", rangeEnd)
    .gt("end_datetime", rangeStart);

  if (excludeReservationId) query = query.neq("reservation_id", excludeReservationId);

  const { data, error } = await query.limit(1).maybeSingle<{ reservation_id: string }>();
  return { conflict: Boolean(data), error };
}
