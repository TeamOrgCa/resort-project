import { buildBillingBreakdown } from "@/lib/booking/billing-breakdown";
import { billingDiscountSnapshot } from "@/lib/booking/billing-discount";
import type { InvoiceViewDetails } from "./types";

/** Invoices track the current bill; receipts retain the individual payment snapshot. */
export function invoiceBillingBreakdown(details: InvoiceViewDetails) {
  const r = details.reservation;
  return buildBillingBreakdown({
    bookingMode: r?.booking_mode ?? null,
    startDatetime: r?.start_datetime ?? details.invoice.created_at,
    endDatetime: r?.end_datetime ?? details.invoice.created_at,
    adultCount: Number(r?.adult_count ?? 0), childCount: Number(r?.child_count ?? 0),
    adultRate: null, childRate: null,
    units: details.unitBreakdown.map(item => ({ name: item.name, quantity: item.quantity, pricePerPeriod: item.pricePerNight })),
    services: details.serviceBreakdown.map(item => ({ name: item.name, quantity: item.quantity, priceAtBooking: item.priceAtTime, billingType: item.billingType })),
    recordedTotal: Number(details.transaction?.total_amount ?? details.invoice.total_amount),
    discount: details.transaction ? billingDiscountSnapshot(details.transaction, Number(r?.adult_count ?? 0) + Number(r?.child_count ?? 0)) : null,
  });
}
