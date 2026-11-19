"use client";

import type { ViewDetailsState } from "./types";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useAdminReadOnly } from "@/components/admin/AdminReadOnlyContext";
import ReceiptDocument from "./ReceiptDocument";

interface KeyValueDetailsModalProps {
  details: ViewDetailsState;
  onClose: () => void;
  onSettlePayment?: () => void;
  canSettlePayment?: boolean;
  settlementMessage?: string;
}
const receiptFields = new Set(["Receipt No.", "Issued At", "Guest Name", "Billed To", "Reservation Ref", "Payment for", "Payment Method", "Payment Ref", "Paid At", "Amount Paid", "Booking Total at Payment", "Transaction Total at Time", "Balance After Payment", "Contact No.", "Collection Ref", "Access Type", "Collection Total"]);

export default function KeyValueDetailsModal({ details, onClose, onSettlePayment, canSettlePayment = false, settlementMessage }: KeyValueDetailsModalProps) {
  const readOnly = useAdminReadOnly();
  const isReceipt = details.kind === "receipt";
  const fields = isReceipt ? details.fields.filter(field => receiptFields.has(field.label)).map(field => ({ ...field,
    label: field.label === "Billed To" ? "Guest Name" : field.label === "Transaction Total at Time" ? "Booking Total at Payment" : field.label,
  })) : details.fields;
  useEffect(() => {
    if (readOnly || !isReceipt || !details.printOnOpen) return;
    const logo = document.querySelector<HTMLImageElement>("#billing-receipt-print .receipt-logo img");
    let printed = false;
    const print = () => { if (!printed) { printed = true; window.clearTimeout(fallback); window.print(); } };
    const fallback = window.setTimeout(print, 3000);
    const timer = window.setTimeout(() => {
      if (!logo || logo.complete) print();
      else { logo.addEventListener("load", print, { once: true }); logo.addEventListener("error", print, { once: true }); }
    }, 150);
    return () => { printed = true; window.clearTimeout(timer); window.clearTimeout(fallback); logo?.removeEventListener("load", print); logo?.removeEventListener("error", print); };
  }, [details, isReceipt, readOnly]);

  const modal = (
    <div id={isReceipt ? "billing-receipt-print" : undefined} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral/45 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6" role="dialog" aria-modal="true" aria-label={details.title}>
      {isReceipt ? <ReceiptDocument fields={fields}>
        {!readOnly && <button type="button" onClick={() => window.print()} className="admin-button-primary">Print receipt</button>}
        <button type="button" onClick={onClose} className="admin-button-secondary">Close</button>
      </ReceiptDocument> : <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral/10 bg-white p-4 shadow-2xl sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral/10 pb-5">
          <div>
            <h3 className="text-lg font-semibold text-neutral">{details.title}</h3>
            <p className="receipt-screen-only mt-1 text-sm text-neutral/70">Detailed record view for this billing entry.</p>
          </div>
          <div className="receipt-screen-only flex flex-wrap gap-2">
            {onSettlePayment && !readOnly && <button type="button" disabled={!canSettlePayment} onClick={() => { if (canSettlePayment) onSettlePayment(); }} className="admin-button-primary disabled:cursor-not-allowed disabled:opacity-50">Settle payment</button>}
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
              {field.label}: <span className={`font-semibold text-neutral ${/amount|total|balance|status|method|paid at|issued at/i.test(field.label) ? "ui-nowrap max-w-full overflow-x-auto" : "break-words"}`}>{field.value || "-"}</span>
            </p>
          ))}
        </div>
        {onSettlePayment && settlementMessage && <p role="status" className="mt-5 rounded-xl bg-base p-3 text-sm text-neutral/70">{settlementMessage}</p>}
      </div>}
    </div>
  );
  return isReceipt ? createPortal(modal, document.body) : modal;
}
