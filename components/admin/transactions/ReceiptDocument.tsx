"use client";

import type { ReactNode } from "react";
import BillingDocument from "./BillingDocument";
import type { ViewField } from "./types";

const paymentLabels = new Set(["Payment Method", "Payment Ref", "Paid At", "Amount Paid", "Booking Total at Payment", "Collection Total", "Balance After Payment", "Total before discount", "Discount applied", "Discount details", "Discount amount"]);

/** Use saved receipt values, never a live bill that may have changed since payment. */
export default function ReceiptDocument({ fields, children }: { fields: ViewField[]; children?: ReactNode }) {
  const renderTable = (rows: ViewField[], label: string) => <table className="receipt-table" aria-label={label}>
    <tbody>{rows.map(field => <tr key={field.label} className={field.label === "Amount Paid" ? "receipt-payment-amount" : field.label === "Balance After Payment" ? "receipt-balance-row" : undefined}>
      <th scope="row">{field.label}: </th><td>{field.value || "Not recorded"}</td>
    </tr>)}</tbody>
  </table>;

  return <BillingDocument title="Payment Receipt" kicker="Payment confirmation" intro="This receipt confirms the payment received by the resort." recordName="receipt" toolbar={children}>
      <section className="receipt-section"><h2>Receipt details</h2>{renderTable(fields.filter(field => !paymentLabels.has(field.label)), "Receipt details")}</section>
      <section className="receipt-section"><h2>Payment summary</h2>{renderTable(fields.filter(field => paymentLabels.has(field.label)), "Payment summary")}
        <p className="receipt-caption">All dates and times are in Philippine time. Amounts reflect this receipt at the time of payment.</p>
      </section>
  </BillingDocument>;
}
