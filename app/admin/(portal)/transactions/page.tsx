"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTabs from "@/components/admin/AdminTabs";
import AdminMetricCard from "@/components/admin/AdminMetricCard";
import type { AdminTableColumn, AdminTableRow } from "@/components/admin/types";
import InvoiceDetailsModal from "@/components/admin/transactions/InvoiceDetailsModal";
import KeyValueDetailsModal from "@/components/admin/transactions/KeyValueDetailsModal";
import PaymentReviewModal from "@/components/admin/transactions/PaymentReviewModal";
import TransactionsTablePanel from "@/components/admin/transactions/TransactionsTablePanel";
import RefundRequestsPanel from "@/components/admin/transactions/RefundRequestsPanel";
import { downloadReportCsv } from "@/lib/reports/export";
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
import { hasPermission } from "@/lib/auth/role-access";
import type { StaffRole } from "@/lib/auth/staff-auth";
import { useModuleTab } from "@/lib/admin/use-module-tab";
import { fetchAllPages, fetchByIds } from "@/lib/server/fetch-all-pages";
import RecordPaymentDialog, { type StaffPaymentMethod, type RecordedPaymentResult } from "@/components/admin/transactions/RecordPaymentDialog";
import { loadReservationGuestNames } from "@/lib/booking/reservation-guest-names";
import { manilaDateKey } from "@/lib/booking/manila-date";
import { resolveDateRange, withinDateRange, type DatePreset } from "@/lib/admin/date-range";

import PublicAccessPaymentDialog from "@/components/admin/transactions/PublicAccessPaymentDialog";
import { PUBLIC_SALE_COLUMNS, PUBLIC_ACCESS_TYPES, SALES_SOURCES, type PublicAccessSale, type SalesSource } from "@/lib/public-access/sales";

interface PaymentSnapshotRow {
  payment_id: string;
  reservation_id: string;
  reference_number: string;
  amount: number;
  payment_type: string;
  account_name: string | null;
  account_number: string | null;
  paid_at: string | null;
  receipt_paid_at: string | null;
  proof_path: string;
  status: "pending" | "verified" | "rejected";
  ocr_status: "not_applicable" | "consistent" | "mismatch" | "unreadable";
  ocr_notes: string | null;
  payment_methods?: { name: string } | { name: string }[] | null;
  receiving_account?: { account_name: string; account_number: string | null } | { account_name: string; account_number: string | null }[] | null;
}

const paymentReviewLane = (status: PaymentSnapshotRow["ocr_status"]) => {
  if (status === "consistent") return "Ready to reconcile";
  if (status === "mismatch" || status === "unreadable") return "Investigate";
  return "Other method";
};

const transactionTabs = ["Transaction Ledger", "Payment Verification Queue", "Refund Requests", "Generated Invoices", "Issued Receipts"] as const;

const transactionColumns: AdminTableColumn[] = [
  { key: "reference", label: "Booking / Collection Ref" },
  { key: "guest", label: "Guest name" },
  { key: "collectionSource", label: "Collection source" },
  { key: "paymentFor", label: "Payment for" },
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
  { key: "guest", label: "Guest name" },
  { key: "reference", label: "Reservation Ref" },
  { key: "total", label: "Total Amount" },
  { key: "createdAt", label: "Created At" },
];

const receiptColumns: AdminTableColumn[] = [
  { key: "collectionSource", label: "Collection source" },
  { key: "receiptNumber", label: "Receipt No." },
  { key: "guest", label: "Guest name" },
  { key: "reference", label: "Booking / Collection Ref" },
  { key: "paymentReference", label: "Payment Ref" },
  { key: "issuedAt", label: "Issued At" },
  { key: "status", label: "Status" },
];

