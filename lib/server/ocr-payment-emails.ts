import { createAdminClient } from "@/lib/supabase/admin";
import { sendReservationConfirmedEmail } from "@/lib/email";
import { emailBillingDocuments } from "@/lib/server/billing-email";

/** Delivery failures must never undo an already committed automatic approval. */
export async function sendOcrPaymentEmails(reservationId: string, paymentId: string, amount: number) {
  try {
    const client = createAdminClient();
    const { data: reservation, error } = await client.from("reservations")
      .select("reservation_id,guest_id,walk_in_guest_id,reference_number,start_datetime,end_datetime")
      .eq("reservation_id", reservationId).maybeSingle();
    if (error || !reservation) return;
    const deliveries: (() => Promise<unknown>)[] = [() => emailBillingDocuments(client, reservation, paymentId, amount)];
    if (reservation.guest_id) {
      const { data: guest } = await client.from("guests").select("email,first_name,last_name").eq("id", reservation.guest_id).maybeSingle();
      if (guest?.email) deliveries.push(() => sendReservationConfirmedEmail({
        guestEmail: guest.email,
        guestName: `${guest.first_name ?? ""} ${guest.last_name ?? ""}`.trim() || "Guest",
        reservationReference: reservation.reference_number,
        checkInDate: reservation.start_datetime,
        checkOutDate: reservation.end_datetime,
      }));
    }
    await Promise.allSettled(deliveries.map(deliver => deliver()));
  } catch (error) { console.warn("Automatic payment approval email delivery failed:", error); }
}
