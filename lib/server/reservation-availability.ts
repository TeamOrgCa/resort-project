import { createAdminClient } from "@/lib/supabase/admin";
import { manilaDateKey } from "@/lib/booking/manila-date";

// A resort stay occupies each Manila calendar date it touches. The database
// exclusion constraint is authoritative; this read only gives early feedback.
export async function checkReservationOverlap(
  startDatetime: string,
  endDatetime: string,
  _guestId: string | null,
  excludeReservationId?: string
) {
  const startDay = manilaDateKey(startDatetime);
  const endDay = manilaDateKey(new Date(new Date(endDatetime).getTime() - 1));
  const rangeStart = new Date(`${startDay}T00:00:00+08:00`).toISOString();
  const rangeEnd = new Date(new Date(`${endDay}T00:00:00+08:00`).getTime() + 24 * 60 * 60 * 1000).toISOString();
  let query = createAdminClient()
    .from("reservations")
    .select("reservation_id, status, payment_deadline_at")
    .in("status", ["pending", "payment_submitted", "confirmed", "reschedule_requested"])
    .lt("start_datetime", rangeEnd)
    .gt("end_datetime", rangeStart);

  if (excludeReservationId) query = query.neq("reservation_id", excludeReservationId);

  const { data, error } = await query;
  const now = Date.now();
  return {
    conflict: Boolean(data?.some((reservation) =>
      reservation.status !== "pending" ||
      !reservation.payment_deadline_at ||
      new Date(reservation.payment_deadline_at).getTime() > now
    )),
    error,
  };
}
