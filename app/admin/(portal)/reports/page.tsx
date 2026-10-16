import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import ReportPanel from "@/components/admin/ReportPanel";

export default function AdminReportsPage() {
  return <div>
    <AdminSectionHeader title="Reports" subtitle="Review payment collections, guest reservations and staff activity." />
    <ReportPanel tabs={["Sales Report", "Guest Report", "Staff Report"]} />
  </div>;
}
