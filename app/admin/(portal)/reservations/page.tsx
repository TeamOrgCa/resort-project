"use client";

import { useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import {
  manualEntryColumns,
  manualEntryRows,
  paymentVerificationColumns,
  paymentVerificationRows,
  reservationProcessStages,
  reservationRecordsColumns,
  reservationRecordsRows,
} from "@/components/admin/content";

const reservationTabs = [
  "Reservation Records",
  "Payment Verification Queue",
  "Manual Booking Entries",
] as const;

export default function AdminReservationsPage() {
  const [activeTab, setActiveTab] = useState<(typeof reservationTabs)[number]>("Reservation Records");

  return (
    <div>
      <AdminSectionHeader
        title="Reservation and Booking Management"
        subtitle="Manage website reservations, walk-ins, approvals, and manual entries in one view."
      />

     <section className="mt-4">
  <article className="rounded-2xl border border-neutral/10 bg-white p-5">
    <h3 className="text-lg font-semibold text-neutral">
      Client-to-Admin Process
    </h3>

    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {reservationProcessStages.map((stage, index) => (
        <div
          key={stage}
          className="flex items-start gap-3 rounded-xl bg-base p-4 text-sm text-neutral/80 shadow-sm hover:shadow-md transition"
        >
          {/* Step Number */}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-white font-bold">
            {index + 1}
          </div>

          {/* Text */}
          <p className="leading-relaxed">{stage}</p>
        </div>
      ))}
    </div>
  </article>
</section>

      <section className="mt-6 rounded-2xl border border-neutral/10 bg-white p-4">
        <div className="mb-4 flex flex-wrap gap-2 border-b border-neutral/10 pb-4">
          {reservationTabs.map((tab) => {
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

        {activeTab === "Reservation Records" && (
          <AdminTablePreview
            title="Reservation Records (Website + Walk-in)"
            columns={reservationRecordsColumns}
            rows={reservationRecordsRows}
            defaultSort={{ key: "stay", direction: "asc" }}
            filters={[
              { key: "source", label: "Source", options: ["Website", "Walk-in"] },
              { key: "status", label: "Status", options: ["Pending", "Confirmed", "Cancelled"] },
            ]}
            actions={["Add Walk-in", "Export"]}
            rowActions={["View", "Edit"]}
          />
        )}

        {activeTab === "Payment Verification Queue" && (
          <AdminTablePreview
            title="Payment Verification Queue"
            columns={paymentVerificationColumns}
            rows={paymentVerificationRows}
            defaultSort={{ key: "submitted", direction: "desc" }}
            filters={[
              { key: "method", label: "Method", options: ["Bank Transfer", "E-wallet"] },
            ]}
            actions={["Verify Selected"]}
            rowActions={["Review", "Approve"]}
          />
        )}

        {activeTab === "Manual Booking Entries" && (
          <AdminTablePreview
            title="Manual Booking Entries"
            columns={manualEntryColumns}
            rows={manualEntryRows}
            defaultSort={{ key: "reference", direction: "desc" }}
            filters={[
              {
                key: "encodedBy",
                label: "Encoded By",
                options: ["Alex Mendoza", "Bea Navarro", "Carlo Lim"],
              },
            ]}
            actions={["New Entry"]}
            rowActions={["View"]}
          />
        )}
      </section>
    </div>
  );
}
