"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type PaymentReviewRecord = {
  reference_number: string;
  amount: number;
  payment_type: string;
  account_name: string | null;
  account_number: string | null;
  paid_at: string | null;
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
  onDecision: (decision: Decision) => void;
  onConfirm: () => void;
  onClose: () => void;
}

const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function PaymentReviewModal({
  payment, reservationReference, proofUrl, isProofLoading, proofError, actionError,
  canReview, decision, isSubmitting, onDecision, onConfirm, onClose,
}: PaymentReviewModalProps) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageReady = Boolean(proofUrl && loadedUrl === proofUrl && failedUrl !== proofUrl);
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isSubmitting, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-neutral/60 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Review payment ${payment.reference_number}`}
      onClick={() => { if (!isSubmitting) onClose(); }}
    >
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Payment verification</p>
            <h2 className="mt-1 text-2xl font-semibold text-neutral">Review payment {payment.reference_number}</h2>
            <p className="mt-1 text-sm text-neutral/60">Check the proof and reconcile the payment with the receiving account before deciding.</p>
          </div>
          <button type="button" autoFocus onClick={onClose} disabled={isSubmitting} className="rounded-lg border border-neutral/20 px-3 py-1.5 text-sm text-neutral hover:bg-base disabled:opacity-50">Close</button>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,1fr)]">
          <div className="flex min-h-80 items-center justify-center rounded-xl border border-neutral/15 bg-base p-3">
            {isProofLoading ? <p className="text-sm text-neutral/60">Loading payment proof...</p> :
              proofError ? <p role="alert" className="text-center text-sm text-red-700">{proofError}</p> :
              proofUrl && failedUrl === proofUrl ? <p role="alert" className="text-center text-sm text-red-700">Payment proof image could not be displayed. You can reject this payment or reopen it to retry.</p> :
              proofUrl ? (
                <a href={proofUrl} target="_blank" rel="noopener noreferrer" className="block w-full" aria-label="Open payment proof at full size">
                  {!imageReady && <p className="mb-2 text-center text-sm text-neutral/60">Loading image...</p>}
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
                ["Status", titleCase(payment.status)],
                ["OCR screen", titleCase(payment.ocr_status)],
                ["OCR notes", payment.ocr_notes || "None"],
              ].map(([label, value]) => <div key={label}><dt className="text-neutral/60">{label}</dt><dd className="font-medium text-neutral">{value}</dd></div>)}
            </dl>

            {actionError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}

            {payment.status === "pending" && canReview && (
              <div className="border-t border-neutral/10 pt-4">
                {decision ? (
                  <div className="space-y-3">
                    <p className="text-sm text-neutral/80">
                      {decision === "approve"
                        ? "Approve only after confirming the amount and reference in the merchant transaction record. This confirms an initial reservation."
                        : "Reject this payment? If it is the first payment, the reservation date will be released."}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => onDecision(null)} disabled={isSubmitting} className="rounded-lg border border-neutral/20 px-4 py-2 text-sm text-neutral disabled:opacity-50">Back</button>
                      <button type="button" onClick={onConfirm} disabled={isSubmitting} className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${decision === "approve" ? "bg-green-700" : "bg-red-700"}`}>
                        {isSubmitting ? "Processing..." : decision === "approve" ? "Confirm approval" : "Confirm rejection"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => onDecision("approve")} disabled={!imageReady || isProofLoading} className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Approve</button>
                    <button type="button" onClick={() => onDecision("reject")} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white">Reject</button>
                  </div>
                )}
              </div>
            )}
            {payment.status === "pending" && !canReview && <p className="text-sm text-neutral/60">Only admins and cashiers can approve or reject payments.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
