"use client";

import { useEffect, useState } from "react";
import type { CancellationPreview } from "@/lib/booking/cancellation";
const money = (n: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(n);
export type CancellationResult = CancellationPreview & { refundId: string | null; message: string; emailSent: boolean };

export default function CancellationDialog({ reservationId, staff = false, isAdmin = false, onClose, onCancelled }: {
  reservationId: string; staff?: boolean; isAdmin?: boolean; onClose: () => void; onCancelled: (result: CancellationResult) => void;
}) {
  const [initiator, setInitiator] = useState<"guest" | "resort">("guest");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<CancellationPreview | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [confirmed, setConfirmed] = useState(false);
  const [reload, setReload] = useState(0);
  const endpoint = staff ? "/api/admin/reservations/cancel" : "/api/reservations/cancel";
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${endpoint}?reservationId=${reservationId}&initiator=${initiator}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "Unable to calculate refund.");
        if (!controller.signal.aborted) setPreview(data.preview); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to calculate refund."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, reservationId, initiator, reload]);
  const refresh = () => { setPreview(null); setLoading(true); setConfirmed(false); setError(null); setReload(n => n + 1); };
  async function submit() {
    if (!preview?.allowed || !confirmed || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        reservationId, initiator, cancellationReason: reason.trim(), quote: preview.quote,
      }) });
      const data = await response.json();
      if (!response.ok) { if (response.status === 409) { setPreview(null); setConfirmed(false); } throw new Error(data.message ?? "Unable to cancel reservation."); }
      onCancelled(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to cancel reservation."); }
    finally { setBusy(false); }
  }
  return <div role="dialog" aria-modal="true" aria-label="Review cancellation and refund" className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral/50 p-4" onClick={() => { if (!busy) onClose(); }}>
    <div className="max-h-[90dvh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-xl sm:p-6" onClick={e => e.stopPropagation()}>
      <h3 className="text-lg font-semibold">Cancel reservation</h3>
      <p className="mt-1 text-sm text-neutral/65">Review the financial outcome before confirming. Cancellation does not automatically release money.</p>
      {staff && <div className="mt-4 space-y-3">
        <label className="block text-sm font-medium">Who initiated cancellation?<select disabled={busy} value={initiator} className="mt-1 w-full rounded-lg border p-2" onChange={e => {
          setInitiator(e.target.value as "guest" | "resort"); setPreview(null); setLoading(true); setConfirmed(false); setError(null);
        }}><option value="guest">Guest request - retain the initial 20% deposit</option>{isAdmin && <option value="resort">Resort-attributable reason - full verified refund</option>}</select></label>
        <label className="block text-sm font-medium">Documented cancellation reason<textarea required disabled={busy} minLength={5} maxLength={2000} rows={3} value={reason} onChange={e => setReason(e.target.value)} className="mt-1 w-full rounded-lg border p-2" placeholder="For example: Guest requested cancellation by phone, or pool repair prevents the booked stay." /></label>
      </div>}
      {loading && <p role="status" className="mt-4 text-sm">Calculating from verified payment records...</p>}
      {error && <div role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}<button disabled={busy} type="button" onClick={refresh} className="ml-2 underline">Reload preview</button></div>}
      {preview && <div className="mt-4 rounded-xl border border-neutral/15 bg-base p-4 text-sm">
        <p className="break-all font-semibold">{preview.reference}</p><p className="mt-2">{preview.rule}</p>
        <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3"><dt>Verified payments</dt><dd className="text-right">{money(preview.verifiedPaid)}</dd>
          <dt>Previous completed refunds</dt><dd className="text-right">{money(preview.previousRefunds)}</dd>
          <dt>Remaining verified payments</dt><dd className="text-right">{money(preview.netPaid)}</dd>
          <dt>Initial deposit basis</dt><dd className="text-right">{money(preview.depositBase)}</dd>
          <dt>Retained deposit / deduction</dt><dd className="text-right">{money(preview.deduction)}</dd>
          <dt className="font-semibold">Refundable amount</dt><dd className="text-right font-semibold text-primary">{money(preview.refundableAmount)}</dd></dl>
        <p className="mt-3 font-medium">{preview.refundableAmount > 0 ? "Cancelled - Pending Refund: a request will be created automatically." : "Cancelled - No Refund: no request will be generated."}</p>
        {preview.refundableAmount > 0 && <p className="mt-2 text-neutral/65">Payment review, administrator approval, manual transfer and verification are required.</p>}
        {!preview.allowed && <p role="alert" className="mt-3 text-red-700">{preview.blockedReason}</p>}
      </div>}
      {preview?.allowed && <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1" />I reviewed the deduction and refundable amount and want to cancel this reservation.</label>}
      <div className="mt-5 flex flex-col justify-end gap-3 sm:flex-row"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-lg border px-4 py-2 text-sm">Keep reservation</button>
        <button type="button" disabled={busy || loading || !preview?.allowed || !confirmed || (staff && reason.trim().length < 5)} onClick={() => void submit()} className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Cancelling..." : "Confirm cancellation"}</button></div>
    </div>
  </div>;
}
