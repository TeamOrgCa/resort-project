"use client";

import { invoiceBillingBreakdown } from "./invoice-breakdown";

import { AdminFormSkeleton } from "@/components/admin/AdminSkeletons";
import { createPortal } from "react-dom";
import { usePortalTarget } from "@/lib/use-portal-target";
import InvoiceDocument from "./InvoiceDocument";

import type { InvoiceViewDetails } from "./types";
import { formatManilaDate, formatManilaDateTime } from "@/lib/booking/manila-date";

interface InvoiceDetailsModalProps {
  isOpen: boolean;
  isLoading: boolean;
  error: string | null;
  invoiceDetails: InvoiceViewDetails | null;
  onClose: () => void;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(value);

const formatDateTime = (value: string) => {
  return formatManilaDateTime(value);
};

const formatDate = (value: string) => {
  return formatManilaDate(value);
};

const toTitleCase = (value: string) =>
  value
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export default function InvoiceDetailsModal({ isOpen, isLoading, error, invoiceDetails, onClose }: InvoiceDetailsModalProps) {
  const portalTarget = usePortalTarget();
  const breakdown = invoiceDetails ? invoiceBillingBreakdown(invoiceDetails) : null;
  const discount = breakdown?.lines.find(line => line.kind === "discount");
  const canPrint = Boolean(portalTarget && !isLoading && !error && invoiceDetails);
  if (!isOpen) {
    return null;
  }

  return (
    <>
    {canPrint && invoiceDetails && portalTarget && createPortal(
      <div id="billing-invoice-print" aria-hidden="true"><InvoiceDocument details={invoiceDetails} /></div>, portalTarget,
    )}
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral/45 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-neutral/10 bg-white p-4 shadow-2xl sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral/10 pb-5">
          <div>
            <h3 className="text-lg font-semibold text-neutral">Invoice Details</h3>
            <p className="mt-1 text-sm text-neutral/70">Complete invoice, reservation, payment, and billing summary.</p>
          </div>
          <div className="flex flex-wrap gap-2">
          <button type="button" className="admin-button-primary" disabled={!canPrint} onClick={() => { if (canPrint) window.print(); }}>
            Print invoice
          </button>
          <button
            type="button"
            onClick={onClose}
            className="admin-button-secondary"
          >
            Close
          </button>
          </div>
        </div>

        {isLoading && <AdminFormSkeleton label="Loading invoice details..." fields={6} />}

        {error ? <p className="mt-4 rounded-xl border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">{error}</p> : null}

        {!isLoading && invoiceDetails ? (
          <div className="mt-5 space-y-6">
            <section className="rounded-xl border border-neutral/10 p-4">
              <h4 className="text-sm font-semibold text-neutral">Invoice</h4>
              <div className="mt-3 grid gap-2 text-sm text-neutral/80 sm:grid-cols-2">
                <p>
                  Invoice ID: <span className="font-semibold text-neutral">{invoiceDetails.invoice.invoice_id}</span>
                </p>
                <p>
                  Created At: <span className="ui-nowrap inline-block max-w-full overflow-x-auto align-bottom font-semibold text-neutral">{formatDateTime(invoiceDetails.invoice.created_at)}</span>
                </p>
                <p>
                  Reservation Ref: <span className="font-semibold text-neutral">{invoiceDetails.reservation?.reference_number ?? "-"}</span>
                </p>
                <p>
                  Invoice Amount: <span className="ui-nowrap inline-block max-w-full overflow-x-auto align-bottom font-semibold text-neutral">{formatCurrency(Number(invoiceDetails.invoice.total_amount ?? 0))}</span>
                </p>
              </div>
            </section>

            <section className="rounded-xl border border-neutral/10 p-4">
              <h4 className="text-sm font-semibold text-neutral">Reservation Context</h4>
              <div className="mt-3 grid gap-2 text-sm text-neutral/80 sm:grid-cols-2">
                <p>
                  Booking Type: <span className="ui-nowrap inline-block max-w-full overflow-x-auto align-bottom font-semibold text-neutral">{toTitleCase(invoiceDetails.reservation?.booking_type ?? "online")}</span>
                </p>
                <p>
                  Reservation Status: <span className="ui-nowrap inline-block max-w-full overflow-x-auto align-bottom font-semibold text-neutral">{toTitleCase(invoiceDetails.reservation?.status ?? "pending")}</span>
                </p>
                <p>
                  Check-in: <span className="font-semibold text-neutral">{invoiceDetails.reservation ? formatDate(invoiceDetails.reservation.start_datetime) : "-"}</span>
                </p>
                <p>
                  Check-out: <span className="font-semibold text-neutral">{invoiceDetails.reservation ? formatDate(invoiceDetails.reservation.end_datetime) : "-"}</span>
                </p>
              </div>
            </section>

            <section className="rounded-xl border border-neutral/10 p-4">
              <h4 className="text-sm font-semibold text-neutral">Transaction Summary</h4>
              <div className="mt-3 grid gap-2 text-sm text-neutral/80 sm:grid-cols-2">
                <p>
                  Total: <span className="ui-nowrap inline-block max-w-full overflow-x-auto align-bottom font-semibold text-neutral">{formatCurrency(Number(invoiceDetails.transaction?.total_amount ?? 0))}</span>
                </p>
                <p>
                  Paid: <span className="ui-nowrap inline-block max-w-full overflow-x-auto align-bottom font-semibold text-neutral">{formatCurrency(Number(invoiceDetails.transaction?.paid_amount ?? 0))}</span>
                </p>
                <p>
                  Balance: <span className="ui-nowrap inline-block max-w-full overflow-x-auto align-bottom font-semibold text-neutral">{formatCurrency(Number(invoiceDetails.transaction?.balance ?? 0))}</span>
                </p>
                <p>
                  Status: <span className="ui-nowrap inline-block max-w-full overflow-x-auto align-bottom font-semibold text-neutral">{toTitleCase(invoiceDetails.transaction?.status ?? "unpaid")}</span>
                </p>
              </div>
            </section>

            <section className="rounded-xl border border-neutral/10 p-4">
              <h4 className="text-sm font-semibold text-neutral">Cost Breakdown</h4>
              <div className="mt-3 space-y-3 text-sm text-neutral/80">
                {breakdown?.lines.map((line, index) => <div key={index} className="flex flex-wrap justify-between gap-2">
                  <div className="min-w-0 flex-1"><p className="font-semibold">{line.description}</p><p className="text-xs text-neutral/65">{line.detail}</p></div>
                  <span className="whitespace-nowrap">{formatCurrency(line.amount)}</span>
                </div>)}
                <div className="rounded-xl bg-base px-3 py-2">
                  {discount && <p>Total before discount: {formatCurrency(Number(breakdown?.total ?? 0) - discount.amount)}</p>}
                  <p className="font-semibold">{discount ? "Total after discount" : "Total charges"}: {formatCurrency(Number(breakdown?.total ?? 0))}</p>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-neutral/10 p-4">
              <h4 className="text-sm font-semibold text-neutral">Verified Payments</h4>
              {invoiceDetails.verifiedPayments.length === 0 ? (
                <p className="mt-3 text-sm text-neutral/70">No verified payments found for this invoice yet.</p>
              ) : (
                <div className="mt-3 space-y-2 text-sm text-neutral/80">
                  {invoiceDetails.verifiedPayments.map((payment) => (
                    <p key={payment.payment_id}>
                      <span className="font-semibold text-neutral">{payment.reference_number}</span> • {formatCurrency(Number(payment.amount ?? 0))} • {formatDateTime(payment.paid_at ?? "")}
                    </p>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-neutral/10 p-4">
              <h4 className="text-sm font-semibold text-neutral">Latest Receipt</h4>
              <div className="mt-3 grid gap-2 text-sm text-neutral/80 sm:grid-cols-2">
                <p>
                  Receipt No.: <span className="font-semibold text-neutral">{invoiceDetails.latestReceipt?.receipt_number ?? "-"}</span>
                </p>
                <p>
                  Issued At: <span className="font-semibold text-neutral">{invoiceDetails.latestReceipt ? formatDateTime(invoiceDetails.latestReceipt.issued_at) : "-"}</span>
                </p>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
    </>
  );
}
