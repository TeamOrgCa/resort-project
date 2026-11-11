"use client";

import { useRef, useState } from "react";
import { noShowBlockedReason, type NoShowReservation } from "@/lib/booking/reservation-no-show";
import { formatManilaDateTime } from "@/lib/booking/manila-date";

export default function ReservationNoShow({ reservation, canManage, disabled = false, now, onBusyChange, onRecorded, onConflict }: {
  reservation: NoShowReservation; canManage: boolean; disabled?: boolean; now?: number;
  onBusyChange?: (busy: boolean) => void;
  onRecorded: (reservation: NoShowReservation, message: string) => void; onConflict?: () => void;
}) {
  const [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  if (reservation.status === "no_show") return <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
    <h3 className="font-semibold">No show</h3>
    {reservation.no_show_at && <p className="mt-1">Recorded {formatManilaDateTime(reservation.no_show_at)}.</p>}
    {reservation.no_show_reason && <p className="mt-2 whitespace-pre-wrap break-words">Reason: {reservation.no_show_reason}</p>}
    <p className="mt-2">This reservation is closed. Existing billing and payment history are retained.</p>
  </section>;
  if (!canManage || reservation.status !== "confirmed" || reservation.checked_in_at || reservation.checked_out_at) return null;
  const blocked = noShowBlockedReason(reservation, now);
  const submit = async () => {
    if (submitting.current || disabled || blocked || !confirmed || reason.trim().length < 5) return;
    submitting.current = true; setBusy(true); onBusyChange?.(true); setError(null);
    try {
      const response = await fetch("/api/admin/reservations/no-show", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId: reservation.reservation_id, reason: reason.trim(), noShowConfirmed: true }) });
      const result = await response.json();
      if (!response.ok || !result.success || !result.reservation) {
        if (response.status === 409) onConflict?.();
        throw new Error(result.message ?? "Unable to record the no-show.");
      }
      setReason(""); setConfirmed(false); onRecorded(result.reservation, result.message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to record the no-show."); }
    finally { submitting.current = false; setBusy(false); onBusyChange?.(false); }
  };
  return <section aria-label="Record a no-show" className="mt-4 space-y-3 border-t border-neutral/10 pt-4 text-sm">
    <h3 className="font-semibold">Mark as No show</h3>
    <p>Use this only when the guest did not arrive. This closes the reservation, preserves the recorded bill and does not create a cancellation refund.</p>
    {blocked ? <p className="rounded-xl bg-amber-50 p-3 text-amber-900">{blocked}</p> : <>
      <label className="block font-medium">No-show reason<textarea value={reason} maxLength={2000} rows={2} disabled={busy || disabled} onChange={event => setReason(event.target.value)} className="admin-field mt-1 w-full" /></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy || disabled} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />I confirm the guest did not arrive and no check-in was recorded.</label>
    </>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
    <button type="button" disabled={busy || disabled || Boolean(blocked) || !confirmed || reason.trim().length < 5} onClick={() => void submit()} className="admin-button-secondary border-amber-300 text-amber-900">{busy ? "Recording no-show..." : "Mark as No show"}</button>
  </section>;
}
