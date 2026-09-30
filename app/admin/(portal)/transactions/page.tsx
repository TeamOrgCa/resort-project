"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminMetricCard from "@/components/admin/AdminMetricCard";
import type { AdminTableColumn, AdminTableRow } from "@/components/admin/types";
import InvoiceDetailsModal from "@/components/admin/transactions/InvoiceDetailsModal";
import KeyValueDetailsModal from "@/components/admin/transactions/KeyValueDetailsModal";
import PaymentReviewModal from "@/components/admin/transactions/PaymentReviewModal";
import TransactionsTablePanel from "@/components/admin/transactions/TransactionsTablePanel";
import type {
  InvoiceDetailInvoiceRow,
  InvoiceDetailPaymentRow,
  InvoiceDetailReceiptRow,
  InvoiceDetailReservationRow,
  InvoiceDetailReservationServiceRow,
  InvoiceDetailReservationUnitRow,
  InvoiceDetailTransactionRow,
  InvoiceRow,
  InvoiceServiceBreakdownItem,
  InvoiceUnitBreakdownItem,
  InvoiceViewDetails,
  ReceiptDetailGuestRow,
  ReceiptDetailPaymentRow,
  ReceiptDetailReceiptRow,
  ReceiptDetailReservationRow,
  ReceiptRow,
  ReservationRow,
  TransactionRow,
  ViewDetailsState,
} from "@/components/admin/transactions/types";
import { createClient } from "@/lib/supabase/client";
import { PAYMENT_PROOF_BUCKET } from "@/lib/booking/payment-proof";

interface PaymentSnapshotRow {
  payment_id: string;
  reservation_id: string;
  reference_number: string;
  amount: number;
  payment_type: string;
  account_name: string | null;
  account_number: string | null;
  paid_at: string | null;
  proof_path: string;
  status: "pending" | "verified" | "rejected";
  ocr_status: "not_applicable" | "consistent" | "mismatch" | "unreadable";
  ocr_notes: string | null;
}

const paymentReviewLane = (status: PaymentSnapshotRow["ocr_status"]) => {
  if (status === "consistent") return "Ready to reconcile";
  if (status === "mismatch" || status === "unreadable") return "Investigate";
  return "Other method";
};

const transactionTabs = ["Transaction Ledger", "Payment Verification Queue", "Generated Invoices", "Issued Receipts"] as const;

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

