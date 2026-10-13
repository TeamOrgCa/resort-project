import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import ReportPanel from "@/components/admin/ReportPanel";

export default function AdminReportsPage() {
  return <div>
    <AdminSectionHeader title="Reports" subtitle="Review payment collections and staff activity. Guest reservation reports are available in Transactions." />
    <ReportPanel tabs={["Sales Report", "Staff Report"]} />
  </div>;
}
