export const ATTENTION_LABELS = {
  no_show: "No show",
  cancelled: "Cancelled",
  refund: "Refund pending",
} as const;
export type AttentionFlag = keyof typeof ATTENTION_LABELS;
export type CalendarSignals = { payment?: boolean; reschedule?: boolean; refund?: boolean; balance?: number; paidAmount?: number };

export function reservationAttention(reservation: { status: string }, signals: CalendarSignals = {}): AttentionFlag[] {
  const flags: AttentionFlag[] = [];
  if (reservation.status === "no_show") flags.push("no_show");
  if (reservation.status === "cancelled") flags.push("cancelled");
  if (signals.refund) flags.push("refund");
  return flags;
}

export function calendarBookingKind(status: string, paidAmount?: number): "booking" | "reservation" | "closed" {
  // A later payment review or reschedule must not turn a paid stay into an unpaid booking.
  if (["confirmed", "completed"].includes(status)) return "reservation";
  if (["pending", "payment_submitted", "reschedule_requested"].includes(status)) {
    return (paidAmount ?? (status === "reschedule_requested" ? 1 : 0)) > 0 ? "reservation" : "booking";
  }
  return "closed";
}
