import type { SupabaseClient } from "@supabase/supabase-js";
import { sendReservationCancelledEmail, sendRefundStatusEmail } from "@/lib/email";
import type { CancellationPreview } from "@/lib/booking/cancellation";

export const workflowErrorStatus = (code?: string) => code === "42501" ? 403 : ["40001", "23505"].includes(code ?? "") ? 409 : code === "22023" ? 400 : 503;
export const workflowErrorMessage = (error: { code?: string; message: string }) => ["PGRST202", "PGRST204", "42883", "42703"].includes(error.code ?? "")
  ? "Cancellation and refunds need the cancellation-refund-workflow migration. Ask the administrator to apply it." : error.message;
async function recipient(client: SupabaseClient, id: string) {
  const { data: reservation, error } = await client.from("reservations").select("guest_id, walk_in_guest_id, reference_number, start_datetime, end_datetime").eq("reservation_id", id).maybeSingle();
  if (error || !reservation) return null;
  const guestId = reservation.guest_id ?? reservation.walk_in_guest_id;
  if (!guestId) return null;
  const { data: guest } = await client.from(reservation.guest_id ? "guests" : "walk_in_guests").select("email, first_name, last_name")
    .eq(reservation.guest_id ? "id" : "walk_in_guest_id", guestId).maybeSingle();
  if (!guest?.email) return null;
  return { reservation, guestEmail: guest.email as string, guestName: `${guest.first_name ?? ""} ${guest.last_name ?? ""}`.trim() || "Guest" };
}
// Alerts/finance already committed. SMTP failure must not encourage duplicate payouts.
export async function cancellationEmail(client: SupabaseClient, id: string, reason: string, result: CancellationPreview): Promise<boolean> {
  try {
    const info = await recipient(client, id); if (!info) return false;
    return await sendReservationCancelledEmail({ guestEmail: info.guestEmail, guestName: info.guestName,
      reservationReference: info.reservation.reference_number, checkInDate: info.reservation.start_datetime,
      checkOutDate: info.reservation.end_datetime, cancellationReason: reason,
      refundSummary: `Verified payments PHP ${result.verifiedPaid}; previous refunds PHP ${result.previousRefunds}; retained deposit PHP ${result.deduction}; refundable PHP ${result.refundableAmount}. ${result.refundableAmount > 0 ? "Your refund request was created automatically and awaits manual staff review and payout verification." : "Cancelled - No Refund."}` });
  } catch { return false; }
}
export async function refundEmail(client: SupabaseClient, id: string, amount: number, status: string, notes: string): Promise<boolean> {
  try {
    const info = await recipient(client, id); if (!info) return false;
    return await sendRefundStatusEmail({ guestEmail: info.guestEmail, guestName: info.guestName,
      reservationReference: info.reservation.reference_number, amount, status, notes });
  } catch { return false; }
}
