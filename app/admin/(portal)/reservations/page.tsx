"use client";

import { useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import {
  manualEntryColumns,
  manualEntryRows,
  ocularVisitColumns,
  ocularVisitRows,
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
  "Ocular Visit Records",
] as const;

export default function AdminReservationsPage() {
  const [activeTab, setActiveTab] = useState<(typeof reservationTabs)[number]>("Reservation Records");

  return (
    <div>
      <AdminSectionHeader
        title="Reservation and Booking Management"
        subtitle="Manage website reservations, walk-ins, approvals, and manual entries in one view."
      />

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

        {activeTab === "Ocular Visit Records" && (
          <AdminTablePreview
            title="Ocular Visit Records"
            columns={ocularVisitColumns}
            rows={ocularVisitRows}
            defaultSort={{ key: "scheduledDate", direction: "asc" }}
            filters={[
              { key: "status", label: "Status", options: ["Pending", "Confirmed", "Cancelled"] },
              { key: "timeSlot", label: "Time Slot", options: ["9:00 AM", "10:00 AM", "2:00 PM"] },
            ]}
            actions={["Schedule Visit"]}
            rowActions={["View", "Reschedule"]}
          />
        )}
      </section>
    </div>
  );
}
