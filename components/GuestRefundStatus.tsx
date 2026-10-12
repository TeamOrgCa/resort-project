"use client";

import { useCallback, useEffect, useState } from "react";

type Refund = { refund_id: string; reservation_id: string; reference_number: string; amount: number;
  request_kind: "overpayment" | "cancellation"; status: string; requested_at: string;
  review_reason: string | null; gcash_reference: string | null };
type Eligible = { reservation_id: string; reference_number: string; amount: number };
const currency = (amount: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);

export default function GuestRefundStatus() {
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [eligible, setEligible] = useState<Eligible[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/reservations/refund", { cache: "no-store", signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message ?? "Unable to load refund requests.");
    if (signal?.aborted) return;
    setRefunds(data.refunds ?? []); setEligible(data.eligible ?? []); setError(null);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => void load(controller.signal).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load refund requests.");
    });
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [load]);
  const requestRefund = async (reservationId: string) => {
    if (busy) return;
    setBusy(reservationId); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/reservations/refund", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reservationId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Unable to request a refund.");
      setMessage(data.message ?? "Your refund request is pending review.");
      // Hide immediately to prevent another click if refreshing fails.
      setEligible((current) => current.filter((item) => item.reservation_id !== reservationId));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to request a refund."); }
    finally { setBusy(null); }
  };
  if (!refunds.length && !eligible.length && !error && !message) return null;
  return <section className="mt-8 rounded-xl border border-neutral/10 bg-white p-4 sm:p-6">
    <h3 className="mb-3 text-lg font-semibold">Refunds</h3>
    {message && <p role="status" className="mb-3 rounded-lg bg-secondary/10 p-3 text-sm">{message}</p>}
    {error && <p role="alert" className="mb-3 rounded-lg bg-primary/10 p-3 text-sm">{error}</p>}
    {eligible.length > 0 && <div className="mb-5 space-y-3">
      <p className="text-sm text-neutral/70">You can request a refund for verified payments above your reservation bill. Staff will review the request and send approved refunds through GCash.</p>
      {eligible.map((item) => <div key={item.reservation_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-secondary/30 bg-secondary/5 p-4">
        <div><p className="font-semibold">{item.reference_number}</p><p className="text-sm">Excess payment: {currency(item.amount)}</p></div>
        <button type="button" disabled={busy !== null} onClick={() => void requestRefund(item.reservation_id)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === item.reservation_id ? "Requesting…" : "Request excess refund"}</button>
      </div>)}
    </div>}
    <div className="space-y-3">{refunds.map((refund) => <div key={refund.refund_id} className="rounded-lg bg-base p-3 text-sm">
      <p className="font-semibold">{refund.reference_number} · {currency(refund.amount)}</p>
      <p className="capitalize">{refund.request_kind === "overpayment" ? "Excess payment" : "Cancellation"} refund · {refund.status}</p>
      <p className="text-neutral/70">Requested {new Date(refund.requested_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</p>
      {refund.status === "approved" && <p>Approved; awaiting GCash payout.</p>}
      {refund.review_reason && <p>Review note: {refund.review_reason}</p>}
      {refund.gcash_reference && <p>GCash reference: {refund.gcash_reference}</p>}
    </div>)}</div>
  </section>;
}
