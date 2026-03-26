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

export default function AdminReservationsPage() {
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

      <div className="mt-6 grid gap-6">
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
        <AdminTablePreview
          title="Manual Booking Entries"
          columns={manualEntryColumns}
          rows={manualEntryRows}
          defaultSort={{ key: "reference", direction: "desc" }}
          filters={[{ key: "encodedBy", label: "Encoded By", options: ["Alex Mendoza", "Bea Navarro", "Carlo Lim"] }]}
          actions={["New Entry"]}
          rowActions={["View"]}
        />
      </div>
    </div>
  );
}
