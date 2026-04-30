"use client";

import { useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminMetricCard from "@/components/admin/AdminMetricCard";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import type { AdminTableColumn, AdminTableRow } from "@/components/admin/types";
import { createClient } from "@/lib/supabase/client";

const transactionTabs = ["Transaction Ledger", "Generated Invoices", "Issued Receipts"] as const;

const transactionColumns: AdminTableColumn[] = [
  { key: "reference", label: "Reservation Ref" },
  { key: "bookingType", label: "Booking Type" },
  { key: "total", label: "Total Amount" },
  { key: "paid", label: "Paid Amount" },
  { key: "balance", label: "Balance" },
  { key: "overpaid", label: "Overpaid" },
  { key: "status", label: "Status" },
  { key: "updatedAt", label: "Updated" },
];

const invoiceColumns: AdminTableColumn[] = [
  { key: "invoiceId", label: "Invoice ID" },
  { key: "reference", label: "Reservation Ref" },
  { key: "total", label: "Total Amount" },
  { key: "createdAt", label: "Created At" },
];

const receiptColumns: AdminTableColumn[] = [
  { key: "receiptNumber", label: "Receipt No." },
  { key: "reference", label: "Reservation Ref" },
  { key: "paymentReference", label: "Payment Ref" },
  { key: "issuedAt", label: "Issued At" },
  { key: "status", label: "Status" },
];

interface TransactionRow {
  transaction_id: string;
  reservation_id: string;
  total_amount: number;
  paid_amount: number | null;
  balance: number | null;
  overpaid_amount: number | null;
  status: "unpaid" | "partial" | "paid";
  created_at: string;
  updated_at: string;
}

interface ReservationRow {
  reservation_id: string;
  reference_number: string;
  booking_type: "online" | "walk_in" | null;
}

interface InvoiceRow {
  invoice_id: string;
  reservation_id: string;
  total_amount: number;
  created_at: string;
}

interface InvoiceDetailInvoiceRow {
  invoice_id: string;
  reservation_id: string;
  total_amount: number;
  created_at: string;
}

interface InvoiceDetailReservationRow {
  reference_number: string;
  booking_type: "online" | "walk_in" | null;
  status: "pending" | "confirmed" | "cancelled" | "completed" | null;
  start_datetime: string;
  end_datetime: string;
}

interface InvoiceDetailTransactionRow {
  total_amount: number;
  paid_amount: number | null;
  balance: number | null;
  status: "unpaid" | "partial" | "paid";
}

interface InvoiceDetailPaymentRow {
  payment_id: string;
  reference_number: string;
  amount: number;
  status: "pending" | "verified";
  paid_at: string | null;
}

interface InvoiceDetailReceiptRow {
  payment_id: string;
  receipt_number: string;
  issued_at: string;
  is_active: boolean | null;
  archived_at: string | null;
}

interface InvoiceDetailReservationUnitRow {
  quantity: number;
  price_per_night: number;
  units:
    | {
        name: string;
      }
    | Array<{
        name: string;
      }>
    | null;
}

interface InvoiceDetailReservationServiceRow {
  quantity: number;
  price_at_time: number;
  services:
    | {
        name: string;
      }
    | Array<{
        name: string;
      }>
    | null;
}

interface InvoiceUnitBreakdownItem {
  name: string;
  quantity: number;
  pricePerNight: number;
  lineTotal: number;
}

interface InvoiceServiceBreakdownItem {
  name: string;
  quantity: number;
  priceAtTime: number;
  lineTotal: number;
}

interface InvoiceViewDetails {
  invoice: InvoiceDetailInvoiceRow;
  reservation: InvoiceDetailReservationRow | null;
  transaction: InvoiceDetailTransactionRow | null;
  verifiedPayments: InvoiceDetailPaymentRow[];
  latestReceipt: InvoiceDetailReceiptRow | null;
  nights: number;
  unitBreakdown: InvoiceUnitBreakdownItem[];
  serviceBreakdown: InvoiceServiceBreakdownItem[];
  unitsSubtotal: number;
  servicesSubtotal: number;
  computedTotal: number;
}

interface ReceiptRow {
  receipt_id: string;
  payment_id: string;
  receipt_number: string;
  issued_at: string;
  is_active: boolean | null;
  archived_at: string | null;
}

interface PaymentRow {
  payment_id: string;
  reservation_id: string;
  reference_number: string;
}

interface ReceiptDetailReceiptRow {
  receipt_id: string;
  payment_id: string;
  receipt_number: string;
  issued_at: string;
  is_active: boolean | null;
  archived_at: string | null;
}

interface ReceiptDetailPaymentRow {
  payment_id: string;
  reservation_id: string;
  reference_number: string;
  amount: number;
  payment_method: "bank_transfer" | "e_wallet" | "cash";
  payment_type: "downpayment" | "full" | "additional";
  status: "pending" | "verified";
  paid_at: string | null;
  account_name: string;
  account_number: string | null;
  proof_path: string;
}

interface ReceiptDetailReservationRow {
  reservation_id: string;
  guest_id: string | null;
  walk_in_guest_id?: string | null;
  reference_number: string;
  booking_type: "online" | "walk_in" | null;
  status: "pending" | "confirmed" | "cancelled" | "completed" | null;
  start_datetime: string;
  end_datetime: string;
}

interface ReceiptDetailGuestRow {
  first_name: string | null;
  last_name: string | null;
  email: string;
}

interface ReceiptDetailTransactionRow {
  total_amount: number;
  paid_amount: number | null;
  balance: number | null;
  overpaid_amount: number | null;
  status: "unpaid" | "partial" | "paid";
}

interface ViewField {
  label: string;
  value: string;
}

interface ViewDetailsState {
  title: string;
  fields: ViewField[];
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(value);

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return `${date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })} ${date.toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const toTitleCase = (value: string) =>
  value
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const calculateNights = (checkInDate: string, checkOutDate: string) => {
  const checkIn = new Date(checkInDate);
  const checkOut = new Date(checkOutDate);

  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
    return 0;
  }

  const oneDayMs = 1000 * 60 * 60 * 24;
  const diffDays = Math.ceil((checkOut.getTime() - checkIn.getTime()) / oneDayMs);

  return diffDays > 0 ? diffDays : 0;
};

const deriveTransactionStatus = (totalAmount: number, paidAmount: number, balanceAmount: number) => {
  if (balanceAmount > 0 && paidAmount > 0) {
    return "partial";
  }

  if (balanceAmount > 0) {
    return "unpaid";
  }

  if (totalAmount > 0 && paidAmount >= totalAmount) {
    return "paid";
  }

  return "unpaid";
};

export default function AdminTransactionsPage() {
  const [activeTab, setActiveTab] = useState<(typeof transactionTabs)[number]>("Transaction Ledger");
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [reservationReferencesById, setReservationReferencesById] = useState<Record<string, string>>({});
  const [bookingTypesById, setBookingTypesById] = useState<Record<string, string>>({});
  const [paymentReferencesById, setPaymentReferencesById] = useState<Record<string, string>>({});
  const [paymentReservationById, setPaymentReservationById] = useState<Record<string, string>>({});
  const [viewDetails, setViewDetails] = useState<ViewDetailsState | null>(null);
  const [isInvoiceDetailsOpen, setIsInvoiceDetailsOpen] = useState(false);
  const [isInvoiceDetailsLoading, setIsInvoiceDetailsLoading] = useState(false);
  const [invoiceDetailsError, setInvoiceDetailsError] = useState<string | null>(null);
  const [invoiceDetails, setInvoiceDetails] = useState<InvoiceViewDetails | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      try {
        setIsLoading(true);
        setFetchError(null);

        const supabase = createClient();

        const { data: transactionsData, error: transactionsError } = await supabase
          .from("transactions")
          .select("transaction_id, reservation_id, total_amount, paid_amount, balance, overpaid_amount, status, created_at, updated_at")
          .order("updated_at", { ascending: false })
          .limit(200);

        if (transactionsError) {
          throw transactionsError;
        }

        const transactionList = (transactionsData as TransactionRow[] | null) ?? [];
        const reservationIds = [...new Set(transactionList.map((row) => row.reservation_id))];

        const [{ data: reservationsData, error: reservationsError }, { data: invoicesData, error: invoicesError }, { data: paymentsData, error: paymentsError }, { data: receiptsData, error: receiptsError }] =
          await Promise.all([
            reservationIds.length
              ? supabase
                  .from("reservations")
                  .select("reservation_id, reference_number, booking_type")
                  .in("reservation_id", reservationIds)
              : Promise.resolve({ data: [], error: null }),
            reservationIds.length
              ? supabase.from("invoices").select("invoice_id, reservation_id, total_amount, created_at").in("reservation_id", reservationIds)
              : Promise.resolve({ data: [], error: null }),
            reservationIds.length
              ? supabase.from("payments").select("payment_id, reservation_id, reference_number").in("reservation_id", reservationIds)
              : Promise.resolve({ data: [], error: null }),
            supabase.from("receipts").select("receipt_id, payment_id, receipt_number, issued_at, is_active, archived_at").order("issued_at", { ascending: false }).limit(200),
          ]);

        if (reservationsError) throw reservationsError;
        if (invoicesError) throw invoicesError;
        if (paymentsError) throw paymentsError;
        if (receiptsError) throw receiptsError;

        if (!isMounted) return;

        const nextReservationReferencesById = ((reservationsData as ReservationRow[] | null) ?? []).reduce<Record<string, string>>(
          (accumulator, reservation) => {
            accumulator[reservation.reservation_id] = reservation.reference_number;
            return accumulator;
          },
          {}
        );

        const nextBookingTypesById = ((reservationsData as ReservationRow[] | null) ?? []).reduce<Record<string, string>>(
          (accumulator, reservation) => {
            accumulator[reservation.reservation_id] = reservation.booking_type ?? "online";
            return accumulator;
          },
          {}
        );

        const nextPaymentReferencesById = ((paymentsData as PaymentRow[] | null) ?? []).reduce<Record<string, string>>(
          (accumulator, payment) => {
            accumulator[payment.reservation_id] = payment.reference_number;
            return accumulator;
          },
          {}
        );

        const nextPaymentReservationById = ((paymentsData as PaymentRow[] | null) ?? []).reduce<Record<string, string>>(
          (accumulator, payment) => {
            accumulator[payment.payment_id] = payment.reservation_id;
            return accumulator;
          },
          {}
        );

        setTransactions(transactionList);
        setInvoices((invoicesData as InvoiceRow[] | null) ?? []);
        setReceipts((receiptsData as ReceiptRow[] | null) ?? []);
        setReservationReferencesById(nextReservationReferencesById);
        setBookingTypesById(nextBookingTypesById);
        setPaymentReferencesById(nextPaymentReferencesById);
        setPaymentReservationById(nextPaymentReservationById);
      } catch {
        if (!isMounted) return;
        setFetchError("Failed to load transaction records.");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, []);

  const transactionRows: AdminTableRow[] = useMemo(
    () =>
      transactions.map((transaction) => {
        const totalAmount = Number(transaction.total_amount ?? 0);
        const paidAmount = Number(transaction.paid_amount ?? 0);
        const balanceAmount = Number(transaction.balance ?? 0);

        return {
          id: transaction.transaction_id,
          reference: reservationReferencesById[transaction.reservation_id] ?? "-",
          bookingType: toTitleCase(bookingTypesById[transaction.reservation_id] ?? "online"),
          total: formatCurrency(totalAmount),
          paid: formatCurrency(paidAmount),
          balance: formatCurrency(balanceAmount),
          overpaid: formatCurrency(Number(transaction.overpaid_amount ?? 0)),
          status: toTitleCase(deriveTransactionStatus(totalAmount, paidAmount, balanceAmount)),
          updatedAt: formatDateTime(transaction.updated_at),
        };
      }),
    [bookingTypesById, reservationReferencesById, transactions]
  );

  const invoiceRows: AdminTableRow[] = useMemo(
    () =>
      invoices.map((invoice) => ({
        id: invoice.invoice_id,
        invoiceId: invoice.invoice_id.slice(0, 8).toUpperCase(),
        reference: reservationReferencesById[invoice.reservation_id] ?? "-",
        total: formatCurrency(Number(invoice.total_amount ?? 0)),
        createdAt: formatDateTime(invoice.created_at),
      })),
    [invoices, reservationReferencesById]
  );

  const receiptRows: AdminTableRow[] = useMemo(
    () =>
      receipts.map((receipt) => ({
        id: receipt.receipt_id,
        receiptNumber: receipt.receipt_number,
        reference: reservationReferencesById[paymentReservationById[receipt.payment_id] ?? ""] ?? "-",
        paymentReference: paymentReferencesById[paymentReservationById[receipt.payment_id] ?? ""] ?? "-",
        issuedAt: formatDateTime(receipt.issued_at),
        status: receipt.is_active === false ? "Archived" : receipt.archived_at ? "Archived" : "Active",
      })),
    [paymentReferencesById, paymentReservationById, receipts, reservationReferencesById]
  );

  const totalDue = useMemo(
    () => transactions.reduce((sum, item) => sum + Number(item.total_amount ?? 0), 0),
    [transactions]
  );

  const collected = useMemo(
    () => transactions.reduce((sum, item) => sum + Number(item.paid_amount ?? 0), 0),
    [transactions]
  );

  const outstanding = useMemo(
    () => transactions.reduce((sum, item) => sum + Number(item.balance ?? 0), 0),
    [transactions]
  );
  const overpaid = useMemo(
    () => transactions.reduce((sum, item) => sum + Number(item.overpaid_amount ?? 0), 0),
    [transactions]
  );
  const pendingVerifications = useMemo(
    () => receipts.filter((receipt) => receipt.is_active !== false && !receipt.archived_at).length,
    [receipts]
  );

  const liveTransactionMetrics = useMemo(
    () => [
      { label: "Total Due", value: formatCurrency(totalDue), trend: "Current billing cycle" },
      { label: "Collected", value: formatCurrency(collected), trend: `${totalDue > 0 ? ((collected / totalDue) * 100).toFixed(1) : 0}% collected` },
      { label: "Outstanding", value: formatCurrency(outstanding), trend: "Requires follow-up" },
      { label: "Overpaid", value: formatCurrency(overpaid), trend: "Above billed totals" },
      { label: "Pending Verifications", value: String(pendingVerifications), trend: "Queued records" },
    ],
    [collected, outstanding, overpaid, pendingVerifications, totalDue]
  );

  const handleTransactionRowAction = (action: string, row: AdminTableRow) => {
    if (action !== "View") {
      return;
    }

    setViewDetails({
      title: "Transaction Details",
      fields: [
        { label: "Reservation Ref", value: row.reference ?? "-" },
        { label: "Booking Type", value: row.bookingType ?? "-" },
        { label: "Total Amount", value: row.total ?? "-" },
        { label: "Paid Amount", value: row.paid ?? "-" },
        { label: "Balance", value: row.balance ?? "-" },
        { label: "Overpaid", value: row.overpaid ?? "-" },
        { label: "Status", value: row.status ?? "-" },
        { label: "Updated", value: row.updatedAt ?? "-" },
      ],
    });
  };

  const handleInvoiceRowAction = async (action: string, row: AdminTableRow) => {
    if (action !== "View") {
      return;
    }

    const invoiceId = typeof row.id === "string" ? row.id : "";

    if (!invoiceId) {
      setFetchError("Unable to view this invoice record.");
      return;
    }

    setIsInvoiceDetailsOpen(true);
    setIsInvoiceDetailsLoading(true);
    setInvoiceDetailsError(null);
    setInvoiceDetails(null);

    try {
      const supabase = createClient();

      const { data: invoice, error: invoiceError } = await supabase
        .from("invoices")
        .select("invoice_id, reservation_id, total_amount, created_at")
        .eq("invoice_id", invoiceId)
        .maybeSingle<InvoiceDetailInvoiceRow>();

      if (invoiceError || !invoice) {
        setInvoiceDetailsError("Invoice record was not found.");
        return;
      }

      const [reservationResult, transactionResult, paymentsResult, reservationUnitsResult, reservationServicesResult] = await Promise.all([
        supabase
          .from("reservations")
          .select("reference_number, booking_type, status, start_datetime, end_datetime")
          .eq("reservation_id", invoice.reservation_id)
          .maybeSingle<InvoiceDetailReservationRow>(),
        supabase
          .from("transactions")
          .select("total_amount, paid_amount, balance, status")
          .eq("reservation_id", invoice.reservation_id)
          .maybeSingle<InvoiceDetailTransactionRow>(),
        supabase
          .from("payments")
          .select("payment_id, reference_number, amount, status, paid_at")
          .eq("reservation_id", invoice.reservation_id)
          .order("paid_at", { ascending: false }),
        supabase
          .from("reservation_units")
          .select("quantity, price_per_night, units(name)")
          .eq("reservation_id", invoice.reservation_id),
        supabase
          .from("reservation_services")
          .select("quantity, price_at_time, services(name)")
          .eq("reservation_id", invoice.reservation_id),
      ]);

      if (
        reservationResult.error ||
        transactionResult.error ||
        paymentsResult.error ||
        reservationUnitsResult.error ||
        reservationServicesResult.error
      ) {
        setInvoiceDetailsError("Failed to load complete invoice details.");
        return;
      }

      const paymentRows = (paymentsResult.data as InvoiceDetailPaymentRow[] | null) ?? [];
      const verifiedPayments = paymentRows.filter((payment) => payment.status === "verified");
      const verifiedPaymentIds = verifiedPayments.map((payment) => payment.payment_id);

      const receiptsResult = verifiedPaymentIds.length
        ? await supabase
            .from("receipts")
            .select("payment_id, receipt_number, issued_at, is_active, archived_at")
            .in("payment_id", verifiedPaymentIds)
            .order("issued_at", { ascending: false })
        : { data: [], error: null };

      if (receiptsResult.error) {
        setInvoiceDetailsError("Failed to load related receipt details.");
        return;
      }

      const receiptRows = (receiptsResult.data as InvoiceDetailReceiptRow[] | null) ?? [];
      const latestActiveReceipt = receiptRows.find((receipt) => receipt.is_active !== false && !receipt.archived_at) ?? null;

      const nights = reservationResult.data
        ? calculateNights(reservationResult.data.start_datetime, reservationResult.data.end_datetime)
        : 0;

      const unitRows = (reservationUnitsResult.data as InvoiceDetailReservationUnitRow[] | null) ?? [];
      const serviceRows = (reservationServicesResult.data as InvoiceDetailReservationServiceRow[] | null) ?? [];

      const unitBreakdown: InvoiceUnitBreakdownItem[] = unitRows.map((unit) => {
        const quantity = Number(unit.quantity ?? 0);
        const pricePerNight = Number(unit.price_per_night ?? 0);
        const lineTotal = quantity * pricePerNight * nights;

        return {
          name: (Array.isArray(unit.units) ? unit.units[0]?.name : unit.units?.name) ?? "Unit",
          quantity,
          pricePerNight,
          lineTotal,
        };
      });

      const serviceBreakdown: InvoiceServiceBreakdownItem[] = serviceRows.map((service) => {
        const quantity = Number(service.quantity ?? 0);
        const priceAtTime = Number(service.price_at_time ?? 0);
        const lineTotal = quantity * priceAtTime;

        return {
          name: (Array.isArray(service.services) ? service.services[0]?.name : service.services?.name) ?? "Service",
          quantity,
          priceAtTime,
          lineTotal,
        };
      });

      const unitsSubtotal = unitBreakdown.reduce((sum, item) => sum + item.lineTotal, 0);
      const servicesSubtotal = serviceBreakdown.reduce((sum, item) => sum + item.lineTotal, 0);
      const computedTotal = unitsSubtotal + servicesSubtotal;

      setInvoiceDetails({
        invoice,
        reservation: reservationResult.data,
        transaction: transactionResult.data,
        verifiedPayments,
        latestReceipt: latestActiveReceipt,
        nights,
        unitBreakdown,
        serviceBreakdown,
        unitsSubtotal,
        servicesSubtotal,
        computedTotal,
      });
    } catch {
      setInvoiceDetailsError("Failed to load complete invoice details.");
    } finally {
      setIsInvoiceDetailsLoading(false);
    }
  };

  const handleReceiptRowAction = async (action: string, row: AdminTableRow) => {
    if (action !== "View") {
      return;
    }

    const receiptId = typeof row.id === "string" ? row.id : "";

    if (!receiptId) {
      setFetchError("Unable to view this receipt record.");
      return;
    }

    try {
      const supabase = createClient();

      const { data: receiptRecord, error: receiptError } = await supabase
        .from("receipts")
        .select("receipt_id, payment_id, receipt_number, issued_at, is_active, archived_at")
        .eq("receipt_id", receiptId)
        .maybeSingle<ReceiptDetailReceiptRow>();

      if (receiptError || !receiptRecord) {
        setFetchError("Receipt record was not found.");
        return;
      }

      const { data: paymentRecord, error: paymentError } = await supabase
        .from("payments")
        .select(
          "payment_id, reservation_id, reference_number, amount, payment_method, payment_type, status, paid_at, account_name, account_number, proof_path"
        )
        .eq("payment_id", receiptRecord.payment_id)
        .maybeSingle<ReceiptDetailPaymentRow>();

      if (paymentError || !paymentRecord) {
        setFetchError("Failed to load payment details for this receipt.");
        return;
      }

      const [{ data: reservationRecord, error: reservationError }, { data: transactionRecord, error: transactionError }] =
        await Promise.all([
          supabase
            .from("reservations")
            .select(
              "reservation_id, guest_id, walk_in_guest_id, reference_number, booking_type, status, start_datetime, end_datetime"
            )
            .eq("reservation_id", paymentRecord.reservation_id)
            .maybeSingle<ReceiptDetailReservationRow>(),
          supabase
            .from("transactions")
            .select("total_amount, paid_amount, balance, overpaid_amount, status")
            .eq("reservation_id", paymentRecord.reservation_id)
            .maybeSingle<ReceiptDetailTransactionRow>(),
        ]);

      if (reservationError || !reservationRecord || transactionError) {
        setFetchError("Failed to load reservation billing details for this receipt.");
        return;
      }

      const guestLookup = reservationRecord.guest_id
        ? supabase
            .from("guests")
            .select("first_name, last_name, email")
            .eq("id", reservationRecord.guest_id)
            .maybeSingle<ReceiptDetailGuestRow>()
        : reservationRecord.walk_in_guest_id
          ? supabase
              .from("walk_in_guests")
              .select("first_name, last_name, email")
              .eq("walk_in_guest_id", reservationRecord.walk_in_guest_id)
              .maybeSingle<ReceiptDetailGuestRow>()
          : Promise.resolve({ data: null, error: null });

      const { data: guestRecord } = await guestLookup;

      const receiptStatus =
        receiptRecord.is_active === false || receiptRecord.archived_at ? "Archived" : "Active";
      const guestName = `${guestRecord?.first_name ?? ""} ${guestRecord?.last_name ?? ""}`
        .replace(/\s+/g, " ")
        .trim();

      setViewDetails({
        title: "Receipt Details",
        fields: [
          { label: "Receipt No.", value: receiptRecord.receipt_number ?? "-" },
          { label: "Issued At", value: formatDateTime(receiptRecord.issued_at) },
          { label: "Receipt Status", value: receiptStatus },
          { label: "Reservation Ref", value: reservationRecord.reference_number ?? "-" },
          { label: "Guest", value: guestName || "-" },
          { label: "Guest Email", value: guestRecord?.email ?? "-" },
          { label: "Booking Type", value: toTitleCase(reservationRecord.booking_type ?? "online") },
          { label: "Reservation Status", value: toTitleCase(reservationRecord.status ?? "pending") },
          { label: "Check-in", value: formatDate(reservationRecord.start_datetime) },
          { label: "Check-out", value: formatDate(reservationRecord.end_datetime) },
          { label: "Payment Ref", value: paymentRecord.reference_number ?? "-" },
          { label: "Payment Amount", value: formatCurrency(Number(paymentRecord.amount ?? 0)) },
          { label: "Payment Method", value: toTitleCase(paymentRecord.payment_method ?? "") },
          { label: "Payment Type", value: toTitleCase(paymentRecord.payment_type ?? "") },
          { label: "Payment Status", value: toTitleCase(paymentRecord.status ?? "") },
          { label: "Paid At", value: paymentRecord.paid_at ? formatDateTime(paymentRecord.paid_at) : "-" },
          { label: "Account Name", value: paymentRecord.account_name || "-" },
          { label: "Account Number", value: paymentRecord.account_number || "-" },
          { label: "Proof Path", value: paymentRecord.proof_path || "-" },
          { label: "Transaction Total", value: formatCurrency(Number(transactionRecord?.total_amount ?? 0)) },
          { label: "Transaction Paid", value: formatCurrency(Number(transactionRecord?.paid_amount ?? 0)) },
          { label: "Transaction Balance", value: formatCurrency(Number(transactionRecord?.balance ?? 0)) },
          { label: "Transaction Overpaid", value: formatCurrency(Number(transactionRecord?.overpaid_amount ?? 0)) },
          { label: "Transaction Status", value: toTitleCase(transactionRecord?.status ?? "unpaid") },
        ],
      });
    } catch {
      setFetchError("Failed to load receipt details.");
    }
  };

  return (
    <div>
      <AdminSectionHeader
        title="Transaction and Billing"
        subtitle="Record payments, monitor balances, and prepare billing documents."
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {liveTransactionMetrics.map((metric) => (
          <AdminMetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      {fetchError ? (
        <p className="mt-4 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">
          {fetchError}
        </p>
      ) : null}

      <section className="mt-6 rounded-2xl border border-neutral/10 bg-white p-4">
        <div className="mb-4 flex flex-wrap gap-2 border-b border-neutral/10 pb-4">
          {transactionTabs.map((tab) => {
            const isActive = tab === activeTab;

            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  isActive ? "bg-primary text-base" : "bg-base text-neutral hover:bg-neutral/10"
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>

        {activeTab === "Transaction Ledger" && (
          <AdminTablePreview
            title={isLoading ? "Transaction Ledger (Loading...)" : "Transaction Ledger"}
            columns={transactionColumns}
            rows={transactionRows}
            defaultSort={{ key: "updatedAt", direction: "desc" }}
            filters={[{ key: "status", label: "Status", options: ["Paid", "Partial", "Unpaid"] }]}
            actions={["Post Payment", "Export Ledger"]}
            rowActions={["View", "Settle"]}
            onRowAction={handleTransactionRowAction}
          />
        )}

        {activeTab === "Generated Invoices" && (
          <AdminTablePreview
            title={isLoading ? "Generated Invoices (Loading...)" : "Generated Invoices"}
            columns={invoiceColumns}
            rows={invoiceRows}
            defaultSort={{ key: "createdAt", direction: "desc" }}
            actions={["Generate Invoice"]}
            rowActions={["View", "Download"]}
            onRowAction={handleInvoiceRowAction}
          />
        )}

        {activeTab === "Issued Receipts" && (
          <AdminTablePreview
            title={isLoading ? "Issued Receipts (Loading...)" : "Issued Receipts"}
            columns={receiptColumns}
            rows={receiptRows}
            defaultSort={{ key: "issuedAt", direction: "desc" }}
            filters={[{ key: "status", label: "Status", options: ["Active", "Archived"] }]}
            actions={["Issue Receipt"]}
            rowActions={["View", "Print"]}
            onRowAction={handleReceiptRowAction}
          />
        )}
      </section>

      {isInvoiceDetailsOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral/40 px-4 py-6 sm:items-center" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-neutral/10 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-neutral">Invoice Details</h3>
                <p className="mt-1 text-sm text-neutral/70">Complete invoice, reservation, payment, and billing summary.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsInvoiceDetailsOpen(false);
                  setInvoiceDetails(null);
                  setInvoiceDetailsError(null);
                }}
                className="rounded-lg border border-neutral/20 px-3 py-1.5 text-xs font-medium text-neutral hover:bg-base"
              >
                Close
              </button>
            </div>

            {isInvoiceDetailsLoading ? <p className="mt-5 text-sm text-neutral/70">Loading invoice details...</p> : null}

            {invoiceDetailsError ? (
              <p className="mt-4 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">
                {invoiceDetailsError}
              </p>
            ) : null}

            {!isInvoiceDetailsLoading && invoiceDetails ? (
              <div className="mt-5 space-y-6">
                <section className="rounded-xl border border-neutral/10 p-4">
                  <h4 className="text-sm font-semibold text-neutral">Invoice</h4>
                  <div className="mt-3 grid gap-2 text-sm text-neutral/80 sm:grid-cols-2">
                    <p>
                      Invoice ID: <span className="font-semibold text-neutral">{invoiceDetails.invoice.invoice_id}</span>
                    </p>
                    <p>
                      Created At: <span className="font-semibold text-neutral">{formatDateTime(invoiceDetails.invoice.created_at)}</span>
                    </p>
                    <p>
                      Reservation Ref: <span className="font-semibold text-neutral">{invoiceDetails.reservation?.reference_number ?? "-"}</span>
                    </p>
                    <p>
                      Invoice Amount: <span className="font-semibold text-neutral">{formatCurrency(Number(invoiceDetails.invoice.total_amount ?? 0))}</span>
                    </p>
                  </div>
                </section>

                <section className="rounded-xl border border-neutral/10 p-4">
                  <h4 className="text-sm font-semibold text-neutral">Reservation Context</h4>
                  <div className="mt-3 grid gap-2 text-sm text-neutral/80 sm:grid-cols-2">
                    <p>
                      Booking Type: <span className="font-semibold text-neutral">{toTitleCase(invoiceDetails.reservation?.booking_type ?? "online")}</span>
                    </p>
                    <p>
                      Reservation Status: <span className="font-semibold text-neutral">{toTitleCase(invoiceDetails.reservation?.status ?? "pending")}</span>
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
                      Total: <span className="font-semibold text-neutral">{formatCurrency(Number(invoiceDetails.transaction?.total_amount ?? 0))}</span>
                    </p>
                    <p>
                      Paid: <span className="font-semibold text-neutral">{formatCurrency(Number(invoiceDetails.transaction?.paid_amount ?? 0))}</span>
                    </p>
                    <p>
                      Balance: <span className="font-semibold text-neutral">{formatCurrency(Number(invoiceDetails.transaction?.balance ?? 0))}</span>
                    </p>
                    <p>
                      Status: <span className="font-semibold text-neutral">{toTitleCase(invoiceDetails.transaction?.status ?? "unpaid")}</span>
                    </p>
                  </div>
                </section>

                <section className="rounded-xl border border-neutral/10 p-4">
                  <h4 className="text-sm font-semibold text-neutral">Cost Breakdown</h4>
                  <p className="mt-2 text-sm text-neutral/70">
                    Nights: <span className="font-semibold text-neutral">{invoiceDetails.nights}</span>
                  </p>

                  <div className="mt-4 space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-neutral">Units</p>
                      {invoiceDetails.unitBreakdown.length === 0 ? (
                        <p className="mt-2 text-sm text-neutral/70">No unit charges found.</p>
                      ) : (
                        <div className="mt-2 space-y-2 text-sm text-neutral/80">
                          {invoiceDetails.unitBreakdown.map((item, index) => (
                            <p key={`${item.name}-${index}`}>
                              <span className="font-semibold text-neutral">{item.name}</span> • Qty {item.quantity} • {formatCurrency(item.pricePerNight)}/night × {invoiceDetails.nights} night(s) = {formatCurrency(item.lineTotal)}
                            </p>
                          ))}
                        </div>
                      )}
                      <p className="mt-2 text-sm text-neutral/80">
                        Units Subtotal: <span className="font-semibold text-neutral">{formatCurrency(invoiceDetails.unitsSubtotal)}</span>
                      </p>
                    </div>

                    <div>
                      <p className="text-sm font-semibold text-neutral">Services</p>
                      {invoiceDetails.serviceBreakdown.length === 0 ? (
                        <p className="mt-2 text-sm text-neutral/70">No service charges found.</p>
                      ) : (
                        <div className="mt-2 space-y-2 text-sm text-neutral/80">
                          {invoiceDetails.serviceBreakdown.map((item, index) => (
                            <p key={`${item.name}-${index}`}>
                              <span className="font-semibold text-neutral">{item.name}</span> • Qty {item.quantity} • {formatCurrency(item.priceAtTime)} = {formatCurrency(item.lineTotal)}
                            </p>
                          ))}
                        </div>
                      )}
                      <p className="mt-2 text-sm text-neutral/80">
                        Services Subtotal: <span className="font-semibold text-neutral">{formatCurrency(invoiceDetails.servicesSubtotal)}</span>
                      </p>
                    </div>

                    <div className="rounded-lg bg-base px-3 py-2 text-sm text-neutral/80">
                      Computed Total: <span className="font-semibold text-neutral">{formatCurrency(invoiceDetails.computedTotal)}</span>
                      <span className="mx-2">•</span>
                      Transaction Total: <span className="font-semibold text-neutral">{formatCurrency(Number(invoiceDetails.transaction?.total_amount ?? 0))}</span>
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
      ) : null}

      {viewDetails ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral/40 px-4 py-6 sm:items-center" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral/10 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-neutral">{viewDetails.title}</h3>
                <p className="mt-1 text-sm text-neutral/70">Detailed record view for this billing entry.</p>
              </div>
              <button
                type="button"
                onClick={() => setViewDetails(null)}
                className="rounded-lg border border-neutral/20 px-3 py-1.5 text-xs font-medium text-neutral hover:bg-base"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-2 text-sm text-neutral/80 sm:grid-cols-2">
              {viewDetails.fields.map((field) => (
                <p key={field.label}>
                  {field.label}: <span className="font-semibold text-neutral">{field.value || "-"}</span>
                </p>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
