import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import { reportModules, reportSnapshotColumns, reportSnapshotRows } from "@/components/admin/content";

export default function AdminReportsPage() {
  return (
    <div>
      <AdminSectionHeader
        title="Administrative Reports"
        subtitle="Generate period-based reports to monitor operations, revenue, and staff accountability."
      />

      <section className="grid gap-4 md:grid-cols-2">
        {reportModules.map((report) => (
          <article key={report.title} className="rounded-2xl border border-neutral/10 bg-white p-5">
            <h3 className="text-lg font-semibold text-neutral">{report.title}</h3>
            <p className="mt-2 text-sm text-neutral/70">{report.description}</p>
            <div className="mt-4 flex gap-2 text-xs">
              <span className="rounded-full bg-base px-3 py-1 text-neutral/70">Daily</span>
              <span className="rounded-full bg-base px-3 py-1 text-neutral/70">Weekly</span>
              <span className="rounded-full bg-base px-3 py-1 text-neutral/70">Monthly</span>
            </div>
          </article>
        ))}
      </section>

      <div className="mt-6">
        <AdminTablePreview
          title="Report Snapshot"
          columns={reportSnapshotColumns}
          rows={reportSnapshotRows}
          defaultSort={{ key: "updated", direction: "desc" }}
          filters={[{ key: "report", label: "Report", options: ["Sales", "Financial", "Guest", "Staff"] }]}
          actions={["Generate Report", "Export CSV"]}
          rowActions={["Open"]}
        />
      </div>
    </div>
  );
}
