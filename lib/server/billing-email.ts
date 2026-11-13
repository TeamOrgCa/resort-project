import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPaymentReceiptEmail, sendReservationInvoiceEmail } from "@/lib/email";
import { buildBillingBreakdown, type BilledService, type BilledUnit } from "@/lib/booking/billing-breakdown";
import { tryCreateAdminClient } from "@/lib/supabase/admin";

export type BillingEmailResult = {
  receiptSent: boolean; invoiceSent: boolean;
  receiptAlreadySent?: boolean; invoiceAlreadySent?: boolean;
  error?: string;
};

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
  paymentId: string | null,
  paymentAmount: number,
  options: { invoiceOnly?: boolean; expectedTotal?: number; updatedAt?: string } = {},
) {
  const result: BillingEmailResult = { receiptSent: false, invoiceSent: false };
  const updatedAt = options.invoiceOnly ? options.updatedAt ?? new Date().toISOString() : options.updatedAt;
  let metadataClient: SupabaseClient | null = null;

  let { data: enabled, error: settingError } = await supabase.rpc("billing_email_enabled");
  if (settingError) {
    console.warn("Billing email setting RPC unavailable; using the authorized server fallback.", { code: settingError.code, message: settingError.message });
    // Callers have already authorized and committed the payment or bill edit. Read
    // only its email preference with the server client if the legacy RPC is
    // missing, stale in PostgREST, or denies the cashier session.
    metadataClient = tryCreateAdminClient();
    if (metadataClient) {
      const setting = await metadataClient.from("business_settings").select("setting_value")
        .eq("setting_key", "payments.receipt_settings").maybeSingle();
      if (!setting.error) {
        enabled = String(setting.data?.setting_value?.emailEnabled) !== "false";
        settingError = null;
      }
    }
    if (settingError) {
      result.error = "Billing emails were not sent because the receipt email setting could not be read. Apply the billing email migration or check the server configuration.";
      return result;
    }
  }
  if (enabled === false) { result.error = "Billing emails are disabled in Configuration > Receipt settings (emailEnabled)."; return result; }

  const recordDelivery = async (type: "receipt" | "invoice", id: string, sent: boolean) => {
    const { error } = await supabase.rpc("record_billing_email_delivery", {
      p_document_type: type, p_document_id: id, p_sent: sent,
      p_error: sent ? null : "Email delivery failed; check mail configuration or provider logs.",
    });
    if (!error) return;
    metadataClient ??= tryCreateAdminClient();
    if (metadataClient) {
      const { error: fallbackError } = await metadataClient.from(type === "receipt" ? "receipts" : "invoices")
        .update({ email_sent: sent, email_sent_at: sent ? new Date().toISOString() : null,
          email_error: sent ? null : "Email delivery failed; check mail configuration or provider logs." })
        .eq(type === "receipt" ? "receipt_id" : "invoice_id", id);
      if (!fallbackError) return;
    }
    console.error("Unable to save billing email delivery status.", { documentType: type, code: error.code, message: error.message });
    result.error = "Email was processed, but its delivery status could not be saved. Check the billing email migration before retrying.";
  };

  const guestQuery = reservation.guest_id
    ? supabase.from("guests").select("email, first_name, last_name").eq("id", reservation.guest_id).maybeSingle<Guest>()
    : reservation.walk_in_guest_id
      ? supabase.from("walk_in_guests").select("email, first_name, last_name").eq("walk_in_guest_id", reservation.walk_in_guest_id).maybeSingle<Guest>()
      : null;
  if (!guestQuery) { result.error = "No guest is linked to this reservation for billing email delivery."; return result; }
  const { data: guest, error: guestError } = await guestQuery;
  if (guestError || !guest?.email) {
    if (guestError) console.error("Unable to read billing email recipient.", guestError);
    result.error = guestError ? "Unable to read the guest's billing email address." : "This guest has no email address for billing document delivery.";
    return result;
  }

  const [receiptResult, invoiceResult, transactionResult, chargesResult, unitsResult, servicesResult, paymentResult] = await Promise.all([
    options.invoiceOnly ? Promise.resolve({ data: null, error: null }) : supabase.from("receipts").select("receipt_id, receipt_number, issued_at, email_sent, amount_paid, transaction_total_at_time, balance_after_payment, billed_to_name")
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
    // Read optional provider/beta metadata without requiring a new schema migration.
    options.invoiceOnly ? Promise.resolve({ data: null, error: null }) : supabase.from("payments").select("*,payment_methods(name)").eq("payment_id",paymentId).maybeSingle(),
  ]);
  const { data: receipt } = receiptResult;
  const { data: issuedInvoice } = invoiceResult;
  const { data: transaction } = transactionResult;
  const { data: charges } = chargesResult;
  const queryError = [receiptResult, invoiceResult, transactionResult, chargesResult, unitsResult, servicesResult, paymentResult]
    .find((query) => query.error)?.error;
  if (queryError || !transaction || !charges) {
    console.error("Unable to load billing details for email.", queryError ?? "Missing transaction or reservation charges.");
    result.error = "Unable to load the issued billing documents. Check the billing migrations and server log.";
    return result;
  }
  // Do not label a newer concurrent edit with this edit's total or timestamp.
  if (options.invoiceOnly && (Number(transaction.total_amount) !== options.expectedTotal
    || (issuedInvoice && Number(issuedInvoice.total_amount) !== options.expectedTotal))) {
    result.error = "The bill changed again before the updated statement could be sent. View the latest bill in Manage Booking.";
    return result;
  }
  // Pending bookings have a bill but no confirmation invoice yet. Email their
  // current statement using the booking reference without creating an invoice.
  const invoice = issuedInvoice ?? (options.invoiceOnly ? {
    invoice_id: undefined, created_at: updatedAt, status: "issued",
    total_amount: transaction.total_amount, email_sent: false,
  } : null);

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
    paymentMethod: paymentResult.data ? relatedName(paymentResult.data.payment_methods as NameRelation, "Not recorded") : undefined,
    paymentReference: paymentResult.data?.beta_receipt_reference || paymentResult.data?.reference_number || undefined,
    paidAt: paymentResult.data?.receipt_paid_at || paymentResult.data?.paid_at || null,
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
      guestName: receipt.billed_to_name || base.guestName,
      receiptNumber: receipt.receipt_number,
      issuedAt: receipt.issued_at,
      amountPaid: Number(receipt.amount_paid ?? paymentAmount),
      totalAmount: Number(receipt.transaction_total_at_time ?? totalAmount),
      balance: Number(receipt.balance_after_payment ?? balance),
      breakdown: buildBillingBreakdown({ ...breakdownInput, recordedTotal: Number(receipt.transaction_total_at_time ?? totalAmount) }),
    });
    await recordDelivery("receipt", receipt.receipt_id, result.receiptSent);
  }

  let invoiceAttempted = false;
  if (invoice && (options.invoiceOnly || !invoice.email_sent || (receipt && !receipt.email_sent)) && ["issued", "partially_paid", "paid"].includes(invoice.status) && Number(invoice.total_amount) >= 0) {
    invoiceAttempted = true;
    result.invoiceSent = await sendReservationInvoiceEmail({
      ...base,
      invoiceId: invoice.invoice_id,
      issuedAt: invoice.created_at,
      updatedAt,
      totalAmount: Number(invoice.total_amount),
      paidAmount,
      balance,
      breakdown: buildBillingBreakdown({ ...breakdownInput, recordedTotal: Number(invoice.total_amount) }),
    });
    if (invoice.invoice_id) await recordDelivery("invoice", invoice.invoice_id, result.invoiceSent);
  }

  if (receipt?.email_sent) result.receiptAlreadySent = true;
  if (invoice?.email_sent && !invoiceAttempted) result.invoiceAlreadySent = true;
  if ((!options.invoiceOnly && !receipt) || !invoice) result.error ??= "A receipt or invoice was not found. Check the issued documents before retrying email delivery.";
  else if ((!options.invoiceOnly && !result.receiptSent && !result.receiptAlreadySent) || (!result.invoiceSent && !result.invoiceAlreadySent))
    result.error ??= "A billing email could not be sent. Check the server log for PDF generation or mail-provider errors.";

  return result;
}

/** Call only after an authorized, committed bill edit. Delivery failure must not undo the edit. */
export async function emailUpdatedBillingStatement(reservationId: string, expectedTotal: number): Promise<{ sent: boolean; error?: string }> {
  try {
    const supabase = tryCreateAdminClient();
    if (!supabase) return { sent: false, error: "The server email configuration is unavailable." };
    const { data: reservation, error } = await supabase.from("reservations")
      .select("reservation_id,guest_id,walk_in_guest_id,reference_number,start_datetime,end_datetime")
      .eq("reservation_id", reservationId).maybeSingle<Reservation>();
    if (error || !reservation) return { sent: false, error: "Unable to load the reservation for statement delivery." };
    const result = await emailBillingDocuments(supabase, reservation, null, 0, {
      invoiceOnly: true, expectedTotal, updatedAt: new Date().toISOString(),
    });
    return { sent: result.invoiceSent, ...(result.error ? { error: result.error } : {}) };
  } catch (error) {
    console.error("Bill saved but updated statement delivery failed.", error);
    return { sent: false, error: "The updated billing statement could not be emailed. View the latest bill in Manage Booking." };
  }
}
