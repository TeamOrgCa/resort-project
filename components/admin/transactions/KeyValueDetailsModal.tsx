"use client";

import type { ViewDetailsState } from "./types";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useSiteContent, contentText } from "@/components/content/SiteContent";
import { useAdminReadOnly } from "@/components/admin/AdminReadOnlyContext";

interface KeyValueDetailsModalProps {
  details: ViewDetailsState;
  onClose: () => void;
}
const receiptFields = new Set(["Receipt No.", "Issued At", "Guest Name", "Billed To", "Reservation Ref", "Payment for", "Payment Method", "Payment Ref", "Paid At", "Amount Paid", "Booking Total at Payment", "Transaction Total at Time", "Balance After Payment"]);

export default function KeyValueDetailsModal({ details, onClose }: KeyValueDetailsModalProps) {
  const readOnly = useAdminReadOnly();
  const content = useSiteContent();
  const isReceipt = details.kind === "receipt";
  const fields = isReceipt ? details.fields.filter(field => receiptFields.has(field.label)).map(field => ({ ...field,
    label: field.label === "Billed To" ? "Guest Name" : field.label === "Transaction Total at Time" ? "Booking Total at Payment" : field.label,
  })) : details.fields;
  useEffect(() => {
    if (readOnly || !isReceipt || !details.printOnOpen) return;
    const timer = window.setTimeout(() => window.print(), 150);
    return () => window.clearTimeout(timer);
  }, [details, isReceipt, readOnly]);

  const modal = (
    <div id={isReceipt ? "billing-receipt-print" : undefined} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral/45 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6" role="dialog" aria-modal="true" aria-label={details.title}>
      <div className="receipt-document max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral/10 bg-white p-4 shadow-2xl sm:p-6">
        {isReceipt && <div className="mb-5 border-b border-neutral/20 pb-4">
          <h2 className="text-xl font-bold">{contentText(content, "resort.name")}</h2>
          <p className="mt-1 whitespace-pre-line text-sm">{contentText(content, "resort.address")}</p>
          <p className="text-sm">{contentText(content, "resort.email")}</p>
        </div>}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral/10 pb-5">
          <div>
            <h3 className="text-lg font-semibold text-neutral">{isReceipt ? "Payment Receipt" : details.title}</h3>
            <p className="receipt-screen-only mt-1 text-sm text-neutral/70">Detailed record view for this billing entry.</p>
          </div>
          <div className="receipt-screen-only flex flex-wrap gap-2">
            {isReceipt && !readOnly && <button type="button" onClick={() => window.print()} className="admin-button-primary">Print receipt</button>}
            <button
              type="button"
              onClick={onClose}
              className="admin-button-secondary"
            >
              Close
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-2 text-sm text-neutral/80 sm:grid-cols-2">
          {fields.map((field) => (
            <p key={field.label} className="receipt-field flex min-w-0 flex-col gap-1">
              {field.label}: <span className={`font-semibold text-neutral ${/amount|total|balance|status|method|paid at|issued at|payment for/i.test(field.label) ? "ui-nowrap max-w-full overflow-x-auto" : "break-words"}`}>{field.value || "-"}</span>
            </p>
          ))}
        </div>
      </div>
    </div>
  );
  return isReceipt ? createPortal(modal, document.body) : modal;
}
