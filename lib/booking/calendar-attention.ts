import { manilaDateKey } from "./manila-date";

export const ATTENTION_LABELS = {
  payment: "Payment submitted",
  reschedule: "Reschedule requested",
  refund: "Refund pending",
  balance: "Unpaid balance",
  arrival: "Today: not checked in",
} as const;
export type AttentionFlag = keyof typeof ATTENTION_LABELS;
export type CalendarSignals = { payment?: boolean; reschedule?: boolean; refund?: boolean; balance?: number };

export function reservationAttention(reservation: { status: string; start_datetime: string; checked_in_at?: string | null }, signals: CalendarSignals = {}, now = Date.now()): AttentionFlag[] {
  const flags: AttentionFlag[] = [];
  if (signals.payment || reservation.status === "payment_submitted") flags.push("payment");
  if (signals.reschedule || reservation.status === "reschedule_requested") flags.push("reschedule");
  if (signals.refund) flags.push("refund");
  if (!["cancelled", "rejected", "expired", "completed"].includes(reservation.status) && Number(signals.balance) > 0) flags.push("balance");
  if (["confirmed", "reschedule_requested"].includes(reservation.status) && !reservation.checked_in_at && manilaDateKey(reservation.start_datetime) === manilaDateKey(new Date(now))) flags.push("arrival");
  return flags;
}

export function calendarBookingKind(status: string): "booking" | "reservation" | "closed" {
  return ["pending", "payment_submitted"].includes(status) ? "booking"
    : ["confirmed", "reschedule_requested"].includes(status) ? "reservation" : "closed";
}
