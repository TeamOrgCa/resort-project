"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import LoadingState from "@/components/ui/LoadingState";

export type PaymentReviewRecord = {
  reference_number: string;
  amount: number;
  payment_type: string;
  account_name: string | null;
  account_number: string | null;
  paid_at: string | null;
  receipt_paid_at?: string | null;
  proof_path: string;
  status: "pending" | "verified" | "rejected";
  ocr_status: "not_applicable" | "consistent" | "mismatch" | "unreadable";
  ocr_notes: string | null;
};

type Decision = "approve" | "reject" | null;

interface PaymentReviewModalProps {
  payment: PaymentReviewRecord;
  reservationReference: string;
  proofUrl: string | null;
  isProofLoading: boolean;
  proofError: string | null;
  actionError: string | null;
  canReview: boolean;
  decision: Decision;
  isSubmitting: boolean;
  screenshotReviewed: boolean;
  onScreenshotReviewed: (checked: boolean) => void;
  onDecision: (decision: Decision) => void;
  onConfirm: (rejectionReason?: string) => void;
  onClose: () => void;
  embedded?: boolean;
}

const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function PaymentReviewModal({
  payment, reservationReference, proofUrl, isProofLoading, proofError, actionError,
  canReview, decision, isSubmitting, screenshotReviewed, onScreenshotReviewed, onDecision, onConfirm, onClose, embedded = false,
}: PaymentReviewModalProps) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const validRejectionReason = rejectionReason.trim().length >= 5 && rejectionReason.trim().length <= 2000;
  const imageReady = Boolean(proofUrl && loadedUrl === proofUrl && failedUrl !== proofUrl);
  const approvalReady = imageReady && !isProofLoading && (!payment.receipt_paid_at || screenshotReviewed);
  useEffect(() => {
    if (embedded) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isSubmitting, onClose, embedded]);

  return (
    <div
      className={embedded ? "min-w-0" : "fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-neutral/45 px-3 py-4 backdrop-blur-sm sm:px-4 sm:py-6"}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-label={`Review payment ${payment.reference_number}`}
      onClick={() => { if (!embedded && !isSubmitting) onClose(); }}
    >
      <div className={embedded ? "min-w-0 rounded-xl border border-neutral/15 bg-white p-3 sm:p-5" : "max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7"} onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral/10 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Payment verification</p>
            <h2 className="mt-1 text-2xl font-semibold text-neutral">Review payment {payment.reference_number}</h2>
            <p className="mt-1 text-sm text-neutral/60">Check the proof and reconcile the payment with the receiving account before deciding.</p>
          </div>
          <button type="button" autoFocus onClick={onClose} disabled={isSubmitting} className="rounded-xl border border-neutral/20 px-3 py-1.5 text-sm text-neutral hover:bg-base disabled:opacity-50">Close</button>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,1fr)]">
          <div className="flex min-h-80 items-center justify-center rounded-xl border border-neutral/15 bg-base p-3">
            {isProofLoading ? <LoadingState compact title="Loading payment proof..." /> :
              proofError ? <p role="alert" className="text-center text-sm text-red-700">{proofError}</p> :
              proofUrl && failedUrl === proofUrl ? <p role="alert" className="text-center text-sm text-red-700">Payment proof image could not be displayed. You can reject this payment or reopen it to retry.</p> :
              proofUrl ? (
                <a href={proofUrl} target="_blank" rel="noopener noreferrer" className="block w-full" aria-label="Open payment proof at full size">
                  {!imageReady && <LoadingState compact title="Loading image..." />}
                  <Image src={proofUrl} alt={`Payment proof for ${payment.reference_number}`} width={1200} height={900} unoptimized onLoad={() => setLoadedUrl(proofUrl)} onError={() => setFailedUrl(proofUrl)} className="mx-auto max-h-[65vh] w-auto max-w-full object-contain" />
                </a>
              ) : <p className="text-sm text-neutral/60">No payment proof available.</p>}
          </div>
          <div className="space-y-5">
            <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1">
              {[
                ["Reservation", reservationReference],
                ["Payment reference", payment.reference_number],
                ["Amount", new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(payment.amount))],
                ["Payment type", titleCase(payment.payment_type)],
                ["Sender name", payment.account_name || "-"],
                ["Sender account", payment.account_number || "-"],
                ["Submitted", payment.paid_at ? new Date(payment.paid_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "-"],
                ["GCash receipt time (Philippines)", payment.receipt_paid_at ? new Date(payment.receipt_paid_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "Not captured (legacy/manual payment)"],
                ["Status", titleCase(payment.status)],
                ["OCR screen", titleCase(payment.ocr_status)],
                ["OCR notes", payment.ocr_notes || "None"],
              ].map(([label, value]) => <div key={label}><dt className="text-neutral/60">{label}</dt><dd className="font-medium text-neutral">{value}</dd></div>)}
            </dl>

            {actionError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}

            {payment.status === "pending" && canReview && (
              <div className="border-t border-neutral/10 pt-4">
                {payment.receipt_paid_at && (
                  <label className="mb-4 flex items-start gap-3 rounded-xl bg-base p-3 text-sm text-neutral">
                    <input type="checkbox" checked={screenshotReviewed} onChange={(event) => onScreenshotReviewed(event.target.checked)} disabled={isSubmitting || !imageReady} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
                    <span>I checked this is a clear original GCash screenshot. Reject photos of another screen, scans, blurred images and edited receipts.</span>
                  </label>
                )}
                {decision ? (
                  <div className="space-y-3">
                    <p className="text-sm text-neutral/80">
                      {decision === "approve"
                        ? "Approve only after confirming the amount, reference, recipient and receipt date in the receiving account's transaction record. This confirms an initial reservation."
                        : "Reject this payment? If it is the first payment, the reservation date will be released."}
                    </p>
                    {decision === "reject" && <label className="block text-sm font-medium text-neutral">Rejection reason <span className="text-red-700">(required)</span>
                      <textarea required minLength={5} maxLength={2000} rows={3} disabled={isSubmitting} value={rejectionReason} onChange={event => setRejectionReason(event.target.value)} placeholder="Explain why this payment cannot be accepted. This reason will be shown to the guest." className="mt-2 w-full rounded-xl border border-neutral/20 bg-white p-3 text-base text-black" />
                      <span className="mt-1 block text-xs text-neutral/60">Enter 5 to 2,000 characters.</span>
                    </label>}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => onDecision(null)} disabled={isSubmitting} className="rounded-xl border border-neutral/20 px-4 py-2 text-sm text-neutral disabled:opacity-50">Back</button>
                      <button type="button" onClick={() => onConfirm(decision === "reject" ? rejectionReason.trim() : undefined)} disabled={isSubmitting || (decision === "approve" && !approvalReady) || (decision === "reject" && !validRejectionReason)} className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${decision === "approve" ? "bg-green-700" : "bg-red-700"}`}>
                        {isSubmitting ? "Processing..." : decision === "approve" ? "Confirm approval" : "Confirm rejection"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => onDecision("approve")} disabled={!approvalReady} className="rounded-xl bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Approve</button>
                    <button type="button" onClick={() => onDecision("reject")} className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white">Reject</button>
                  </div>
                )}
              </div>
            )}
            {payment.status === "pending" && !canReview && <p className="text-sm text-neutral/60">Payment approval permission is required to approve or reject payments.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
