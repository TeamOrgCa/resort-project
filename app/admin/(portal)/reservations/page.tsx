import ReservationCalendar from "@/components/admin/ReservationCalendar";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";


export default async function AdminReservationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const reservation = typeof params.reservation === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(params.reservation) ? params.reservation : undefined;
  const date = typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) && Number.isFinite(Date.parse(`${params.date}T12:00:00Z`)) && new Date(`${params.date}T12:00:00Z`).toISOString().slice(0, 10) === params.date ? params.date : undefined;
  const staff = params.new === "1" ? await requireActiveStaff() : null;
  const openNew = Boolean(staff && await staffHasPermission(staff.supabase, staff.staffUser.role, "create_reservation"));
  return <ReservationCalendar key={`${reservation ?? ""}:${date ?? ""}:${openNew}`} initialReservationId={reservation} initialDate={date} openNew={openNew} />;
}
