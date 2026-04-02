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

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      try {
        setIsLoading(true);
        setFetchError(null);

        const supabase = createClient();

        const { data: transactionsData, error: transactionsError } = await supabase
          .from("transactions")
          .select("transaction_id, reservation_id, total_amount, paid_amount, balance, status, created_at, updated_at")
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
      transactions.map((transaction) => ({
        id: transaction.transaction_id,
        reference: reservationReferencesById[transaction.reservation_id] ?? "-",
        bookingType: toTitleCase(bookingTypesById[transaction.reservation_id] ?? "online"),
        total: formatCurrency(Number(transaction.total_amount ?? 0)),
        paid: formatCurrency(Number(transaction.paid_amount ?? 0)),
        balance: formatCurrency(Number(transaction.balance ?? 0)),
        status: toTitleCase(transaction.status),
        updatedAt: formatDateTime(transaction.updated_at),
      })),
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

  const outstanding = useMemo(() => totalDue - collected, [collected, totalDue]);
  const pendingVerifications = useMemo(
    () => receipts.filter((receipt) => receipt.is_active !== false && !receipt.archived_at).length,
    [receipts]
  );

  const liveTransactionMetrics = useMemo(
    () => [
      { label: "Total Due", value: formatCurrency(totalDue), trend: "Current billing cycle" },
      { label: "Collected", value: formatCurrency(collected), trend: `${totalDue > 0 ? ((collected / totalDue) * 100).toFixed(1) : 0}% collected` },
      { label: "Outstanding", value: formatCurrency(outstanding), trend: "Requires follow-up" },
      { label: "Pending Verifications", value: String(pendingVerifications), trend: "Queued records" },
    ],
    [collected, outstanding, pendingVerifications, totalDue]
  );

  return (
    <div>
      <AdminSectionHeader
        title="Transaction and Billing"
        subtitle="Record payments, monitor balances, and prepare billing documents."
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            rowActions={["Open", "Settle"]}
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
          />
        )}
      </section>
    </div>
  );
}
