import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import { auditColumns, auditRows } from "@/components/admin/content";

export default function AdminAuditPage() {
  return (
    <div>
      <AdminSectionHeader
        title="Audit Log"
        subtitle="Chronological record of staff actions for accountability and transparency."
      />

      <AdminTablePreview
        title="Recent Activity"
        columns={auditColumns}
        rows={auditRows}
        defaultSort={{ key: "timestamp", direction: "desc" }}
        filters={[
          { key: "module", label: "Module", options: ["Reservations", "Transactions", "Schedules", "Users"] },
          { key: "staff", label: "Staff", options: ["Alex Mendoza", "Bea Navarro", "Carlo Lim"] },
        ]}
        actions={["Export Log"]}
        rowActions={["View Details"]}
      />
    </div>
  );
}
