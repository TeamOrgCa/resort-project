"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { refundStatusLabels } from "@/lib/booking/cancellation";

type Refund = { destination_requested_at?: string | null; destination_submitted_at?: string | null; destination_method?: string | null; destination_account_name?: string | null; destination_account_number?: string | null; refund_id: string; reservation_id: string; reference_number: string; amount: number;
  request_kind: "overpayment" | "cancellation"; status: string; requested_at: string;
  review_reason: string | null; gcash_reference: string | null };
type Eligible = { reservation_id: string; reference_number: string; amount: number };
const currency = (amount: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);

function RefundDestinationReply({ refund, methods, onSaved }: { refund: Refund; methods: { name: string }[]; onSaved: () => void }) {
  const [method, setMethod] = useState(refund.destination_method ?? "");
  const [name, setName] = useState(refund.destination_account_name ?? "");
  const [number, setNumber] = useState(refund.destination_account_number ?? "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const submitting = useRef(false);
  const gcash = method.toLowerCase().includes("gcash");
  async function submit() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/reservations/refund", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refundId: refund.refund_id, method, accountName: name, accountNumber: number }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message);
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to send payment details."); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <form aria-label={`Refund payment details for ${refund.reference_number}`} className="mt-4 space-y-3 rounded-xl border border-primary/20 bg-white p-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <p className="font-semibold">{refund.destination_submitted_at ? "Refund payment details sent" : "Your refund payment details are needed"}</p>
    <p>Provide the account that should receive this refund. Staff will review it before sending money.</p>
    <fieldset disabled={busy} className="space-y-3">
      <label className="block">Refund payment method<select required value={method} onChange={event => setMethod(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border p-2"><option value="">Choose a payment method</option>{methods.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
      <label className="block">Account name<input required minLength={2} maxLength={120} autoComplete="name" value={name} onChange={event => setName(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border p-2" /></label>
      <label className="block">{gcash ? "GCash number" : "Account number"}<input required minLength={3} maxLength={120} inputMode={gcash ? "tel" : "text"} pattern={gcash ? "(09[0-9]{9}|[+]639[0-9]{9})" : undefined} title={gcash ? "11 digits starting with 09, or +639 followed by 9 digits" : undefined} value={number} onChange={event => setNumber(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border p-2" /></label>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {!methods.length && <p>No payout methods are currently available. Contact the resort.</p>}
      <button disabled={busy || !methods.some(item => item.name === method)} className="min-h-11 rounded-lg bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? "Sending..." : refund.destination_submitted_at ? "Update refund payment details" : "Send refund payment details"}</button>
    </fieldset>
  </form>;
}

export default function GuestRefundStatus({ refreshKey = 0, reservationId, referenceSearch = "", standalone = false }: {
  refreshKey?: number; reservationId?: string; referenceSearch?: string; standalone?: boolean;
}) {
  const [methods, setMethods] = useState<{ name: string }[]>([]);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [eligible, setEligible] = useState<Eligible[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/reservations/refund", { cache: "no-store", signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message ?? "Unable to load refund requests.");
    if (signal?.aborted) return;
    setMethods(data.paymentMethods ?? []);
    setRefunds((data.refunds ?? []).filter((item: Refund) => !reservationId || item.reservation_id === reservationId));
    setEligible((data.eligible ?? []).filter((item: Eligible) => !reservationId || item.reservation_id === reservationId)); setError(null);
  }, [reservationId]);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => void load(controller.signal).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load refund requests.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [load, refreshKey, reload]);
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
  const query = referenceSearch.trim().toLowerCase();
  const visibleRefunds = refunds.filter(item => item.reference_number.toLowerCase().includes(query));
  const visibleEligible = eligible.filter(item => item.reference_number.toLowerCase().includes(query));
  if (!standalone && !refunds.length && !eligible.length && !error && !message) return null;
  return <section aria-label="Refund requests" className={standalone ? "min-w-0 space-y-4 [overflow-wrap:anywhere]" : "mt-8 rounded-xl border border-neutral/10 bg-white p-4 sm:p-6"}>
    {!standalone && <h3 className="mb-3 text-lg font-semibold">Refunds</h3>}
    {standalone && loading && <p role="status" className="rounded-2xl bg-base p-8 text-center text-sm text-neutral/60">Loading your refunds...</p>}
    {standalone && !loading && !error && !visibleRefunds.length && !visibleEligible.length && <div className="rounded-2xl border border-dashed border-neutral/15 bg-base/50 p-8 text-center">
      <p className="font-semibold text-neutral">{query ? "No matching refunds" : "No refunds to show"}</p>
      <p className="mt-2 text-sm text-neutral/60">{query ? "Try another reference or clear your search." : "Eligible cancellation refunds appear automatically. Verified excess payments that can be refunded will also appear here."}</p>
    </div>}
    {message && <p role="status" className="mb-3 rounded-lg bg-secondary/10 p-3 text-sm">{message}</p>}
    {error && <div role="alert" className="mb-3 rounded-lg bg-primary/10 p-3 text-sm">{error}
      <button type="button" disabled={loading || busy !== null} onClick={() => { setLoading(true); setError(null); setReload(n => n + 1); }} className="ml-3 font-semibold text-primary underline disabled:opacity-50">Try again</button>
    </div>}
    {visibleEligible.length > 0 && <div className="mb-5 space-y-3">
      <p className="text-sm text-neutral/70">You can request a refund for verified payments above your reservation bill. A manager will approve or reject the request. A cashier sends approved refunds manually through GCash or another approved method, and a manager verifies the transfer.</p>
      {visibleEligible.map((item) => <div key={item.reservation_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-secondary/30 bg-secondary/5 p-4">
        <div className="min-w-0"><p className="ui-reference font-semibold">{item.reference_number}</p><p className="text-sm">Excess payment: {currency(item.amount)}</p></div>
        <button type="button" disabled={busy !== null} onClick={() => void requestRefund(item.reservation_id)} className="min-h-11 w-full rounded-lg bg-primary px-4 py-2 sm:w-auto text-sm font-semibold text-white disabled:opacity-50">{busy === item.reservation_id ? "Requesting…" : "Request excess refund"}</button>
      </div>)}
    </div>}
    <div className="space-y-3">{visibleRefunds.map((refund) => <div key={refund.refund_id} className="min-w-0 rounded-lg bg-base p-3 text-sm [overflow-wrap:anywhere]">
      <p className="font-semibold">{refund.reference_number} · {currency(refund.amount)}</p>
      <p>{refund.request_kind === "overpayment" ? "Excess payment" : "Cancellation"} refund · {refundStatusLabels[refund.status] ?? refund.status}</p>
      <p className="text-neutral/70">Requested {new Date(refund.requested_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</p>
      {refund.status === "approved" && <p>Approved; awaiting cashier transfer.</p>}
      {refund.status === "pending" && <p>Your request is awaiting manager approval. Cancellation refunds are created automatically.</p>}
      {refund.status === "reviewed" && <p>Your request is awaiting manager approval.</p>}
      {refund.status === "payout_submitted" && <p>The transfer was documented and is awaiting manager verification. It is not completed yet.</p>}
      {refund.status === "refunded" && <p>The refund transfer was verified and your net payment records were updated.</p>}
      {refund.review_reason && <p>Review note: {refund.review_reason}</p>}
      {refund.destination_requested_at && ["pending", "reviewed", "approved"].includes(refund.status) && <RefundDestinationReply refund={refund} methods={methods} onSaved={() => setReload(n => n + 1)} />}
      {refund.gcash_reference && <p>Transfer reference: {refund.gcash_reference}</p>}
    </div>)}</div>
  </section>;
}
