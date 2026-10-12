import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import ReportPanel from "@/components/admin/ReportPanel";

export default function AdminReportsPage() {
  return <div>
    <AdminSectionHeader title="Administrative Reports" subtitle="Generate sales and staff reports from live resort records." />
    <ReportPanel tabs={["Sales Report", "Staff Report"]} />
  </div>;
}
