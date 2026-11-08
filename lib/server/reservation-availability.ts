import { createAdminClient } from "@/lib/supabase/admin";

// The database exclusion constraint is authoritative; this read gives early feedback.
export async function checkReservationOverlap(
  startDatetime: string,
  endDatetime: string,
  _guestId: string | null,
  excludeReservationId?: string
) {
  let query = createAdminClient()
    .from("reservations")
    .select("reservation_id, status, payment_deadline_at")
    .in("status", ["pending", "payment_submitted", "confirmed", "reschedule_requested"])
    .lt("start_datetime", endDatetime)
    .gt("end_datetime", startDatetime);

  if (excludeReservationId) query = query.neq("reservation_id", excludeReservationId);

  const [reservationResult, blockResult] = await Promise.all([
    query,
    createAdminClient().from("maintenance_blocks").select("block_id")
      .eq("status", "active").lt("start_datetime", endDatetime).gt("end_datetime", startDatetime).limit(1),
  ]);
  const { data, error } = reservationResult;
  const now = Date.now();
  return {
    conflict: Boolean(blockResult.data?.length) || Boolean(data?.some((reservation) =>
      reservation.status !== "pending" ||
      !reservation.payment_deadline_at ||
      new Date(reservation.payment_deadline_at).getTime() > now
    )),
    error: error ?? blockResult.error,
  };
}
