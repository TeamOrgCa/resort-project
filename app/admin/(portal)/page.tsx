import AdminMetricCard from "@/components/admin/AdminMetricCard";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import {
  bookingSourcesData,
  dailyRevenueTrend,
  dashboardMetrics,
  reservationStatusData,
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

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-neutral/10 bg-white p-5 lg:col-span-2">
          <h3 className="text-lg font-semibold text-neutral">Daily Revenue (Last 7 Days)</h3>
          <div className="mt-4 grid grid-cols-7 gap-2">
            {dailyRevenueTrend.map((item) => (
              <div key={item.day} className="flex flex-col items-center gap-2">
                <div className="flex h-36 w-full items-end rounded-lg bg-base px-2 py-2">
                  <div className="w-full rounded-md bg-primary" style={{ height: `${item.height}%` }} />
                </div>
                <p className="text-xs text-neutral/70">{item.day}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-neutral/10 bg-white p-5">
          <h3 className="text-lg font-semibold text-neutral">Reservation Status Split</h3>
          <div
            className="mx-auto mt-4 h-44 w-44 rounded-full border border-neutral/10"
            style={{
              background: `conic-gradient(
                var(--color-secondary) 0% ${reservationStatusData.confirmed}%,
                var(--color-highlight) ${reservationStatusData.confirmed}% ${reservationStatusData.confirmed + reservationStatusData.pending}%,
                var(--color-primary) ${reservationStatusData.confirmed + reservationStatusData.pending}% 100%
              )`,
            }}
          />
          <ul className="mt-4 space-y-2 text-sm text-neutral/80">
            <li>Confirmed: {reservationStatusData.confirmed}%</li>
            <li>Pending: {reservationStatusData.pending}%</li>
            <li>Cancelled: {reservationStatusData.cancelled}%</li>
          </ul>
        </article>

        <article className="rounded-2xl border border-neutral/10 bg-white p-5 lg:col-span-3">
          <h3 className="text-lg font-semibold text-neutral">Booking Source Distribution</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {bookingSourcesData.map((item) => (
              <div key={item.label} className="rounded-xl bg-base p-4">
                <p className="text-sm text-neutral/70">{item.label}</p>
                <p className="mt-1 text-2xl font-bold text-neutral">{item.value}%</p>
              </div>
            ))}
          </div>
        </article>
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
