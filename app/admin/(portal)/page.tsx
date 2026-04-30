import AdminMetricCard from "@/components/admin/AdminMetricCard";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import type { AdminTableColumn, AdminTableRow } from "@/components/admin/types";
import { createClient } from "@/lib/supabase/server";
import {
  bookingSourcesData,
  dailyRevenueTrend,
  dashboardMetrics,
  reservationStatusData,
} from "@/components/admin/content";

const upcomingReservationsColumns: AdminTableColumn[] = [
  { key: "reference", label: "Reference" },
  { key: "guest", label: "Guest" },
  { key: "checkIn", label: "Check-in" },
  { key: "checkOut", label: "Check-out" },
  { key: "status", label: "Status" },
];

interface ReservationRow {
  reservation_id: string;
  reference_number: string;
  guest_id: string | null;
  walk_in_guest_id?: string | null;
  check_in_date: string;
  check_out_date: string;
  status: string;
}

interface GuestRow {
  id: string;
  first_name: string;
  last_name: string;
}

interface WalkInGuestRow {
  walk_in_guest_id: string;
  first_name: string;
  last_name: string;
}

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const toTitleCase = (value: string) =>
  value
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export default async function AdminDashboardPage() {
  const supabase = await createClient();

  const { data: reservationsData } = await supabase
    .from("reservations")
    .select("reservation_id, reference_number, guest_id, walk_in_guest_id, check_in_date, check_out_date, status")
    .order("check_in_date", { ascending: true })
    .limit(20);

  const reservations = (reservationsData as ReservationRow[] | null) ?? [];
  const guestIds = [...new Set(reservations.map((row) => row.guest_id).filter((id): id is string => Boolean(id)))];
  const walkInGuestIds = [
    ...new Set(reservations.map((row) => row.walk_in_guest_id).filter((id): id is string => Boolean(id))),
  ];

  const [{ data: guestsData }, { data: walkInGuestsData }] = await Promise.all([
    guestIds.length
      ? supabase.from("guests").select("id, first_name, last_name").in("id", guestIds)
      : Promise.resolve({ data: [] }),
    walkInGuestIds.length
      ? supabase
          .from("walk_in_guests")
          .select("walk_in_guest_id, first_name, last_name")
          .in("walk_in_guest_id", walkInGuestIds)
      : Promise.resolve({ data: [] }),
  ]);

  const guestsById = ((guestsData as GuestRow[] | null) ?? []).reduce<Record<string, GuestRow>>(
    (accumulator, guest) => {
      accumulator[guest.id] = guest;
      return accumulator;
    },
    {}
  );

  const walkInGuestsById = ((walkInGuestsData as WalkInGuestRow[] | null) ?? []).reduce<
    Record<string, WalkInGuestRow>
  >((accumulator, guest) => {
    accumulator[guest.walk_in_guest_id] = guest;
    return accumulator;
  }, {});

  const upcomingReservationsRows: AdminTableRow[] = reservations.map((reservation) => {
    const guest = reservation.guest_id ? guestsById[reservation.guest_id] : null;
    const walkInGuest = reservation.walk_in_guest_id
      ? walkInGuestsById[reservation.walk_in_guest_id]
      : null;
    const displayGuest = guest ?? walkInGuest;
    const fallbackId = reservation.guest_id ?? reservation.walk_in_guest_id ?? "";
    const guestName = displayGuest
      ? `${displayGuest.first_name} ${displayGuest.last_name}`.replace(/\s+/g, " ").trim()
      : fallbackId
        ? `Guest ${fallbackId.slice(0, 8)}`
        : "Guest";

    return {
      id: reservation.reservation_id,
      reference: reservation.reference_number,
      guest: guestName,
      checkIn: formatDate(reservation.check_in_date),
      checkOut: formatDate(reservation.check_out_date),
      status: toTitleCase(reservation.status),
    };
  });

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
