"use client";

import BillingDocument from "./BillingDocument";
import type { InvoiceViewDetails } from "./types";
import { formatManilaDateTime } from "@/lib/booking/manila-date";

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(value);
const titleCase = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());

export default function InvoiceDocument({ details }: { details: InvoiceViewDetails }) {
  const { invoice, reservation, transaction, latestReceipt } = details;
  const metadata = [
    ["Invoice ID", invoice.invoice_id],
    ["Issued at", formatManilaDateTime(invoice.created_at)],
    ["Reservation reference", reservation?.reference_number ?? "Not recorded"],
    ["Reservation status", reservation ? titleCase(reservation.status ?? "pending") : "Not recorded"],
    ["Scheduled check-in", reservation ? formatManilaDateTime(reservation.start_datetime) : "Not recorded"],
    ["Scheduled check-out", reservation ? formatManilaDateTime(reservation.end_datetime) : "Not recorded"],
  ];
  const lines = [
    ...details.unitBreakdown.map(item => ({ name: item.name, quantity: item.quantity, rate: `${money(item.pricePerNight)}/night × ${details.nights}`, total: item.lineTotal })),
    ...details.serviceBreakdown.map(item => ({ name: item.name, quantity: item.quantity, rate: money(item.priceAtTime), total: item.lineTotal })),
  ];
  const totals: [string, string][] = [
    ["Accommodation subtotal", money(details.unitsSubtotal)],
    ["Services subtotal", money(details.servicesSubtotal)],
    ["Itemized subtotal", money(details.computedTotal)],
    ["Invoice amount at issue", money(Number(invoice.total_amount))],
    ...(transaction ? [
      ["Current billing total", money(Number(transaction.total_amount))],
      ["Verified amount paid", money(Number(transaction.paid_amount ?? 0))],
      ["Outstanding balance", money(Number(transaction.balance ?? 0))],
      ["Payment status", titleCase(transaction.status)],
    ] as [string, string][] : []),
  ];

  return <BillingDocument title="Invoice" kicker="Reservation billing" intro="Review the reservation charges, verified payments, and outstanding balance." recordName="invoice">
    <section className="receipt-section"><h2>Invoice details</h2>
      <dl className="invoice-metadata">{metadata.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </section>
    <section className="receipt-section"><h2>Charge breakdown</h2>
      {lines.length ? <table className="invoice-items" aria-label="Invoice charges">
        <thead><tr><th scope="col">Description</th><th scope="col">Qty</th><th scope="col">Rate</th><th scope="col">Amount</th></tr></thead>
        <tbody>{lines.map((item, index) => <tr key={index}><td>{item.name}</td><td>{item.quantity}</td><td>{item.rate}</td><td>{money(item.total)}</td></tr>)}</tbody>
      </table> : <p className="receipt-caption">No itemized charges recorded.</p>}
    </section>
    <section className="receipt-section"><h2>Billing summary</h2>
      <table className="receipt-table" aria-label="Invoice billing summary"><tbody>{totals.map(([label, value]) => <tr key={label} className={label === "Outstanding balance" ? "receipt-balance-row" : undefined}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody></table>
      <p className="receipt-caption">The invoice amount reflects the bill when issued. Current billing totals may include later adjustments beyond the itemized charges above.</p>
    </section>
    <section className="receipt-section"><h2>Verified payments</h2>
      {details.verifiedPayments.length ? <table className="invoice-items" aria-label="Invoice verified payments">
        <thead><tr><th scope="col">Payment reference</th><th scope="col">Paid at</th><th scope="col">Amount</th></tr></thead>
        <tbody>{details.verifiedPayments.map(payment => <tr key={payment.payment_id}><td>{payment.reference_number}</td><td>{payment.paid_at ? formatManilaDateTime(payment.paid_at) : "Not recorded"}</td><td>{money(Number(payment.amount))}</td></tr>)}</tbody>
      </table> : <p className="receipt-caption">No verified payments recorded.</p>}
      {latestReceipt && <p className="receipt-caption">Latest receipt: {latestReceipt.receipt_number} · Issued {formatManilaDateTime(latestReceipt.issued_at)}</p>}
      <p className="receipt-caption">All dates and times are in Philippine time. All amounts are in Philippine pesos (PHP). This invoice is a billing statement; payment receipts confirm individual payments.</p>
    </section>
  </BillingDocument>;
}
