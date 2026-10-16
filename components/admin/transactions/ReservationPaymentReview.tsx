"use client";

import { useEffect, useRef, useState } from "react";
import LoadingState from "@/components/ui/LoadingState";
import PaymentReviewModal, { type PaymentReviewRecord } from "./PaymentReviewModal";
import { createClient } from "@/lib/supabase/client";
import { PAYMENT_PROOF_BUCKET } from "@/lib/booking/payment-proof";

type Payment = PaymentReviewRecord & { payment_id: string; reservation_id: string };
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

export default function ReservationPaymentReview({ reservationId, reference, onReviewed, onBusyChange }: {
  reservationId: string; reference: string; onReviewed: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [payments, setPayments] = useState<Payment[]>([]), [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0), [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Payment | null>(null);
  const [proof, setProof] = useState<{ id: string; url: string | null; error: string | null } | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const [noticeWarning, setNoticeWarning] = useState(false);
  const submitting = useRef(false);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await createClient().from("payments").select("payment_id,reservation_id,reference_number,amount,payment_type,account_name,account_number,paid_at,receipt_paid_at,proof_path,status,ocr_status,ocr_notes")
          .eq("reservation_id", reservationId).eq("status", "pending").order("created_at").limit(100);
        if (!active) return;
        if (error) setLoadError("Unable to load submitted payments. Please retry.");
        else { setPayments((data ?? []) as Payment[]); setLoadError(null); }
      } catch { if (active) setLoadError("Unable to load submitted payments. Please retry."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [reservationId, revision]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const id = selected.payment_id;
    if (!selected.proof_path) {
      void Promise.resolve().then(() => { if (active) setProof({ id, url: null, error: "This payment has no uploaded proof file." }); });
    } else {
      createClient().storage.from(PAYMENT_PROOF_BUCKET).createSignedUrl(selected.proof_path, 600)
        .then(({ data, error }) => { if (active) setProof({ id, url: data?.signedUrl ?? null, error: error || !data?.signedUrl ? "Unable to load payment proof. Close the review and retry." : null }); })
        .catch(() => { if (active) setProof({ id, url: null, error: "Unable to load payment proof. Close the review and retry." }); });
    }
    return () => { active = false; };
  }, [selected]);

  const refresh = () => { setLoading(true); setLoadError(null); setRevision(value => value + 1); };
  async function submit(reason?: string) {
    if (!selected || !decision || submitting.current) return;
    if (decision === "reject" && (!reason || reason.trim().length < 5 || reason.trim().length > 2000)) { setError("Enter a rejection reason of 5 to 2,000 characters."); return; }
    if (decision === "approve" && (!proof?.url || (selected.receipt_paid_at && !reviewed))) return;
    const paymentId = selected.payment_id;
    submitting.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/admin/payments/${decision === "approve" ? "approve" : "reject"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId, screenshotReviewed: reviewed, rejectionReason: reason }) });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) throw new Error(result?.message ?? "Unable to review this payment.");
      setNoticeWarning(decision === "reject" && result.notificationSent === false);
      setMessage(decision === "approve" ? "Payment approved. Reservation and billing records are refreshing."
        : `Payment rejected. The reason has been saved.${result.notificationSent === true ? " The guest was notified in-app." : result.notificationSent === false ? " Guest notification delivery could not be confirmed; contact the guest directly." : ""}`);
      setSelected(null); setDecision(null); setReviewed(false); refresh(); onReviewed();
    } catch (cause) {
      // A financial change can commit before email/receipt follow-up fails. Reconcile
      // the saved status before enabling any retry of the same payment.
      try {
        const current = await createClient().from("payments").select("status").eq("payment_id", paymentId).maybeSingle();
        if (current.error) { setError("Unable to confirm the saved payment status. Close this review and refresh before trying again."); setDecision(null); return; }
        if (current.data && current.data.status !== "pending") {
          setSelected(null); setNoticeWarning(true); setMessage(`The payment is now ${current.data.status}. A follow-up step may have failed; refresh the billing records before taking further action.`); refresh(); onReviewed(); return;
        }
      } catch { setError("Unable to confirm the saved payment status. Close this review and refresh before trying again."); setDecision(null); return; }
      setError(cause instanceof Error ? cause.message : "Unable to review payment.");
    } finally { submitting.current = false; setBusy(false); }
  }

  return <section aria-label="Reservation payment review" className="mb-5 space-y-3 rounded-xl border border-neutral/15 bg-base p-3 sm:p-4">
    <h3 className="font-semibold text-neutral">Submitted payments</h3>
    {message && <p role={noticeWarning ? "alert" : "status"} className={`rounded-xl p-3 text-sm ${noticeWarning ? "bg-amber-50 text-amber-900" : "bg-green-50 text-green-900"}`}>{message}</p>}
    {loading && <LoadingState compact title="Loading submitted payments..." description="Checking receipts awaiting review." />}
    {loadError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{loadError}<button type="button" onClick={refresh} className="ml-2 min-h-11 underline">Retry payments</button></p>}
    {!loading && !loadError && !payments.length && <p className="text-sm text-neutral/60">No payments awaiting review for this reservation.</p>}
    {!loading && !loadError && !selected && payments.map(payment => <div key={payment.payment_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3 text-sm">
      <div className="min-w-0"><p className="break-all font-medium text-neutral">{payment.reference_number}</p><p className="mt-1 text-neutral/65">{money(Number(payment.amount))} - {payment.payment_type.replaceAll("_", " ")}</p></div>
      <button type="button" onClick={() => { setSelected(payment); setProof(null); setDecision(null); setReviewed(false); setError(null); setMessage(null); }} className="min-h-11 rounded-xl border border-primary/30 px-4 py-2 font-semibold text-primary">Review payment</button>
    </div>)}
    {selected && <PaymentReviewModal key={selected.payment_id} embedded payment={selected} reservationReference={reference}
      proofUrl={proof?.id === selected.payment_id ? proof.url : null} isProofLoading={proof?.id !== selected.payment_id} proofError={proof?.id === selected.payment_id ? proof.error : null}
      actionError={error} canReview decision={decision} isSubmitting={busy} screenshotReviewed={reviewed} onScreenshotReviewed={setReviewed} onDecision={setDecision}
      onConfirm={reason => void submit(reason)} onClose={() => { if (!submitting.current) setSelected(null); }} />}
  </section>;
}
