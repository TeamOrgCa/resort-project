import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminMetricCard from "@/components/admin/AdminMetricCard";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import {
  invoiceColumns,
  invoiceRows,
  receiptColumns,
  receiptRows,
  transactionColumns,
  transactionMetrics,
  transactionRows,
} from "@/components/admin/content";

export default function AdminTransactionsPage() {
  return (
    <div>
      <AdminSectionHeader
        title="Transaction and Billing"
        subtitle="Record payments, monitor balances, and prepare billing documents."
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {transactionMetrics.map((metric) => (
          <AdminMetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <div className="mt-6 grid gap-6">
        <AdminTablePreview
          title="Transaction Ledger"
          columns={transactionColumns}
          rows={transactionRows}
          defaultSort={{ key: "balance", direction: "desc" }}
          filters={[{ key: "status", label: "Status", options: ["Paid", "Partial", "Unpaid"] }]}
          actions={["Post Payment", "Export Ledger"]}
          rowActions={["Open", "Settle"]}
        />
        <AdminTablePreview
          title="Generated Invoices"
          columns={invoiceColumns}
          rows={invoiceRows}
          defaultSort={{ key: "generatedAt", direction: "desc" }}
          actions={["Generate Invoice"]}
          rowActions={["View", "Download"]}
        />
        <AdminTablePreview
          title="Issued Receipts"
          columns={receiptColumns}
          rows={receiptRows}
          defaultSort={{ key: "postedAt", direction: "desc" }}
          filters={[{ key: "method", label: "Method", options: ["Bank Transfer", "E-wallet"] }]}
          actions={["Issue Receipt"]}
          rowActions={["View", "Print"]}
        />
      </div>
    </div>
  );
}
