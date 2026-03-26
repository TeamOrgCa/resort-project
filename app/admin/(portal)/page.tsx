import AdminMetricCard from "@/components/admin/AdminMetricCard";
import AdminModuleCard from "@/components/admin/AdminModuleCard";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import {
  dashboardMetrics,
  dashboardModules,
  upcomingReservationsColumns,
  upcomingReservationsRows,
} from "@/components/admin/content";

export default function AdminDashboardPage() {
  return (
    <div>
      <AdminSectionHeader
        title="Dashboard"
        subtitle="Overview of bookings, occupancy, revenue, and pending transactions."
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {dashboardMetrics.map((metric) => (
          <AdminMetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        {dashboardModules.map((module) => (
          <AdminModuleCard key={module.title} module={module} />
        ))}
      </section>

      <div className="mt-6">
        <AdminTablePreview
          title="Upcoming Reservations"
          columns={upcomingReservationsColumns}
          rows={upcomingReservationsRows}
          defaultSort={{ key: "checkIn", direction: "asc" }}
          filters={[
            {
              key: "status",
              label: "Status",
              options: ["Confirmed", "Pending", "Cancelled", "Completed"],
            },
          ]}
          actions={["Export", "Refresh"]}
          rowActions={["View"]}
        />
      </div>
    </div>
  );
}
