import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPaymentReceiptEmail, sendReservationInvoiceEmail } from "@/lib/email";
import { buildBillingBreakdown, type BilledService, type BilledUnit } from "@/lib/booking/billing-breakdown";

type Reservation = {
  reservation_id: string;
  guest_id: string | null;
  walk_in_guest_id: string | null;
  reference_number: string;
  start_datetime: string;
  end_datetime: string;
};

type Guest = { email: string | null; first_name: string | null; last_name: string | null };
type NameRelation = { name: string } | { name: string }[] | null;
type UnitRow = { quantity: number | null; price_per_night: number; units: NameRelation };
type ServiceRow = { quantity: number | null; price_at_time: number; services: NameRelation };
type ReservationCharges = {
  booking_mode: string | null;
  adult_count: number;
  child_count: number;
  adult_rate_at_booking: number | null;
  child_rate_at_booking: number | null;
};

const relatedName = (relation: NameRelation, fallback: string) =>
  (Array.isArray(relation) ? relation[0]?.name : relation?.name) || fallback;

export async function emailBillingDocuments(
  supabase: SupabaseClient,
  reservation: Reservation,
  paymentId: string,
  paymentAmount: number,
) {
  const result = { receiptSent: false, invoiceSent: false };

  const { data: enabled, error: settingError } = await supabase.rpc("billing_email_enabled");
  if (settingError) {
    console.error("Unable to read billing email setting.", settingError);
    return result;
  }
  if (enabled === false) return result;

  const guestQuery = reservation.guest_id
    ? supabase.from("guests").select("email, first_name, last_name").eq("id", reservation.guest_id).maybeSingle<Guest>()
    : reservation.walk_in_guest_id
      ? supabase.from("walk_in_guests").select("email, first_name, last_name").eq("walk_in_guest_id", reservation.walk_in_guest_id).maybeSingle<Guest>()
      : null;
  if (!guestQuery) return result;
  const { data: guest, error: guestError } = await guestQuery;
  if (guestError || !guest?.email) {
    if (guestError) console.error("Unable to read billing email recipient.", guestError);
    return result;
  }

  const [receiptResult, invoiceResult, transactionResult, chargesResult, unitsResult, servicesResult] = await Promise.all([
    supabase.from("receipts").select("receipt_id, receipt_number, issued_at, email_sent, amount_paid")
      .eq("payment_id", paymentId).maybeSingle(),
    supabase.from("invoices").select("invoice_id, created_at, status, total_amount, email_sent")
      .eq("reservation_id", reservation.reservation_id).neq("status", "void")
      .order("created_at", { ascending: false }).order("invoice_id", { ascending: false })
      .limit(1).maybeSingle(),
    supabase.from("transactions").select("total_amount, paid_amount, balance")
      .eq("reservation_id", reservation.reservation_id).maybeSingle(),
    supabase.from("reservations").select("booking_mode, adult_count, child_count, adult_rate_at_booking, child_rate_at_booking")
      .eq("reservation_id", reservation.reservation_id).maybeSingle<ReservationCharges>(),
    supabase.from("reservation_units").select("quantity, price_per_night, units(name)")
      .eq("reservation_id", reservation.reservation_id),
    supabase.from("reservation_services").select("quantity, price_at_time, services(name)")
      .eq("reservation_id", reservation.reservation_id),
  ]);
  const { data: receipt } = receiptResult;
  const { data: invoice } = invoiceResult;
  const { data: transaction } = transactionResult;
  const { data: charges } = chargesResult;
  const queryError = [receiptResult, invoiceResult, transactionResult, chargesResult, unitsResult, servicesResult]
    .find((query) => query.error)?.error;
  if (queryError || !transaction || !charges) {
    console.error("Unable to load billing details for email.", queryError ?? "Missing transaction or reservation charges.");
    return result;
  }

  const units: BilledUnit[] = ((unitsResult.data as UnitRow[] | null) ?? []).map((row) => ({
    name: relatedName(row.units, "Booked unit"),
    quantity: Number(row.quantity ?? 1),
    pricePerPeriod: Number(row.price_per_night),
  }));
  const services: BilledService[] = ((servicesResult.data as ServiceRow[] | null) ?? []).map((row) => ({
    name: relatedName(row.services, "Booked service"),
    quantity: Number(row.quantity ?? 1),
    priceAtBooking: Number(row.price_at_time),
  }));

  const guestName = `${guest.first_name ?? ""} ${guest.last_name ?? ""}`.trim() || "Guest";
  const base = {
    guestEmail: guest.email,
    guestName,
    reservationReference: reservation.reference_number,
    checkInDate: reservation.start_datetime,
    checkOutDate: reservation.end_datetime,
    bookingMode: ({ day: "Day swimming", night: "Overnight swimming", whole_day: "Whole day swimming", custom: "Custom booking" } as Record<string, string>)[charges.booking_mode ?? ""] ?? "Resort booking",
    adultCount: Number(charges.adult_count),
    childCount: Number(charges.child_count),
  };
  const totalAmount = Number(transaction?.total_amount ?? 0);
  const paidAmount = Number(transaction?.paid_amount ?? 0);
  const balance = Number(transaction?.balance ?? Math.max(totalAmount - paidAmount, 0));
  const breakdownInput = {
    bookingMode: charges.booking_mode,
    startDatetime: reservation.start_datetime,
    endDatetime: reservation.end_datetime,
    adultCount: Number(charges.adult_count),
    childCount: Number(charges.child_count),
    adultRate: charges.adult_rate_at_booking === null ? null : Number(charges.adult_rate_at_booking),
    childRate: charges.child_rate_at_booking === null ? null : Number(charges.child_rate_at_booking),
    units,
    services,
  };

  if (receipt && !receipt.email_sent) {
    result.receiptSent = await sendPaymentReceiptEmail({
      ...base,
      receiptNumber: receipt.receipt_number,
      issuedAt: receipt.issued_at,
      amountPaid: Number(receipt.amount_paid ?? paymentAmount),
      totalAmount,
      balance,
      breakdown: buildBillingBreakdown({ ...breakdownInput, recordedTotal: totalAmount }),
    });
    const { error } = await supabase.rpc("record_billing_email_delivery", {
      p_document_type: "receipt",
      p_document_id: receipt.receipt_id,
      p_sent: result.receiptSent,
      p_error: result.receiptSent ? null : "Email delivery failed; check mail configuration or provider logs.",
    });
    if (error) console.error("Unable to save receipt email status.", error);
  }

  if (invoice && !invoice.email_sent && ["issued", "partially_paid", "paid"].includes(invoice.status) && Number(invoice.total_amount) > 0) {
    result.invoiceSent = await sendReservationInvoiceEmail({
      ...base,
      issuedAt: invoice.created_at,
      totalAmount: Number(invoice.total_amount),
      paidAmount,
      balance,
      breakdown: buildBillingBreakdown({ ...breakdownInput, recordedTotal: Number(invoice.total_amount) }),
    });
    const { error } = await supabase.rpc("record_billing_email_delivery", {
      p_document_type: "invoice",
      p_document_id: invoice.invoice_id,
      p_sent: result.invoiceSent,
      p_error: result.invoiceSent ? null : "Email delivery failed; check mail configuration or provider logs.",
    });
    if (error) console.error("Unable to save invoice email status.", error);
  }

  return result;
}