const paymentVerificationColumns: AdminTableColumn[] = [
  { key: "reference", label: "Reservation Ref" },
  { key: "paymentReference", label: "Payment Ref" },
  { key: "amount", label: "Amount" },
  { key: "status", label: "Status" },
  { key: "ocrReview", label: "OCR Screen" },
  { key: "reviewLane", label: "Review Lane" },
  { key: "paidAt", label: "Paid At" },
];

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
  const [pendingPaymentCount, setPendingPaymentCount] = useState(0);
  const [payments, setPayments] = useState<PaymentSnapshotRow[]>([]);
  const [canReviewPayments, setCanReviewPayments] = useState(false);
  const [reviewPayment, setReviewPayment] = useState<PaymentSnapshotRow | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [isProofLoading, setIsProofLoading] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [reviewActionError, setReviewActionError] = useState<string | null>(null);
  const [reviewDecision, setReviewDecision] = useState<"approve" | "reject" | null>(null);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const proofRequestId = useRef(0);
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
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: staffRole } = await supabase.from("staff_users")
            .select("role, is_active").eq("id", user.id)
            .maybeSingle<{ role: string; is_active: boolean }>();
          if (isMounted) setCanReviewPayments(Boolean(staffRole?.is_active && ["admin", "cashier"].includes(staffRole.role)));
        }

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
              ? supabase
                  .from("payments")
                  .select("payment_id, reservation_id, reference_number, amount, payment_type, account_name, account_number, paid_at, proof_path, status, ocr_status, ocr_notes")
                  .in("reservation_id", reservationIds)
              : Promise.resolve({ data: [], error: null }),
            supabase.from("receipts").select("receipt_id, payment_id, receipt_number, issued_at, is_active, archived_at, amount_paid, transaction_total_at_time, balance_after_payment").order("issued_at", { ascending: false }).limit(200),
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

        const paymentRows = (paymentsData as PaymentSnapshotRow[] | null) ?? [];
        const nextPaymentReferencesById = paymentRows.reduce<Record<string, string>>((accumulator, payment) => {
          accumulator[payment.reservation_id] = payment.reference_number;
          return accumulator;
        }, {});

        const nextPaymentReservationById = paymentRows.reduce<Record<string, string>>((accumulator, payment) => {
          accumulator[payment.payment_id] = payment.reservation_id;
          return accumulator;
        }, {});

        setTransactions(transactionList);
        setInvoices((invoicesData as InvoiceRow[] | null) ?? []);
        setReceipts((receiptsData as ReceiptRow[] | null) ?? []);
        setReservationReferencesById(nextReservationReferencesById);
        setBookingTypesById(nextBookingTypesById);
        setPaymentReferencesById(nextPaymentReferencesById);
        setPaymentReservationById(nextPaymentReservationById);
        setPayments(paymentRows);
        setPendingPaymentCount(paymentRows.filter((payment) => payment.status === "pending").length);
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

  const paymentVerificationRows: AdminTableRow[] = useMemo(
    () =>
      payments.map((payment) => ({
        id: payment.payment_id,
        reservationId: payment.reservation_id,
        reference: reservationReferencesById[payment.reservation_id] ?? "-",
        paymentReference: payment.reference_number,
        amount: formatCurrency(Number(payment.amount ?? 0)),
        status: toTitleCase(payment.status),
        ocrReview: toTitleCase(payment.ocr_status.replaceAll("_", " ")),
        reviewLane: paymentReviewLane(payment.ocr_status),
        paidAt: payment.paid_at ? formatDateTime(payment.paid_at) : "-",
        proofPath: payment.proof_path,
      })),
    [payments, reservationReferencesById]
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
  const pendingVerifications = pendingPaymentCount;

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

  const handlePaymentRowAction = async (action: string, row: AdminTableRow) => {
    const payment = payments.find((item) => item.payment_id === row.id);
    if (!payment) {
      setFetchError("Payment record was not found.");
      return;
    }

    if (action === "Review") {
      const requestId = ++proofRequestId.current;
      setReviewPayment(payment);
      setReviewDecision(null);
      setReviewActionError(null);
      setProofUrl(null);
      setProofError(null);
      setIsProofLoading(true);
      if (!payment.proof_path) {
        setProofError("This payment has no uploaded proof file.");
        setIsProofLoading(false);
        return;
      }

      try {
        const supabase = createClient();
        const { data, error } = await supabase.storage.from(PAYMENT_PROOF_BUCKET).createSignedUrl(payment.proof_path, 600);
        if (requestId !== proofRequestId.current) return;
        if (error || !data?.signedUrl) {
          setProofError("Unable to load payment proof image.");
          return;
        }
        setProofUrl(data.signedUrl);
      } catch {
        if (requestId === proofRequestId.current) setProofError("Unable to load payment proof image.");
      } finally {
        if (requestId === proofRequestId.current) setIsProofLoading(false);
      }
    }
  };

  const closePaymentReview = () => {
    if (isSubmittingReview) return;
    proofRequestId.current += 1;
    setReviewPayment(null);
    setProofUrl(null);
    setProofError(null);
    setReviewActionError(null);
    setReviewDecision(null);
  };

  const reconcilePaymentStatus = async (paymentId: string) => {
    const { data } = await createClient().from("payments")
      .select("status").eq("payment_id", paymentId)
      .maybeSingle<{ status: PaymentSnapshotRow["status"] }>();
    if (!data || data.status === "pending") return false;
    setPayments((current) => current.map((payment) => payment.payment_id === paymentId
      ? { ...payment, status: data.status } : payment));
    setReviewPayment((current) => current?.payment_id === paymentId ? { ...current, status: data.status } : current);
    setPendingPaymentCount((current) => Math.max(current - 1, 0));
    setReviewDecision(null);
    return true;
  };

  const submitPaymentReview = async () => {
    if (!reviewPayment || !reviewDecision || reviewPayment.status !== "pending" || !canReviewPayments || isSubmittingReview) return;
    if (reviewDecision === "approve" && !proofUrl) return;
    const paymentId = reviewPayment.payment_id;
    const decision = reviewDecision;
    setIsSubmittingReview(true);
    setReviewActionError(null);

    try {
      const response = await fetch(`/api/admin/payments/${decision === "approve" ? "approve" : "reject"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId }),
      });
      const result = (await response.json().catch(() => null)) as { success?: boolean; message?: string } | null;
      if (!response.ok || !result?.success) {
        const updated = await reconcilePaymentStatus(paymentId);
        setReviewActionError(updated
          ? `Payment status changed, but the server reported: ${result?.message ?? "a follow-up error"}. Refresh billing records to confirm all follow-up steps.`
          : result?.message ?? `Failed to ${decision} payment.`);
        return;
      }

      setPayments((current) => current.map((payment) => payment.payment_id === paymentId
        ? { ...payment, status: decision === "approve" ? "verified" : "rejected" } : payment));
      setPendingPaymentCount((current) => Math.max(current - 1, 0));
      proofRequestId.current += 1;
      setReviewPayment(null);
      setReviewDecision(null);
      setProofUrl(null);
    } catch {
      try {
        const updated = await reconcilePaymentStatus(paymentId);
        setReviewActionError(updated
          ? "Payment status changed, but the connection failed during follow-up. Refresh billing records."
          : `Failed to ${decision} payment.`);
      } catch {
        setReviewActionError(`Failed to ${decision} payment.`);
      }
    } finally {
      setIsSubmittingReview(false);
    }
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
            .select("payment_id, receipt_number, issued_at, is_active, archived_at, amount_paid, transaction_total_at_time, balance_after_payment")
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
        .select("receipt_id, payment_id, receipt_number, issued_at, is_active, archived_at, amount_paid, transaction_total_at_time, balance_after_payment")
        .eq("receipt_id", receiptId)
        .maybeSingle<ReceiptDetailReceiptRow>();

      if (receiptError || !receiptRecord) {
        setFetchError("Receipt record was not found.");
        return;
      }

      const { data: paymentRecord, error: paymentError } = await supabase
        .from("payments")
        .select(
          "payment_id, reservation_id, reference_number, amount, payment_method_id, payment_type, status, paid_at, account_name, account_number, proof_path"
        )
        .eq("payment_id", receiptRecord.payment_id)
        .maybeSingle<ReceiptDetailPaymentRow>();

      if (paymentError || !paymentRecord) {
        setFetchError("Failed to load payment details for this receipt.");
        return;
      }

      const { data: reservationRecord, error: reservationError } = await supabase
        .from("reservations")
        .select(
          "reservation_id, guest_id, walk_in_guest_id, reference_number, booking_type, status, start_datetime, end_datetime"
        )
        .eq("reservation_id", paymentRecord.reservation_id)
        .maybeSingle<ReceiptDetailReservationRow>();

      if (reservationError || !reservationRecord) {
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
          { label: "Amount Paid", value: formatCurrency(Number(receiptRecord.amount_paid ?? 0)) },
          { label: "Transaction Total at Time", value: formatCurrency(Number(receiptRecord.transaction_total_at_time ?? 0)) },
          { label: "Balance After Payment", value: formatCurrency(Number(receiptRecord.balance_after_payment ?? 0)) },
          { label: "Reservation Ref", value: reservationRecord.reference_number ?? "-" },
          { label: "Guest", value: guestName || "-" },
          { label: "Guest Email", value: guestRecord?.email ?? "-" },
          { label: "Booking Type", value: toTitleCase(reservationRecord.booking_type ?? "online") },
          { label: "Reservation Status", value: toTitleCase(reservationRecord.status ?? "pending") },
          { label: "Check-in", value: formatDateTime(reservationRecord.start_datetime) },
          { label: "Check-out", value: formatDateTime(reservationRecord.end_datetime) },
          { label: "Payment Ref", value: paymentRecord.reference_number ?? "-" },
          { label: "Payment Amount", value: formatCurrency(Number(paymentRecord.amount ?? 0)) },
          { label: "Payment Method", value: paymentRecord.payment_method_id ?? "-" },
          { label: "Payment Type", value: toTitleCase(paymentRecord.payment_type ?? "") },
          { label: "Payment Status", value: toTitleCase(paymentRecord.status ?? "") },
          { label: "Paid At", value: paymentRecord.paid_at ? formatDateTime(paymentRecord.paid_at) : "-" },
          { label: "Account Name", value: paymentRecord.account_name || "-" },
          { label: "Account Number", value: paymentRecord.account_number || "-" },
          { label: "Proof Path", value: paymentRecord.proof_path || "-" },
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
          <TransactionsTablePanel
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
          <TransactionsTablePanel
            title={isLoading ? "Generated Invoices (Loading...)" : "Generated Invoices"}
            columns={invoiceColumns}
            rows={invoiceRows}
            defaultSort={{ key: "createdAt", direction: "desc" }}
            actions={["Generate Invoice"]}
            rowActions={["View", "Download"]}
            onRowAction={handleInvoiceRowAction}
          />
        )}

        {activeTab === "Payment Verification Queue" && (
          <div className="space-y-3">
            <p className="text-sm text-neutral/70">
              OCR sends clear matching GCash receipts to quick reconciliation and flags unclear or conflicting receipts for investigation. Confirm the transaction in the merchant record before approval.
            </p>
            <TransactionsTablePanel
              title={isLoading ? "Payment Verification Queue (Loading...)" : "Payment Verification Queue"}
              columns={paymentVerificationColumns}
              rows={paymentVerificationRows}
              defaultSort={{ key: "paidAt", direction: "desc" }}
              filters={[
                { key: "status", label: "Status", options: ["Pending", "Verified", "Rejected"] },
                { key: "reviewLane", label: "Review Lane", options: ["Ready to reconcile", "Investigate", "Other method"] },
              ]}
              rowActions={["Review"]}
              onRowAction={handlePaymentRowAction}
            />
          </div>
        )}

        {activeTab === "Issued Receipts" && (
          <TransactionsTablePanel
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

      <InvoiceDetailsModal
        isOpen={isInvoiceDetailsOpen}
        isLoading={isInvoiceDetailsLoading}
        error={invoiceDetailsError}
        invoiceDetails={invoiceDetails}
        onClose={() => {
          setIsInvoiceDetailsOpen(false);
          setInvoiceDetails(null);
          setInvoiceDetailsError(null);
        }}
      />

      {viewDetails ? <KeyValueDetailsModal details={viewDetails} onClose={() => setViewDetails(null)} /> : null}

      {reviewPayment && (
        <PaymentReviewModal
          payment={reviewPayment}
          reservationReference={reservationReferencesById[reviewPayment.reservation_id] ?? "-"}
          proofUrl={proofUrl}
          isProofLoading={isProofLoading}
          proofError={proofError}
          actionError={reviewActionError}
          canReview={canReviewPayments}
          decision={reviewDecision}
          isSubmitting={isSubmittingReview}
          onDecision={setReviewDecision}
          onConfirm={() => { void submitPaymentReview(); }}
          onClose={closePaymentReview}
        />
      )}
    </div>
  );
}
