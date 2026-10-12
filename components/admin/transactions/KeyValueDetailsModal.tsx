"use client";

import type { ViewDetailsState } from "./types";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useSiteContent, contentText } from "@/components/content/SiteContent";

interface KeyValueDetailsModalProps {
  details: ViewDetailsState;
  onClose: () => void;
}

export default function KeyValueDetailsModal({ details, onClose }: KeyValueDetailsModalProps) {
  const content = useSiteContent();
  const isReceipt = details.kind === "receipt";
  useEffect(() => {
    if (!isReceipt || !details.printOnOpen) return;
    const timer = window.setTimeout(() => window.print(), 150);
    return () => window.clearTimeout(timer);
  }, [details, isReceipt]);

  const modal = (
    <div id={isReceipt ? "billing-receipt-print" : undefined} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral/40 px-4 py-6 sm:items-center" role="dialog" aria-modal="true" aria-label={details.title}>
      <div className="receipt-document max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral/10 bg-white p-6 shadow-xl">
        {isReceipt && <div className="mb-5 border-b border-neutral/20 pb-4">
          <h2 className="text-xl font-bold">{contentText(content, "resort.name")}</h2>
          <p className="mt-1 whitespace-pre-line text-sm">{contentText(content, "resort.address")}</p>
          <p className="text-sm">{contentText(content, "resort.email")}</p>
        </div>}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-neutral">{isReceipt ? "Payment Receipt" : details.title}</h3>
            <p className="receipt-screen-only mt-1 text-sm text-neutral/70">Detailed record view for this billing entry.</p>
          </div>
          <div className="receipt-screen-only flex gap-2">
            {isReceipt && <button type="button" onClick={() => window.print()} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-base">Print receipt</button>}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral/20 px-3 py-1.5 text-xs font-medium text-neutral hover:bg-base"
            >
              Close
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-2 text-sm text-neutral/80 sm:grid-cols-2">
          {details.fields.map((field) => (
            <p key={field.label} className={isReceipt && ["Proof Path", "Account Name", "Account Number", "Guest Email"].includes(field.label) ? "receipt-screen-only" : "receipt-field"}>
              {field.label}: <span className="font-semibold text-neutral">{field.value || "-"}</span>
            </p>
          ))}
        </div>
      </div>
    </div>
  );
  return isReceipt ? createPortal(modal, document.body) : modal;
}
