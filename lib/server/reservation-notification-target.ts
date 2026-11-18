import type { SupabaseClient } from "@supabase/supabase-js";
import { manilaDateKey } from "@/lib/booking/manila-date";

export type ReservationNotificationTarget = { reservationId?: string; date?: string; error?: string };

/** Called with the staff session after checking Reservations permission. */
export async function reservationNotificationTarget(client: SupabaseClient, id: string, reschedule = false): Promise<ReservationNotificationTarget> {
  try {
    const readReservation = async (reservationId: string) => {
      const result = await client.from("reservations").select("reservation_id,start_datetime,status,payment_deadline_at").eq("reservation_id", reservationId).maybeSingle();
      if (result.error) throw result.error;
      return result.data;
    };
    // Automatic reschedule notices carry the reservation ID; older notices
    // carry a reschedule record ID. Resolve both using the staff session's RLS.
    let reservation = await readReservation(id);
    if (!reservation && reschedule) {
      const { data, error } = await client.from("reservation_reschedules").select("reservation_id").eq("reschedule_id", id).maybeSingle();
      if (error) throw error;
      if (data) reservation = await readReservation(data.reservation_id);
    }
    if (!reservation) return { error: "This booking or reservation is no longer available, or you do not have access to it." };
    if (reservation.status === "expired" || (reservation.status === "pending" && reservation.payment_deadline_at && new Date(reservation.payment_deadline_at).getTime() <= Date.now())) {
      return { error: "This booking has expired and no longer appears on the calendar." };
    }
    return { reservationId: reservation.reservation_id, date: manilaDateKey(reservation.start_datetime) };
  } catch {
    return { error: "Unable to locate this booking or reservation. Please reopen the notification to try again." };
  }
}
