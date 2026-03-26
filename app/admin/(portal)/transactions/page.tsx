"use client";

import { useState } from "react";
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

const transactionTabs = ["Transaction Ledger", "Generated Invoices", "Issued Receipts"] as const;

export default function AdminTransactionsPage() {
  const [activeTab, setActiveTab] = useState<(typeof transactionTabs)[number]>("Transaction Ledger");

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
            title="Transaction Ledger"
            columns={transactionColumns}
            rows={transactionRows}
            defaultSort={{ key: "balance", direction: "desc" }}
            filters={[{ key: "status", label: "Status", options: ["Paid", "Partial", "Unpaid"] }]}
            actions={["Post Payment", "Export Ledger"]}
            rowActions={["Open", "Settle"]}
          />
        )}

        {activeTab === "Generated Invoices" && (
          <AdminTablePreview
            title="Generated Invoices"
            columns={invoiceColumns}
            rows={invoiceRows}
            defaultSort={{ key: "generatedAt", direction: "desc" }}
            actions={["Generate Invoice"]}
            rowActions={["View", "Download"]}
          />
        )}

        {activeTab === "Issued Receipts" && (
          <AdminTablePreview
            title="Issued Receipts"
            columns={receiptColumns}
            rows={receiptRows}
            defaultSort={{ key: "postedAt", direction: "desc" }}
            filters={[{ key: "method", label: "Method", options: ["Bank Transfer", "E-wallet"] }]}
            actions={["Issue Receipt"]}
            rowActions={["View", "Print"]}
          />
        )}
      </section>
    </div>
  );
}
