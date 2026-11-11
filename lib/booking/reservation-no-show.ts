export type NoShowReservation = {
  reservation_id: string; status: string; start_datetime: string; end_datetime: string;
  checked_in_at?: string | null; checked_out_at?: string | null;
  no_show_at?: string | null; no_show_reason?: string | null;
};

export function noShowBlockedReason(reservation: NoShowReservation, now = Date.now()): string | null {
  if (reservation.checked_in_at || reservation.checked_out_at) return "A guest with recorded attendance cannot be marked as a no-show.";
  if (reservation.status !== "confirmed") return "Only a confirmed reservation can be marked as a no-show.";
  const end = Date.parse(reservation.end_datetime);
  if (!Number.isFinite(end) || end >= now) return "No show is available only after the scheduled end time.";
  return null;
}
