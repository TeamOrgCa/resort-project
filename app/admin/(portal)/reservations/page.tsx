import ReservationCalendar from "@/components/admin/ReservationCalendar";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { getRolePermissions } from "@/lib/server/role-permissions";
import { hasPermission } from "@/lib/auth/role-access";
import { reservationNotificationTarget } from "@/lib/server/reservation-notification-target";


export default async function AdminReservationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const uuid = (value: unknown) => typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value) ? value : undefined;
  let reservation = uuid(params.reservation);
  let date = typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) && Number.isFinite(Date.parse(`${params.date}T12:00:00Z`)) && new Date(`${params.date}T12:00:00Z`).toISOString().slice(0, 10) === params.date ? params.date : undefined;
  const staff = await requireActiveStaff();
  const initialAccess = staff ? { role: staff.staffUser.role, permissions: await getRolePermissions(staff.supabase, staff.staffUser.role) } : undefined;
  const highlightOnly = params.highlight === "1";
  let targetError: string | undefined;
  if (highlightOnly) {
    const targetId = reservation ?? uuid(params.reschedule);
    reservation = undefined;
    date = undefined;
    if (targetId && staff && initialAccess && hasPermission(initialAccess.role, initialAccess.permissions, "reservations")) {
      const target = await reservationNotificationTarget(staff.supabase, targetId, !uuid(params.reservation));
      reservation = target.reservationId;
      date = target.date;
      targetError = target.error;
    } else targetError = targetId
      ? "You do not have access to open this booking or reservation."
      : "This notification contains an invalid booking or reservation link.";
  }
  const openNew = Boolean(params.new === "1" && initialAccess && hasPermission(initialAccess.role, initialAccess.permissions, "create_reservation"));
  return <ReservationCalendar key={`${reservation ?? ""}:${date ?? ""}:${openNew}:${highlightOnly}`} initialReservationId={reservation} initialDate={date} highlightOnly={highlightOnly} initialTargetError={targetError} openNew={openNew} initialAccess={initialAccess} />;
}