const paymentVerificationColumns: AdminTableColumn[] = [
  { key: "reference", label: "Reservation Ref" },
  { key: "guest", label: "Guest name" },
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
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
  })} ${date.toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila",
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
  const [activeTab, setActiveTab] = useModuleTab<(typeof transactionTabs)[number]>("Transaction Ledger", {
    payments: "Payment Verification Queue", refunds: "Refund Requests", ledger: "Transaction Ledger",
    invoices: "Generated Invoices", receipts: "Issued Receipts",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>("overall");
  const [filterDay, setFilterDay] = useState(() => manilaDateKey(new Date()));
  const [customStart, setCustomStart] = useState(() => manilaDateKey(new Date()));
  const [customEnd, setCustomEnd] = useState(() => manilaDateKey(new Date()));
  const dateRange = useMemo(() => resolveDateRange(datePreset, customStart, customEnd, `${filterDay}T12:00:00+08:00`), [datePreset, customStart, customEnd, filterDay]);
  const dateFilterKey = `${datePreset}:${dateRange.start}:${dateRange.end}:${dateRange.error}`;
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [publicSales,setPublicSales]=useState<PublicAccessSale[]>([]);
  const [collectionSource,setCollectionSource]=useState<SalesSource>("all");
  const [showPublicPayment,setShowPublicPayment]=useState(false);
  const [canRecordPublic,setCanRecordPublic]=useState(false);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [reservationReferencesById, setReservationReferencesById] = useState<Record<string, string>>({});
  const [guestNamesByReservationId, setGuestNamesByReservationId] = useState<Record<string, string>>({});
  const [bookingTypesById, setBookingTypesById] = useState<Record<string, string>>({});
  const [paymentReferencesById, setPaymentReferencesById] = useState<Record<string, string>>({});
  const [paymentReservationById, setPaymentReservationById] = useState<Record<string, string>>({});
  const [payments, setPayments] = useState<PaymentSnapshotRow[]>([]);
  const [canReviewPayments, setCanReviewPayments] = useState(false);
  const [canRecordPayments, setCanRecordPayments] = useState(false);
  const [paymentReservationId, setPaymentReservationId] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<StaffPaymentMethod[]>([]);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [reviewPayment, setReviewPayment] = useState<PaymentSnapshotRow | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [isProofLoading, setIsProofLoading] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [reviewActionError, setReviewActionError] = useState<string | null>(null);
  const [reviewDecision, setReviewDecision] = useState<"approve" | "reject" | null>(null);
  const [screenshotReviewed, setScreenshotReviewed] = useState(false);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const proofRequestId = useRef(0);
  const [viewDetails, setViewDetails] = useState<ViewDetailsState | null>(null);
  const [isInvoiceDetailsOpen, setIsInvoiceDetailsOpen] = useState(false);
  const [isInvoiceDetailsLoading, setIsInvoiceDetailsLoading] = useState(false);
  const [invoiceDetailsError, setInvoiceDetailsError] = useState<string | null>(null);
  const [invoiceDetails, setInvoiceDetails] = useState<InvoiceViewDetails | null>(null);

  useEffect(() => {
    const updateDay = () => setFilterDay(manilaDateKey(new Date()));
    const timer = window.setInterval(updateDay, 60_000);
    const refreshOnFocus = () => { updateDay(); setRefreshRevision((revision) => revision + 1); };
    window.addEventListener("focus", refreshOnFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refreshOnFocus); };
  }, []);

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
          if (staffRole?.is_active) {
            const role = staffRole.role as StaffRole;
            const { data: grants } = role === "admin" ? { data: null } : await supabase.from("role_permissions").select("permissions").eq("role", role).maybeSingle();
            if (isMounted) setCanReviewPayments(hasPermission(role, grants?.permissions ?? [], "payment_approval"));
            if (isMounted) { setCanRecordPayments(hasPermission(role, grants?.permissions ?? [], "payment_entry")); setCanRecordPublic(role === "cashier" && hasPermission(role, grants?.permissions ?? [], "payment_entry") && hasPermission(role, grants?.permissions ?? [], "transactions")); }
          }
        }

        const activeMethods = await fetchAllPages<StaffPaymentMethod>((from, to) => supabase.from("payment_methods")
          .select("payment_method_id, name, type, is_active").eq("is_active", true).order("name").order("payment_method_id").range(from, to));
        if (isMounted) setPaymentMethods(activeMethods);

        const publicCollections=await fetchAllPages<PublicAccessSale>((from,to)=>supabase.from("public_access_sales").select(PUBLIC_SALE_COLUMNS).order("paid_at",{ascending:false}).order("sale_id").range(from,to));
        if(isMounted)setPublicSales(publicCollections);

        const transactionList = await fetchAllPages<TransactionRow>((from, to) => supabase.from("transactions")
          .select("transaction_id, reservation_id, total_amount, paid_amount, balance, overpaid_amount, status, created_at, updated_at")
          .order("updated_at", { ascending: false }).order("transaction_id").range(from, to));
        // Include pending payments even when no transaction has been generated yet.
        const pendingPayments = await fetchAllPages<PaymentSnapshotRow>((from, to) => supabase.from("payments")
          .select("payment_id, reservation_id, reference_number, amount, payment_type, account_name, account_number, paid_at, receipt_paid_at, proof_path, status, ocr_status, ocr_notes, payment_methods(name), receiving_account:payment_accounts!receiving_account_id(account_name,account_number)")
          .eq("status", "pending").order("created_at").order("payment_id").range(from, to));
        const reservationIds = [...new Set([...transactionList.map(row => row.reservation_id), ...pendingPayments.map(row => row.reservation_id)])];
        const ledgerReservationIds = [...new Set(transactionList.map(row => row.reservation_id))];

        const [{ data: reservationsData, error: reservationsError }, { data: invoicesData, error: invoicesError }, { data: paymentsData, error: paymentsError }, { data: receiptsData, error: receiptsError }] =
          await Promise.all([
            fetchByIds<ReservationRow>(reservationIds, (ids, from, to) => supabase.from("reservations")
              .select("reservation_id, guest_id, walk_in_guest_id, reference_number, booking_type, status").in("reservation_id", ids)
              .order("reservation_id").range(from, to)).then(data => ({ data, error: null })),
            fetchByIds<InvoiceRow>(ledgerReservationIds, (ids, from, to) => supabase.from("invoices")
              .select("invoice_id, reservation_id, total_amount, created_at").in("reservation_id", ids)
              .order("invoice_id").range(from, to)).then(data => ({ data, error: null })),
            fetchByIds<PaymentSnapshotRow>(ledgerReservationIds, (ids, from, to) => supabase.from("payments")
              .select("payment_id, reservation_id, reference_number, amount, payment_type, account_name, account_number, paid_at, receipt_paid_at, proof_path, status, ocr_status, ocr_notes, payment_methods(name), receiving_account:payment_accounts!receiving_account_id(account_name,account_number)")
              .in("reservation_id", ids).order("payment_id").range(from, to)).then(data => ({ data, error: null })),
            fetchAllPages<ReceiptRow>((from, to) => supabase.from("receipts")
              .select("receipt_id, payment_id, receipt_number, issued_at, is_active, archived_at, amount_paid, transaction_total_at_time, balance_after_payment, billed_to_name")
              .order("issued_at", { ascending: false }).order("receipt_id").range(from, to)).then(data => ({ data, error: null })),
          ]);

        if (reservationsError) throw reservationsError;
        if (invoicesError) throw invoicesError;
        if (paymentsError) throw paymentsError;
        if (receiptsError) throw receiptsError;
        const guestNames = await loadReservationGuestNames(supabase, reservationsData ?? []);

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

        const paymentRows = [...new Map([...((paymentsData as PaymentSnapshotRow[] | null) ?? []), ...pendingPayments].map(payment => [payment.payment_id, payment])).values()];
        const nextPaymentReferencesById = paymentRows.reduce<Record<string, string>>((accumulator, payment) => {
          accumulator[payment.payment_id] = payment.reference_number;
          return accumulator;
        }, {});

        const nextPaymentReservationById = paymentRows.reduce<Record<string, string>>((accumulator, payment) => {
          accumulator[payment.payment_id] = payment.reservation_id;
          return accumulator;
        }, {});

        const cancelledIds = new Set((reservationsData ?? []).filter(row => row.status === "cancelled").map(row => row.reservation_id));
        const statuses = new Map((reservationsData ?? []).map(row => [row.reservation_id, row.status]));
        setTransactions(transactionList.map(row => ({ ...row, reservation_status: statuses.get(row.reservation_id),
          ...(cancelledIds.has(row.reservation_id) ? { balance: 0, status: "cancelled" as const } : {}) })));
        setInvoices((invoicesData as InvoiceRow[] | null) ?? []);
        setReceipts((receiptsData as ReceiptRow[] | null) ?? []);
        setReservationReferencesById(nextReservationReferencesById);
        setGuestNamesByReservationId(guestNames);
        setBookingTypesById(nextBookingTypesById);
        setPaymentReferencesById(nextPaymentReferencesById);
        setPaymentReservationById(nextPaymentReservationById);
        setPayments(paymentRows);
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
  }, [refreshRevision]);

  const matchingTransactions = useMemo(() => transactions.filter(item => collectionSource!=="public" && withinDateRange(item.updated_at, dateRange)), [transactions, dateRange,collectionSource]);
  const matchingInvoices = useMemo(() => invoices.filter(item => withinDateRange(item.created_at, dateRange)), [invoices, dateRange]);
  const matchingReceipts = useMemo(() => receipts.filter(item => collectionSource!=="public" && withinDateRange(item.issued_at, dateRange)), [receipts, dateRange,collectionSource]);
  const matchingPayments = useMemo(() => payments.filter(item => withinDateRange(item.paid_at, dateRange)), [payments, dateRange]);

  const matchingPublicSales=useMemo(()=>publicSales.filter(sale=>collectionSource!=="private"&&withinDateRange(sale.paid_at,dateRange)),[publicSales,collectionSource,dateRange]);
  const publicCollected=matchingPublicSales.reduce((sum,sale)=>sum+Number(sale.amount),0);

  const transactionRows: AdminTableRow[] = useMemo(
    () =>
      [...matchingTransactions.map((transaction) => {
        const totalAmount = Number(transaction.total_amount ?? 0);
        const paidAmount = Number(transaction.paid_amount ?? 0);
        const balanceAmount = Number(transaction.balance ?? 0);

        return {
          collectionSource:"Private booking", paymentFor:"Private reservation",
          id: transaction.transaction_id,
          reference: reservationReferencesById[transaction.reservation_id] ?? "-",
          guest: guestNamesByReservationId[transaction.reservation_id] ?? "Guest unavailable",
          bookingType: toTitleCase(bookingTypesById[transaction.reservation_id] ?? "online"),
          total: formatCurrency(totalAmount),
          paid: formatCurrency(paidAmount),
          balance: formatCurrency(balanceAmount),
          overpaid: formatCurrency(Number(transaction.overpaid_amount ?? 0)),
          status: transaction.status === "cancelled" ? "Cancelled" : toTitleCase(deriveTransactionStatus(totalAmount, paidAmount, balanceAmount)),
          updatedAt: formatDateTime(transaction.updated_at),
        };
      }),...matchingPublicSales.map(sale=>({id:`public:${sale.sale_id}`,reference:sale.reference_number,guest:sale.guest_name,collectionSource:"Public access",paymentFor:sale.payment_for,bookingType:PUBLIC_ACCESS_TYPES[sale.access_type],total:formatCurrency(Number(sale.amount)),paid:formatCurrency(Number(sale.amount)),balance:formatCurrency(0),overpaid:formatCurrency(0),status:"Paid",updatedAt:formatDateTime(sale.paid_at)}))],
    [bookingTypesById, reservationReferencesById, guestNamesByReservationId, matchingTransactions,matchingPublicSales]
  );

  const invoiceRows: AdminTableRow[] = useMemo(
    () =>
      matchingInvoices.map((invoice) => ({
        id: invoice.invoice_id,
        invoiceId: invoice.invoice_id.slice(0, 8).toUpperCase(),
        guest: guestNamesByReservationId[invoice.reservation_id] ?? "Guest unavailable",
        reference: reservationReferencesById[invoice.reservation_id] ?? "-",
        total: formatCurrency(Number(invoice.total_amount ?? 0)),
        createdAt: formatDateTime(invoice.created_at),
      })),
    [matchingInvoices, reservationReferencesById, guestNamesByReservationId]
  );

  const receiptRows: AdminTableRow[] = useMemo(
    () =>
      [...matchingReceipts.map((receipt) => ({
        collectionSource:"Private booking",
        id: receipt.receipt_id,
        receiptNumber: receipt.receipt_number,
        guest: receipt.billed_to_name?.trim() || guestNamesByReservationId[paymentReservationById[receipt.payment_id] ?? ""] || "Guest unavailable",
        reference: reservationReferencesById[paymentReservationById[receipt.payment_id] ?? ""] ?? "-",
        paymentReference: paymentReferencesById[receipt.payment_id] ?? "-",
        issuedAt: formatDateTime(receipt.issued_at),
        status: receipt.is_active === false ? "Archived" : receipt.archived_at ? "Archived" : "Active",
      })),...matchingPublicSales.map(sale=>({id:`public:${sale.sale_id}`,collectionSource:"Public access",receiptNumber:sale.receipt_number,guest:sale.guest_name,reference:sale.reference_number,paymentReference:sale.payment_reference,issuedAt:formatDateTime(sale.paid_at),status:"Active"}))],
    [paymentReferencesById, paymentReservationById, matchingReceipts, reservationReferencesById, guestNamesByReservationId,matchingPublicSales]
  );

  const paymentVerificationRows: AdminTableRow[] = useMemo(
    () =>
      matchingPayments.map((payment) => ({
        id: payment.payment_id,
        reservationId: payment.reservation_id,
        reference: reservationReferencesById[payment.reservation_id] ?? "-",
        guest: guestNamesByReservationId[payment.reservation_id] ?? "Guest unavailable",
        paymentReference: payment.reference_number,
        amount: formatCurrency(Number(payment.amount ?? 0)),
        status: toTitleCase(payment.status),
        ocrReview: toTitleCase(payment.ocr_status.replaceAll("_", " ")),
        reviewLane: paymentReviewLane(payment.ocr_status),
        paidAt: payment.paid_at ? formatDateTime(payment.paid_at) : "-",
        proofPath: payment.proof_path,
      })),
    [matchingPayments, reservationReferencesById, guestNamesByReservationId]
  );

  const totalDue = useMemo(
    () => matchingTransactions.reduce((sum, item) => sum + Number(item.total_amount ?? 0), 0),
    [matchingTransactions]
  );

  const collected = useMemo(
    () => matchingTransactions.reduce((sum, item) => sum + Number(item.paid_amount ?? 0), 0),
    [matchingTransactions]
  );

  const outstanding = useMemo(
    () => matchingTransactions.reduce((sum, item) => sum + Number(item.balance ?? 0), 0),
    [matchingTransactions]
  );
  const overpaid = useMemo(
    () => matchingTransactions.reduce((sum, item) => sum + Number(item.overpaid_amount ?? 0), 0),
    [matchingTransactions]
  );
  const pendingVerifications = collectionSource === "public" ? 0 : matchingPayments.filter(payment => payment.status === "pending").length;

  const liveTransactionMetrics = useMemo(
    () => [
      { label: "Recorded Bills", value: formatCurrency(totalDue+publicCollected), trend: "Historical totals; cancelled balances are not collectible" },
      { label: "Collected", value: formatCurrency(collected+publicCollected), trend: "Public access received plus private net verified payments" },
      { label: "Outstanding", value: formatCurrency(outstanding), trend: "Requires follow-up" },
      { label: "Overpaid", value: formatCurrency(overpaid), trend: "Above billed totals" },
      { label: "Pending Verifications", value: String(pendingVerifications), trend: "Unresolved proofs in the selected payment date range" },
    ],
    [collected, outstanding, overpaid, pendingVerifications, totalDue,publicCollected]
  );

  const openPublicReceipt=(sale:PublicAccessSale,print=false)=>setViewDetails({title:"Public Access Receipt",kind:"receipt",printOnOpen:print,fields:[
    {label:"Receipt No.",value:sale.receipt_number},{label:"Issued At",value:formatDateTime(sale.paid_at)},
    {label:"Guest Name",value:sale.guest_name},{label:"Contact No.",value:sale.contact_number},{label:"Collection Ref",value:sale.reference_number},
    {label:"Access Type",value:PUBLIC_ACCESS_TYPES[sale.access_type]},{label:"Payment for",value:sale.payment_for},
    {label:"Payment Method",value:sale.payment_method_name},{label:"Payment Ref",value:sale.payment_reference},{label:"Paid At",value:formatDateTime(sale.paid_at)},
    {label:"Amount Paid",value:formatCurrency(Number(sale.amount))},{label:"Collection Total",value:formatCurrency(Number(sale.amount))},{label:"Balance After Payment",value:formatCurrency(0)}]});

  const handleTransactionRowAction = (action: string, row: AdminTableRow) => {
    if(row.id.startsWith("public:")){const sale=publicSales.find(s=>`public:${s.sale_id}`===row.id);if(sale&&action==="View")openPublicReceipt(sale);return;}
    if (action === "Settle payment") {
      const transaction = transactions.find((item) => item.transaction_id === row.id);
      if (!canRecordPayments || !transaction || Number(transaction.balance ?? 0) <= 0 || !["pending", "confirmed"].includes(transaction.reservation_status ?? "")) return;
      setPaymentReservationId(transaction.reservation_id);
      return;
    }
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
      setScreenshotReviewed(false);
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

  const paymentSaved = (result: RecordedPaymentResult) => {
    const emailFeedback = result.alreadyRecorded ? "" : result.billingEmails?.error
      ? ` Email notice: ${result.billingEmails.error}`
      : ` Receipt email: ${result.billingEmails?.receiptSent ? "sent" : result.billingEmails?.receiptAlreadySent ? "already sent" : "not sent"}. Invoice email: ${result.billingEmails?.invoiceSent ? "sent" : result.billingEmails?.invoiceAlreadySent ? "already sent" : "not sent"}.`;
    setPaymentMessage(`${result.message ?? "Payment recorded."} ${result.receipt?.receipt_number ? `Receipt ${result.receipt.receipt_number}. ` : ""}Remaining balance: ${formatCurrency(Number(result.remainingBalance ?? 0))}. Print the receipt from Issued Receipts.${emailFeedback}`);
    setPaymentReservationId(null);
    setRefreshRevision((revision) => revision + 1);
  };

  const closePaymentReview = () => {
    if (isSubmittingReview) return;
    proofRequestId.current += 1;
    setReviewPayment(null);
    setProofUrl(null);
    setProofError(null);
    setReviewActionError(null);
    setReviewDecision(null);
    setScreenshotReviewed(false);
  };

  const reconcilePaymentStatus = async (paymentId: string) => {
    const { data } = await createClient().from("payments")
      .select("status").eq("payment_id", paymentId)
      .maybeSingle<{ status: PaymentSnapshotRow["status"] }>();
    if (!data || data.status === "pending") return false;
    setPayments((current) => current.map((payment) => payment.payment_id === paymentId
      ? { ...payment, status: data.status } : payment));
    setReviewPayment((current) => current?.payment_id === paymentId ? { ...current, status: data.status } : current);
    setReviewDecision(null);
    setScreenshotReviewed(false);
    return true;
  };

  const submitPaymentReview = async (rejectionReason?: string) => {
    if (!reviewPayment || !reviewDecision || reviewPayment.status !== "pending" || !canReviewPayments || isSubmittingReview) return;
    if (reviewDecision === "approve" && !proofUrl) return;
    if (reviewDecision === "reject" && (!rejectionReason || rejectionReason.trim().length < 5 || rejectionReason.trim().length > 2000)) {
      setReviewActionError("Enter a rejection reason of 5 to 2,000 characters."); return;
    }
    if (reviewDecision === "approve" && !screenshotReviewed) {
      setReviewActionError("Verify the received funds, amount, recipient and reference before approving.");
      return;
    }
    const paymentId = reviewPayment.payment_id;
    const decision = reviewDecision;
    setIsSubmittingReview(true);
    setReviewActionError(null);

    try {
      const response = await fetch(`/api/admin/payments/${decision === "approve" ? "approve" : "reject"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, screenshotReviewed, rejectionReason }),
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
      proofRequestId.current += 1;
      setReviewPayment(null);
      setReviewDecision(null);
      setScreenshotReviewed(false);
      setProofUrl(null);
      setRefreshRevision((revision) => revision + 1);
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
    if(row.id.startsWith("public:")){const sale=publicSales.find(s=>`public:${s.sale_id}`===row.id);if(sale)openPublicReceipt(sale,action==="Print");return;}
    if (action !== "View" && action !== "Print") {
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
        .select("receipt_id, payment_id, receipt_number, issued_at, is_active, archived_at, amount_paid, transaction_total_at_time, balance_after_payment, billed_to_name")
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
          "reservation_id, guest_id, walk_in_guest_id, reference_number, booking_type, booking_mode, status, start_datetime, end_datetime"
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
            .select("first_name, middle_name, last_name")
            .eq("id", reservationRecord.guest_id)
            .maybeSingle<ReceiptDetailGuestRow>()
        : reservationRecord.walk_in_guest_id
          ? supabase
              .from("walk_in_guests")
              .select("first_name, middle_name, last_name")
              .eq("walk_in_guest_id", reservationRecord.walk_in_guest_id)
              .maybeSingle<ReceiptDetailGuestRow>()
          : Promise.resolve({ data: null, error: null });

      const [{ data: guestRecord }, { data: methodRecord }] = await Promise.all([
        guestLookup,
        paymentRecord.payment_method_id ? supabase.from("payment_methods").select("name").eq("payment_method_id", paymentRecord.payment_method_id).maybeSingle<{ name: string }>()
          : Promise.resolve({ data: null, error: null }),
      ]);
      const guestName = [guestRecord?.first_name, guestRecord?.middle_name, guestRecord?.last_name].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      const purpose = { downpayment: "Reservation down payment", full: "Reservation payment", additional: "Additional reservation payment" }[paymentRecord.payment_type] ?? "Reservation payment";
      const packageLabel = ({ day: "Day swimming", night: "Overnight swimming", whole_day: "Whole-day stay", custom: "Custom stay" } as Record<string, string>)[reservationRecord.booking_mode ?? ""];

      setViewDetails({
        title: "Receipt Details",
        kind: "receipt",
        printOnOpen: action === "Print",
        fields: [
          { label: "Receipt No.", value: receiptRecord.receipt_number ?? "-" },
          { label: "Issued At", value: formatDateTime(receiptRecord.issued_at) },
          { label: "Guest Name", value: receiptRecord.billed_to_name?.trim() || guestName || "Guest unavailable" },
          { label: "Reservation Ref", value: reservationRecord.reference_number ?? "-" },
          { label: "Payment for", value: `${purpose}${packageLabel ? ` — ${packageLabel}` : ""}` },
          { label: "Payment Method", value: methodRecord?.name?.trim() || (paymentRecord.payment_method_id ? "Unavailable" : "Not recorded") },
          { label: "Payment Ref", value: paymentRecord.reference_number ?? "-" },
          { label: "Paid At", value: paymentRecord.paid_at ? formatDateTime(paymentRecord.paid_at) : "-" },
          { label: "Amount Paid", value: formatCurrency(Number(receiptRecord.amount_paid ?? 0)) },
          { label: "Booking Total at Payment", value: formatCurrency(Number(receiptRecord.transaction_total_at_time ?? 0)) },
          { label: "Balance After Payment", value: formatCurrency(Number(receiptRecord.balance_after_payment ?? 0)) },
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
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {fetchError}
        </p>
      ) : null}
      {paymentMessage && <p role="status" className="mt-4 rounded-xl bg-green-50 px-3 py-2 text-sm text-neutral">{paymentMessage}</p>}

      <section className="admin-panel mt-6">
        <AdminTabs tabs={transactionTabs} value={activeTab} onChange={tab=>{setActiveTab(tab);setCollectionSource("all");}} label="Transaction sections" />

        {activeTab !== "Refund Requests" && <p className="mb-4 text-xs leading-relaxed text-neutral/65">Tables include records in the selected date range with pagination. CSV exports include every row matching the date range, table search and filters.</p>}
        {activeTab === "Generated Invoices" && <p className="mb-4 text-sm text-neutral/70">Invoices are generated automatically from reservation billing. Refresh to load the latest documents, or select View to inspect an invoice.</p>}
        {activeTab === "Issued Receipts" && <p className="mb-4 text-sm text-neutral/70">Receipts are issued for verified private payments and cashier-recorded public collections. Select Print to print a receipt or save it as a PDF.</p>}

        <section aria-label="Transaction date filters" className="mb-5 border-b border-neutral/10 pb-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 text-sm font-medium sm:max-w-xs">Date range
              <select value={datePreset} onChange={event => setDatePreset(event.target.value as DatePreset)} className="admin-field mt-1 w-full">
                <option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="overall">Overall</option><option value="custom">Custom date</option>
              </select>
            </label>
            {(activeTab==="Transaction Ledger"||activeTab==="Issued Receipts")&&<label className="text-sm font-medium">Collection source<select aria-label="Transaction collection source" value={collectionSource} onChange={e=>setCollectionSource(e.target.value as SalesSource)} className="admin-field mt-1 block">{Object.entries(SALES_SOURCES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
            {datePreset === "custom" && <>
              <label className="min-w-0 flex-1 text-sm font-medium sm:max-w-52">Start date<input type="date" value={customStart} onChange={event => setCustomStart(event.target.value)} aria-invalid={Boolean(dateRange.error)} className="admin-field mt-1 w-full" /></label>
              <label className="min-w-0 flex-1 text-sm font-medium sm:max-w-52">End date<input type="date" min={customStart} value={customEnd} onChange={event => setCustomEnd(event.target.value)} aria-invalid={Boolean(dateRange.error)} className="admin-field mt-1 w-full" /></label>
            </>}
          </div>
          {dateRange.error && <p role="alert" className="mt-3 text-sm text-red-700">{dateRange.error}</p>}
          <p className="mt-3 text-xs leading-relaxed text-neutral/65">Philippine time. Weeks run Monday–Sunday; custom dates include both days. Filtering by {activeTab === "Transaction Ledger" ? "ledger update date" : activeTab === "Generated Invoices" ? "invoice creation date" : activeTab === "Issued Receipts" ? "receipt issue date" : activeTab === "Refund Requests" ? "refund request date" : "payment date"}.</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral/65">Bill totals show the current amounts and balances of ledger entries updated in this range. Pending verifications use payment dates.</p>
        </section>

        {activeTab === "Transaction Ledger" && (
          <TransactionsTablePanel
            title="Transaction Ledger"
            columns={transactionColumns}
            rows={transactionRows}
            paginationResetKey={`${dateFilterKey}:${collectionSource}`}
            defaultSort={{ key: "updatedAt", direction: "desc" }}
            filters={[{ key: "status", label: "Status", options: ["Paid", "Partial", "Unpaid", "Cancelled"] }]}
            actions={canRecordPublic ? ["Refresh ledger", "New payment", "Export Ledger"] : ["Refresh ledger", "Export Ledger"]}
            rowActions={canRecordPayments ? ["View", "Settle payment"] : ["View"]}
            isRowActionDisabled={(action, row) => action === "Settle payment" && !transactions.some(item => item.transaction_id === row.id && Number(item.balance ?? 0) > 0 && ["pending", "confirmed"].includes(item.reservation_status ?? ""))}
            isLoading={isLoading}
            hasError={Boolean(fetchError)}
            onAction={(action, rows) => {
              if (action === "Refresh ledger") { setRefreshRevision(revision => revision + 1); return; }
              if (action === "Export Ledger") { downloadReportCsv(transactionColumns, rows, "transaction-ledger.csv"); return; }
              if (action !== "New payment" || !canRecordPublic) return;
              setShowPublicPayment(true);
            }}
            onRowAction={handleTransactionRowAction}
          />
        )}

        {activeTab === "Generated Invoices" && (
          <TransactionsTablePanel
            title="Generated Invoices"
            columns={invoiceColumns}
            rows={invoiceRows}
            paginationResetKey={dateFilterKey}
            defaultSort={{ key: "createdAt", direction: "desc" }}
            actions={["Refresh invoices", "Export invoices CSV"]}
            rowActions={["View"]}
            isLoading={isLoading}
            hasError={Boolean(fetchError)}
            onAction={(action, rows) => {
              if (action === "Refresh invoices") setRefreshRevision(revision => revision + 1);
              if (action === "Export invoices CSV") downloadReportCsv(invoiceColumns, rows, "invoices.csv");
            }}
            onRowAction={handleInvoiceRowAction}
          />
        )}

        {activeTab === "Payment Verification Queue" && (
          <div className="space-y-3">
            <p className="text-sm text-neutral/70">
              OCR sends clear matching GCash receipts to quick reconciliation and flags unclear or conflicting receipts for investigation. Confirm the transaction in the merchant record before approval.
            </p>
            <TransactionsTablePanel
              title="Payment Verification Queue"
              columns={paymentVerificationColumns}
              rows={paymentVerificationRows}
              paginationResetKey={dateFilterKey}
              defaultSort={{ key: "paidAt", direction: "desc" }}
              filters={[
                { key: "status", label: "Status", options: ["Pending", "Verified", "Rejected"] },
                { key: "reviewLane", label: "Review Lane", options: ["Ready to reconcile", "Investigate", "Other method"] },
              ]}
              rowActions={["Review"]}
              isLoading={isLoading}
              hasError={Boolean(fetchError)}
              onRowAction={handlePaymentRowAction}
            />
          </div>
        )}

        {activeTab === "Issued Receipts" && (
          <TransactionsTablePanel
            title="Issued Receipts"
            columns={receiptColumns}
            rows={receiptRows}
            paginationResetKey={`${dateFilterKey}:${collectionSource}`}
            defaultSort={{ key: "issuedAt", direction: "desc" }}
            filters={[{ key: "status", label: "Status", options: ["Active", "Archived"] }]}
            actions={["Refresh receipts", "Export receipts CSV"]}
            isLoading={isLoading}
            hasError={Boolean(fetchError)}
            onAction={(action, rows) => {
              if (action === "Refresh receipts") setRefreshRevision(revision => revision + 1);
              if (action === "Export receipts CSV") downloadReportCsv(receiptColumns, rows, "receipts.csv");
            }}
            rowActions={["View", "Print"]}
            onRowAction={handleReceiptRowAction}
          />
        )}
        {activeTab === "Refund Requests" && <RefundRequestsPanel dateRange={dateRange} paginationResetKey={dateFilterKey} onUpdated={() => setRefreshRevision(n => n + 1)} />}
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

      {showPublicPayment&&<PublicAccessPaymentDialog methods={paymentMethods} onClose={()=>setShowPublicPayment(false)} onSaved={(sale,message)=>{
        setShowPublicPayment(false);setPaymentMessage(`${message} Receipt ${sale.receipt_number}.`);setCollectionSource("public");setDatePreset("today");setRefreshRevision(n=>n+1);openPublicReceipt(sale);
      }}/>}
      {paymentReservationId && <RecordPaymentDialog initialReservationId={paymentReservationId}
        bills={transactions} references={reservationReferencesById} methods={paymentMethods}
        onSaved={paymentSaved} onClose={() => setPaymentReservationId(null)} />}

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
          screenshotReviewed={screenshotReviewed}
          onScreenshotReviewed={setScreenshotReviewed}
          onDecision={setReviewDecision}
          onConfirm={reason => { void submitPaymentReview(reason); }}
          onClose={closePaymentReview}
        />
      )}
    </div>
  );
}
